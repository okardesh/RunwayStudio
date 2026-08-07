import { useCallback, useEffect, useRef, useState } from 'react';
import './IndicateModal.css';

export interface IndicateResult {
  url: string;
  windowTitle: string;
  browserType: string;
  targetType?: 'browser' | 'desktop';
}

interface Props {
  onConfirm: (result: IndicateResult) => void;
  onClose: () => void;
}

type Phase = 'picking' | 'confirm';

interface WindowEntry {
  id: string;
  name: string;
  thumbnail: string;    // data URL — real screenshot in Electron, placeholder in browser
  appIcon: string | null;
  isCurrent?: boolean;
}

const isElectron = () =>
  typeof window !== 'undefined' && 'electronAPI' in window && typeof (window as any).electronAPI?.getOpenWindows === 'function';

// Placeholder thumbnails for browser-only mode
const BROWSER_FALLBACK: WindowEntry[] = [
  { id: 'current', name: document.title || 'RPA Studio', thumbnail: '', appIcon: null, isCurrent: true },
  { id: 'chrome', name: 'Google Chrome', thumbnail: '', appIcon: null },
  { id: 'msedge', name: 'Microsoft Edge', thumbnail: '', appIcon: null },
  { id: 'firefox', name: 'Firefox', thumbnail: '', appIcon: null },
];

const APP_ICONS: Record<string, string> = {
  'calculator': '🧮', 'chrome': '🌐', 'msedge': '🔵', 'firefox': '🦊',
  'notepad': '📝', 'word': '📄', 'excel': '📊', 'outlook': '✉️',
  'code': '⌨️', 'explorer': '📁', 'cmd': '⬛', 'powershell': '💙',
};

function guessIcon(name: string): string {
  const lower = name.toLowerCase();
  for (const [key, icon] of Object.entries(APP_ICONS)) {
    if (lower.includes(key)) return icon;
  }
  return '🖥';
}

