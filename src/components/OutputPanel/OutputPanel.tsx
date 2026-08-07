import { useEffect, useRef } from 'react';
import { useUiStore } from '../../store/uiStore';
import './OutputPanel.css';

const LEVEL_COLORS: Record<string, string> = {
  info:    '#0078D4',
  warning: '#CA5010',
  error:   '#C50F1F',
  debug:   '#7A7A7A',
};

export function OutputPanel({ embedded = false }: { embedded?: boolean }) {
  const { outputMessages, clearOutput, toggleOutputPanel } = useUiStore();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [outputMessages.length]);

  return (
    <div className={`output-panel${embedded ? ' output-panel--embedded' : ''}`}>
      <div className="output-panel__header">
        <span className="output-panel__title">📋 Output</span>
        <div className="output-panel__actions">
          <button className="output-panel__btn" onClick={clearOutput} title="Clear output">
            🗑 Clear
          </button>
          <button className="output-panel__btn" onClick={toggleOutputPanel} title="Close panel">
            ✕
          </button>
        </div>
      </div>

      <div className="output-panel__body">
        {outputMessages.length === 0 ? (
          <div className="output-panel__empty">
            No output yet. Run the workflow to see results.
          </div>
        ) : (
          outputMessages.map((msg) => (
            <div key={msg.id} className="output-msg">
              <span className="output-msg__time">{msg.timestamp}</span>
              <span
                className="output-msg__level"
                style={{ color: LEVEL_COLORS[msg.level.toLowerCase()] ?? LEVEL_COLORS.info }}
              >
                {msg.level}
              </span>
              <span className="output-msg__text">{msg.text}</span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
