import { useWorkflowStore } from '../../store/workflowStore';
import { useUiStore } from '../../store/uiStore';
import './StatusBar.css';

const STATUS_CONFIG = {
  idle:      { color: 'var(--studio-muted)', dot: 'var(--studio-subtle)', label: 'Ready' },
  running:   { color: 'var(--studio-green)', dot: 'var(--studio-green)', label: 'Running' },
  paused:    { color: 'var(--studio-warning)', dot: 'var(--studio-warning)', label: 'Paused' },
  error:     { color: 'var(--studio-red)', dot: 'var(--studio-red)', label: 'Error' },
  completed: { color: 'var(--studio-green)', dot: 'var(--studio-green)', label: 'Completed' },
} as const;

export function StatusBar() {
  const { status } = useWorkflowStore();
  const activityCount = useWorkflowStore((state) => state.nodes.length);
  const statusMessage = useUiStore((state) => state.statusMessage);
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
          {statusMessage && <span className="status-bar__message">{statusMessage}</span>}
        </div>
      </div>

      <div className="status-bar__right">
        <span className="status-bar__info">{activityCount} activities</span>
        <span className="status-bar__sep" />
        <span className="status-bar__info">Windows · Local workspace</span>
      </div>
    </div>
  );
}

