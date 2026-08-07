import { useWorkflowStore } from '../../store/workflowStore';
import './StatusBar.css';

const STATUS_CONFIG = {
  idle:      { color: '#CA5010', dot: '#CA5010', label: 'Robot Error' },
  running:   { color: '#107C10', dot: '#107C10', label: 'Running' },
  paused:    { color: '#FFA726', dot: '#FFA726', label: 'Paused' },
  error:     { color: '#C50F1F', dot: '#C50F1F', label: 'Error' },
  completed: { color: '#107C10', dot: '#107C10', label: 'Ready' },
} as const;

export function StatusBar() {
  const { status } = useWorkflowStore();
  const cfg = STATUS_CONFIG[status];

  return (
    <div className="status-bar">
      <div className="status-bar__left">
        <div className="status-indicator">
          <span
            className={`status-indicator__dot${status === 'running' ? ' pulse' : ''}`}
            style={{ background: cfg.dot }}
          />
          <span className="status-indicator__label" style={{ color: cfg.color }}>
            {cfg.label}
          </span>
        </div>
      </div>

      <div className="status-bar__right">
        <button className="status-bar__action">+ Add To Source Control</button>
        <span className="status-bar__sep" />
        <button className="status-bar__action">↑ Save to Cloud</button>
        <span className="status-bar__sep" />
        <span className="status-bar__info">VB, Windows</span>
      </div>
    </div>
  );
}

