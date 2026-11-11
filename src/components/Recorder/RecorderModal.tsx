import { useCallback, useEffect, useRef, useState } from 'react';
import './RecorderModal.css';
import { recorderScript, stopRecorderScript } from './recorderScript';

interface RecorderModalProps {
  onSelect: (selector: string) => void;
  onClose: () => void;
}

export function RecorderModal({ onSelect, onClose }: RecorderModalProps) {
  const webviewRef = useRef<any>(null);
  const [inputUrl, setInputUrl] = useState('https://');
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'recording'>('idle');
  const [captured, setCaptured] = useState<{ selector: string; tag: string; text: string } | null>(null);
  const [canBack, setCanBack] = useState(false);
  const [canFwd, setCanFwd] = useState(false);

  const [error, setError] = useState('');
  const activeToken = useRef<string | null>(null);
  const requestId = useRef(0);
  const guestReady = useRef(false);
  const guestAttached = useRef(false);
  const navigationId = useRef(0);

  const stopPicking = useCallback(() => {
    activeToken.current = null;
    requestId.current++;
    if (guestReady.current) void webviewRef.current?.executeJavaScript(stopRecorderScript).catch(() => {});
  }, []);

  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv) return;
    let mounted = true;
    const updateNavigation = () => {
      if (!mounted || !guestReady.current) return;
      setCanBack(wv.canGoBack());
      setCanFwd(wv.canGoForward());

    };
    const onConsole = (event: any) => {
      if (!event.message?.startsWith('__REC__:') || !activeToken.current) return;
      try {
        const data = JSON.parse(event.message.slice(8));
        if (data.token !== activeToken.current) return;
        if (!data.cancelled && (typeof data.selector !== 'string' || !data.selector || typeof data.tag !== 'string' || typeof data.text !== 'string')) return;
        activeToken.current = null;
        requestId.current++;
        setCaptured(data.cancelled ? null : data);
        setStatus('ready');
      } catch { /* Ignore unrelated page console messages. */ }
    };
    const onNavigate = (event: any) => {
      updateNavigation();
      if (/^https?:/i.test(event.url)) setInputUrl(event.url);
    };
    const onDomReady = () => { guestAttached.current = true; guestReady.current = true; updateNavigation(); };
    const onReady = () => {
      if (!guestReady.current || wv.isLoading()) return;
      updateNavigation();
      setStatus(current => current === 'recording' ? current : 'ready');
    };
    const onStart = () => {
      stopPicking();
      guestReady.current = false;
      setCaptured(null);
      setError('');
      setStatus('loading');
    };
    const onFail = (event: any) => {
      if (event.isMainFrame === false || event.errorCode === -3) return;
      stopPicking();
      setCaptured(null);
      setError('Page could not be loaded: ' + (event.errorDescription || 'unknown error'));
      setStatus('ready');
    };
    const onGone = () => {
      guestReady.current = false;
      stopPicking();
      setCaptured(null);
      setError('The page stopped responding. Reload it to continue.');
      setStatus('ready');
    };
    const events: Record<string, (event: any) => void> = {
      'console-message': onConsole, 'dom-ready': onDomReady,
      'did-finish-load': onReady, 'did-stop-loading': onReady,
      'did-start-loading': onStart, 'did-fail-load': onFail,
      'did-navigate': onNavigate, 'did-navigate-in-page': onNavigate, 'render-process-gone': onGone,
    };
    Object.entries(events).forEach(([name, listener]) => wv.addEventListener(name, listener));
    return () => {
      mounted = false;
      navigationId.current++;
      stopPicking();
      guestReady.current = false;
      Object.entries(events).forEach(([name, listener]) => wv.removeEventListener(name, listener));
    };
  }, [stopPicking]);

  const handleLoad = useCallback(() => {
    try {
      const value = inputUrl.trim();
      const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(value) ? value : 'https://' + value);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Enter an HTTP or HTTPS address.');
      stopPicking();
      setInputUrl(url.href);
      setCaptured(null);
      setError('');
      setStatus('loading');
      const id = ++navigationId.current;
      const wv = webviewRef.current;
      // A new webview cannot use loadURL until its initial dom-ready event.
      if (!guestAttached.current) { wv?.setAttribute('src', url.href); return; }
      void wv?.loadURL(url.href).catch((cause: Error) => {
        if (navigationId.current !== id || cause.message.includes('ERR_ABORTED')) return;
        setError(cause.message);
        setStatus('ready');
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Enter a valid URL.');
    }
  }, [inputUrl, stopPicking]);

  const startRecording = useCallback(() => {
    const wv = webviewRef.current;
    if (!wv || !guestReady.current) return;
    stopPicking();
    const id = ++requestId.current;
    const token = crypto.randomUUID();
    activeToken.current = token;
    setCaptured(null);
    setError('');
    setStatus('recording');
    void wv.executeJavaScript(recorderScript(token)).catch((cause: Error) => {
      if (requestId.current !== id) return;
      activeToken.current = null;
      setStatus('ready');
      setError('Could not start picking: ' + cause.message);
    });
  }, [stopPicking]);

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
            onClick={() => { if (status === 'recording') { stopPicking(); setStatus('ready'); } else startRecording(); }}
          >
            {status === 'recording' ? '■ Stop Picking' : '🎯 Pick Element'}
          </button>
        </div>

        {error && <div role="alert" className="rec-error">{error}</div>}

        {/* Viewport — webview always rendered so Electron load events fire correctly */}
        <div className="rec-viewport">
          {/* @ts-ignore — webview is Electron-only */}
          <webview
            ref={webviewRef}
            src="about:blank"
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
              🎯 Click an element to capture its selector. Press Esc to cancel.
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