export function IndicateModal({ onConfirm, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>('picking');
  const [mousePos, setMousePos] = useState({ x: -200, y: -200 });
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [manualUrl, setManualUrl] = useState('');
  const [browserType, setBrowserType] = useState('Chrome');
  const [windows, setWindows] = useState<WindowEntry[]>(BROWSER_FALLBACK);
  const [loading, setLoading] = useState(isElectron());
  const [selectedWindow, setSelectedWindow] = useState<WindowEntry | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Detect if target is a web browser (by name/icon) vs desktop app
  const isBrowserTarget = selectedWindow
    ? ['chrome', 'edge', 'firefox', 'safari', 'browser', 'http', 'www'].some((keyword) =>
        selectedWindow.name.toLowerCase().includes(keyword)
      )
    : false;

  // Load real windows from Electron on mount
  useEffect(() => {
    if (!isElectron()) return;
    (window as any).electronAPI.getOpenWindows()
      .then((wins: WindowEntry[]) => {
        setWindows(wins.map((w, i) => ({ ...w, isCurrent: i === 0 })));
        setLoading(false);
      })
      .catch(() => {
        setWindows(BROWSER_FALLBACK);
        setLoading(false);
      });
  }, []);

  // Track mouse for the animated highlight circle
  useEffect(() => {
    if (phase !== 'picking') return;
    const onMove = (e: MouseEvent) => setMousePos({ x: e.clientX, y: e.clientY });
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, [phase]);

  const handleWindowClick = useCallback((win: WindowEntry) => {
    setSelectedWindow(win);
    // For desktop apps, don't show URL field; for browsers, require one
    const isDesktopApp = !['chrome', 'edge', 'firefox', 'safari', 'browser', 'http', 'www'].some((keyword) =>
      win.name.toLowerCase().includes(keyword)
    );
    setManualUrl(isDesktopApp ? '' : 'https://');
    setPhase('confirm');
  }, []);

  const handleConfirm = useCallback(() => {
    const title = selectedWindow?.name ?? manualUrl;
    const targetType = isBrowserTarget ? 'browser' : 'desktop';
    onConfirm({ url: manualUrl, windowTitle: title, browserType, targetType });
  }, [manualUrl, browserType, selectedWindow, onConfirm, isBrowserTarget]);

  return (
    <div className="indicate-overlay" ref={overlayRef}>
      {phase === 'picking' && (
        <div
          className="indicate-cursor"
          style={{ left: mousePos.x, top: mousePos.y }}
        />
      )}

      <div className="indicate-modal" onClick={(e) => e.stopPropagation()}>
        <div className="indicate-modal__header">
          <div className="indicate-modal__header-left">
            <span className="indicate-modal__header-icon">🖥</span>
            <span className="indicate-modal__header-title">Indicate Application or Browser</span>
          </div>
          <button className="indicate-modal__close" onClick={onClose}>×</button>
        </div>

        {phase === 'picking' && (
          <>
            <div className="indicate-modal__hint">
              <div className="indicate-hint__icon">🎯</div>
              <div className="indicate-hint__text">
                <strong>Move your cursor to the target window and click it</strong>
                <span>Or select a window below, or enter a URL manually</span>
              </div>
            </div>

            <div className="indicate-modal__windows">
              <div className="indicate-modal__windows-label">
                Available Windows
                {loading && <span className="indicate-loading"> Detecting…</span>}
                {!loading && isElectron() && <span className="indicate-live"> • Live</span>}
              </div>

              <div className="indicate-modal__windows-grid">
                {loading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="indicate-win indicate-win--skeleton" />
                  ))
                ) : (
                  windows.map((win, idx) => (
                    <button
                      key={win.id}
                      className={`indicate-win${hoveredIdx === idx ? ' indicate-win--hovered' : ''}${win.isCurrent ? ' indicate-win--current' : ''}`}
                      onMouseEnter={() => setHoveredIdx(idx)}
                      onMouseLeave={() => setHoveredIdx(null)}
                      onClick={() => handleWindowClick(win)}
                    >
                      <div className="indicate-win__preview">
                        {win.thumbnail ? (
                          <img className="indicate-win__thumb" src={win.thumbnail} alt={win.name} />
                        ) : (
                          <span className="indicate-win__icon">{guessIcon(win.name)}</span>
                        )}
                        {win.isCurrent && <span className="indicate-win__badge">Current</span>}
                      </div>
                      <div className="indicate-win__info">
                        <span className="indicate-win__title">{win.name}</span>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>

            <div className="indicate-modal__divider"><span>or enter URL manually</span></div>

            <div className="indicate-modal__manual">
              <input
                className="indicate-url-input"
                value={manualUrl}
                onChange={(e) => setManualUrl(e.target.value)}
                placeholder="https://example.com"
                onKeyDown={(e) => e.key === 'Enter' && manualUrl.length > 8 && setPhase('confirm')}
              />
              <button
                className="indicate-next-btn"
                disabled={manualUrl.length < 8}
                onClick={() => setPhase('confirm')}
              >
                Next →
              </button>
            </div>
          </>
        )}

        {phase === 'confirm' && (
          <>
            <div className="indicate-modal__captured">
              <div className="indicate-captured__check">✔</div>
              <div className="indicate-captured__info">
                <div className="indicate-captured__label">Target captured</div>
                <div className="indicate-captured__url">
                  {selectedWindow?.thumbnail && (
                    <img className="indicate-captured__thumb" src={selectedWindow.thumbnail} alt="" />
                  )}
                  <span>{selectedWindow?.name ?? manualUrl}</span>
                </div>
              </div>
              <button className="indicate-captured__change" onClick={() => setPhase('picking')}>
                Change
              </button>
            </div>

            <div className="indicate-modal__options">
              {isBrowserTarget ? (
                <>
                  <div className="indicate-opt-row">
                    <label className="indicate-opt-label">URL</label>
                    <input
                      className="indicate-opt-input"
                      value={manualUrl}
                      onChange={(e) => setManualUrl(e.target.value)}
                      placeholder="https://example.com"
                    />
                  </div>
                  <div className="indicate-opt-row">
                    <label className="indicate-opt-label">Browser</label>
                    <select
                      className="indicate-opt-select"
                      value={browserType}
                      onChange={(e) => setBrowserType(e.target.value)}
                    >
                      <option>Chrome</option>
                      <option>Edge</option>
                      <option>Firefox</option>
                    </select>
                  </div>
                </>
              ) : (
                <div className="indicate-opt-hint">
                  🖥️ Desktop Application — no URL needed
                </div>
              )}
            </div>

            <div className="indicate-modal__footer">
              <button className="indicate-cancel-btn" onClick={onClose}>Cancel</button>
              <button className="indicate-confirm-btn" onClick={handleConfirm}>
                Confirm
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

