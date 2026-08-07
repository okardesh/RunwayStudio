import { useCallback, useEffect, useState } from 'react';
import './RecorderModal.css';
import './DesktopPickerModal.css';

interface DesktopPickerModalProps {
  windowTitle: string;
  onSelect: (selector: string) => void;
  onClose: () => void;
}

interface Captured {
  windowTitle?: string;
  name?: string;
  automationId?: string;
  className?: string;
  controlType?: string;
  selector?: string;
}

type Status = 'picking' | 'ready' | 'error';

const isElectron = () =>
  typeof window !== 'undefined' && 'electronAPI' in window && typeof (window as any).electronAPI?.pickDesktopElement === 'function';

export function DesktopPickerModal({ windowTitle, onSelect, onClose }: DesktopPickerModalProps) {
  const [status, setStatus] = useState<Status>('picking');
  const [captured, setCaptured] = useState<Captured | null>(null);
  const [error, setError] = useState('');

  const startPick = useCallback(() => {
    if (!isElectron()) {
      setStatus('error');
      setError('Desktop picking requires the desktop app (not available in browser preview).');
      return;
    }
    setStatus('picking');
    setCaptured(null);
    (window as any).electronAPI.pickDesktopElement(windowTitle)
      .then((result: any) => {
        if (result.cancelled) { onClose(); return; }
        setCaptured(result);
        setStatus('ready');
      })
      .catch((e: any) => {
        setStatus('error');
        setError(e?.message ?? String(e));
      });
  }, [onClose, windowTitle]);

  useEffect(() => { startPick(); }, [startPick]);

  return (
    <div className="rec-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="rec-modal dpick-modal">
        <div className="rec-header">
          <div className="rec-header__left">
            <span className={`rec-dot${status === 'picking' ? ' rec-dot--active' : ''}`} />
            <span className="rec-title">Desktop Element Picker</span>
          </div>
          <button className="rec-close" onClick={onClose}>✕</button>
        </div>

        <div className="dpick-body">
          {status === 'picking' && (
            <div className="dpick-hint">
              <div className="dpick-hint__icon">🎯</div>
              <p><strong>{windowTitle ? `"${windowTitle}" is now in focus.` : 'The app has been minimized.'}</strong></p>
              <p>{windowTitle
                ? `Move your cursor over "${windowTitle}" and click the element you want to automate. Elements outside this window won't highlight.`
                : 'Move your cursor over the target application and click the element you want to automate.'}</p>
              <p className="dpick-hint__sub">Press <kbd>Esc</kbd> to cancel</p>
            </div>
          )}

          {status === 'error' && (
            <div className="dpick-hint dpick-hint--error">
              <div className="dpick-hint__icon">⚠️</div>
              <p>{error}</p>
              <button className="rec-result__repick" onClick={startPick}>↺ Try Again</button>
            </div>
          )}
        </div>

        {status === 'ready' && captured && (
          <div className="rec-result">
            <div className="rec-result__meta">
              <span className="rec-result__tag">{captured.controlType || 'Element'}</span>
              {captured.windowTitle && <span className="rec-result__text">in "{captured.windowTitle}"</span>}
              {captured.name && <span className="rec-result__text">"{captured.name}"</span>}
            </div>
            <div className="rec-result__selector">{captured.selector}</div>
            <div className="rec-result__actions">
              <button className="rec-result__repick" onClick={startPick}>↺ Pick Again</button>
              <button className="rec-result__use" onClick={() => captured.selector && onSelect(captured.selector)}>
                ✔ Use This Selector
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
