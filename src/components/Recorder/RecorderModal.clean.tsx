import { useCallback, useEffect, useRef, useState } from 'react';
import './RecorderModal.css';

interface RecorderModalProps {
  onSelect: (selector: string) => void;
  onClose: () => void;
}

// Injected into the target page to highlight and capture elements
const INJECT_SCRIPT = `(function() {
  if (window.__recorderActive) return;
  window.__recorderActive = true;

  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;box-sizing:border-box;outline:3px solid #FF6B35;outline-offset:1px;border-radius:2px;transition:top .08s,left .08s,width .08s,height .08s;';
  document.body.appendChild(ov);

  function buildSelector(el) {
    if (!el || el === document.body) return 'body';
    if (el.id && /^[a-zA-Z_-]/.test(el.id)) return '#' + el.id;
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && cur !== document.documentElement) {
      let part = cur.tagName.toLowerCase();
      if (cur.id && /^[a-zA-Z_-]/.test(cur.id)) { parts.unshift('#' + cur.id); break; }
      const name = cur.getAttribute('name') || cur.getAttribute('data-testid') || cur.getAttribute('aria-label');
      if (name) { part += '[name="' + name + '"]'; }
      else if (cur.className) {
        const cls = [...cur.classList].filter(c => !/active|hover|focus|selected|disabled/.test(c)).slice(0, 2);
        if (cls.length) part += '.' + cls.join('.');
      }
      if (cur.parentElement) {
        const sibs = [...cur.parentElement.children].filter(c => c.tagName === cur.tagName);
        if (sibs.length > 1) part += ':nth-of-type(' + (sibs.indexOf(cur) + 1) + ')';
      }
      parts.unshift(part);
      cur = cur.parentElement;
    }
    return parts.slice(-5).join(' > ');
  }

  document.addEventListener('mouseover', e => {
    const r = e.target.getBoundingClientRect();
    Object.assign(ov.style, { left:r.left+'px', top:r.top+'px', width:r.width+'px', height:r.height+'px', display:'block', outline:'3px solid #FF6B35' });
  }, true);

  document.addEventListener('click', e => {
    e.preventDefault(); e.stopImmediatePropagation();
    ov.style.outline = '3px solid #43A047';
    const s = buildSelector(e.target);
    const tag = e.target.tagName.toLowerCase();
    const txt = (e.target.textContent || '').trim().replace(/\\s+/g,' ').slice(0, 80);
    console.log('__REC__:' + JSON.stringify({ selector: s, tag, text: txt }));
  }, true);
})()`;

export function RecorderModal({ onSelect, onClose }: RecorderModalProps) {
  const webviewRef = useRef<any>(null);
  const [inputUrl, setInputUrl] = useState('https://');
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'recording'>('idle');
  const [captured, setCaptured] = useState<{ selector: string; tag: string; text: string } | null>(null);
  const [canBack, setCanBack] = useState(false);
  const [canFwd, setCanFwd] = useState(false);

  // Attach webview events once on mount — avoids race condition with did-finish-load
  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv) return;

    const onConsole = (e: any) => {
      const msg: string = e.message ?? '';
      if (!msg.startsWith('__REC__:')) return;
      try {
        const data = JSON.parse(msg.slice(8));
        setCaptured(data);
        setStatus('ready');
      } catch { /* ignore */ }
    };

    const onReady = () => {
      setStatus('ready');
      setCanBack(wv.canGoBack?.() ?? false);
      setCanFwd(wv.canGoForward?.() ?? false);
      setInputUrl(wv.getURL?.() ?? '');
    };

    const onStart = () => setStatus('loading');
    const onFail  = () => setStatus('ready');

    wv.addEventListener('console-message', onConsole);
    wv.addEventListener('did-finish-load', onReady);
    wv.addEventListener('did-stop-loading', onReady);
    wv.addEventListener('did-start-loading', onStart);
    wv.addEventListener('did-fail-load', onFail);

    return () => {
      wv.removeEventListener('console-message', onConsole);
      wv.removeEventListener('did-finish-load', onReady);
      wv.removeEventListener('did-stop-loading', onReady);
      wv.removeEventListener('did-start-loading', onStart);
      wv.removeEventListener('did-fail-load', onFail);
    };
  }, []);

  const handleLoad = useCallback(() => {
    const url = /^https?:\/\//.test(inputUrl) ? inputUrl : 'https://' + inputUrl;
    setInputUrl(url);
    setCaptured(null);
    setStatus('loading');
    webviewRef.current?.loadURL(url);
  }, [inputUrl]);

  const startRecording = useCallback(() => {
    const wv = webviewRef.current;
    if (!wv) return;
    wv.executeJavaScript(INJECT_SCRIPT)
      .then(() => setStatus('recording'))
      .catch(console.error);
  }, []);

  return (
    <div className="rec-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="rec-modal">

        <div className="rec-header">
          <div className="rec-header__left">
            <span className={`rec-dot${status === 'recording' ? ' rec-dot--active' : ''}`} />
            <span className="rec-title">Element Recorder</span>
          </div>
          <button className="rec-close" onClick={onClose}>✕</button>
        </div>

        <div className="rec-nav">
          <button className="rec-nav__btn" disabled={!canBack} onClick={() => webviewRef.current?.goBack()}>‹</button>
          <button className="rec-nav__btn" disabled={!canFwd}  onClick={() => webviewRef.current?.goForward()}>›</button>
          <button className="rec-nav__btn" disabled={status === 'loading'} onClick={() => webviewRef.current?.reload()}>↻</button>
          <input
            className="rec-nav__url"
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleLoad()}
            spellCheck={false}
            placeholder="Enter URL and press Enter…"
          />
          <button className="rec-nav__load" onClick={handleLoad}>Go</button>
          <button
            className={`rec-nav__record${status === 'recording' ? ' active' : ''}`}
            disabled={status === 'idle' || status === 'loading'}
            onClick={startRecording}
          >
            {status === 'recording' ? '⏺ Recording…' : '🎯 Pick Element'}
          </button>
        </div>

        {/* Viewport — webview always rendered so Electron load events fire correctly */}
        <div className="rec-viewport">
          {/* @ts-ignore — webview is Electron-only */}
          <webview
            ref={webviewRef}
            style={{ width: '100%', height: '100%', display: 'flex' }}
          />

          {/* Placeholder overlays blank webview before first navigation */}
          {status === 'idle' && (
            <div className="rec-placeholder" style={{ position: 'absolute', inset: 0, background: '#FAFBFC' }}>
              <div className="rec-placeholder__icon">🎯</div>
              <p>Enter a URL above and click <strong>Go</strong>, then click <strong>Pick Element</strong>.</p>
            </div>
          )}

          {status === 'recording' && (
            <div className="rec-recording-hint">
              🎯 Click any element on the page to capture its selector
            </div>
          )}

          {status === 'loading' && <div className="rec-loading-bar" />}
        </div>

        {captured && (
          <div className="rec-result">
            <div className="rec-result__meta">
              <span className="rec-result__tag">{`<${captured.tag}>`}</span>
              {captured.text && <span className="rec-result__text">"{captured.text}"</span>}
            </div>
            <div className="rec-result__selector">{captured.selector}</div>
            <div className="rec-result__actions">
              <button className="rec-result__repick" onClick={startRecording}>↺ Pick Again</button>
              <button className="rec-result__use" onClick={() => onSelect(captured.selector)}>
                ✔ Use This Selector
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
