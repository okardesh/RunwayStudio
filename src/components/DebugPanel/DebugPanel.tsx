import { useState } from 'react';
import { useDebugStore } from '../../store/debugStore';
import type { DebugValue } from '../../engine/watchExpressions';
import { Icon } from '../Icon';
import './DebugPanel.css';

function Value({ value }: { value: DebugValue }) {
  if (value.redacted) return <span className="dbg-redacted">[REDACTED]</span>;
  return <details className="dbg-value"><summary title="Expand to inspect the value">{value.preview || '""'}</summary><pre>{value.detail || '""'}</pre>{value.truncated && <small>Preview is limited. Watches evaluate the full runtime value.</small>}</details>;
}

export function DebugPanel() {
  const { phase, projectName, activityName, locals, watches, results, updatedAt, storageWarning, addWatch, removeWatch, frames } = useDebugStore();
  const [filter, setFilter] = useState('');
  const [expression, setExpression] = useState('');
  const [error, setError] = useState('');
  const live = phase === 'running' || phase === 'paused';
  const filtered = locals.filter((v) => v.name.toLowerCase().includes(filter.toLowerCase()));
  const add = (value: string) => { try { addWatch(value); setExpression(''); setError(''); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not add this watch.'); } };
  return <div className="debug-panel">
    <div className="dbg-toolbar"><Icon name="code" size={16} /><strong>Locals & Watch</strong><span className={`dbg-phase dbg-phase--${phase}`}>{phase === 'idle' ? 'No debug session' : phase}</span>
      <span className="dbg-context">{projectName}{activityName ? ` / ${activityName}` : ''}</span>
      <span className="dbg-snapshot">{updatedAt ? `${live ? 'Live' : 'Last debug snapshot'} · ${new Date(updatedAt).toLocaleTimeString()}` : 'Start Debug to inspect runtime values'}</span>
    </div>
    {storageWarning && <div className="dbg-warning" role="status">{storageWarning}</div>}
    {frames.length > 1 && <div className="dbg-call-stack">Call stack: {frames.map((f) => f.projectName).join(' → ')}</div>}
    <div className="dbg-columns">
      <section className="dbg-locals" aria-label="Local variables">
        <header className="dbg-section-heading"><strong>Locals <span>{locals.length}</span></strong><input aria-label="Filter local variables" placeholder="Filter variables..." value={filter} onChange={(e) => setFilter(e.target.value)} /></header>
        <div className="dbg-table-wrap"><table className="dbg-table"><thead><tr><th>Name</th><th>Type</th><th>Value</th><th>Changed by / Scope</th><th><span className="dbg-sr-only">Watch variable</span></th></tr></thead><tbody>
          {filtered.map((v) => <tr key={v.name} className={v.changed ? 'dbg-row--changed' : ''}>
            <td className="dbg-name">{v.changed && <span className="dbg-change-dot" title="Changed in the last activity" />}{v.name}</td>
            <td className="dbg-type" title={v.declaredType ? `Declared type: ${v.declaredType}` : 'Created at runtime'}>{v.type}</td>
            <td><Value value={v} /></td>
            <td className="dbg-origin">{v.changedBy || 'Initial value'}<small>{v.scope}</small></td>
            <td><button type="button" className="dbg-watch-btn" title={`Watch ${v.name}`} aria-label={`Watch ${v.name}`} disabled={watches.includes(v.name)} onClick={() => add(v.name)}><Icon name={watches.includes(v.name) ? 'check' : 'plus'} size={14} /></button></td>
          </tr>)}
        </tbody></table>
          {!filtered.length && <div className="dbg-empty">{phase === 'idle' ? 'Choose Debug, set a breakpoint, then start the workflow. Live variables will appear here.' : locals.length ? 'No variables match your filter.' : 'No variables are in scope at this step.'}</div>}
        </div>
      </section>
      <section className="dbg-watches" aria-label="Watch expressions">
        <header className="dbg-section-heading"><strong>Watch <span>{watches.length}</span></strong><span>Read-only expressions</span></header>
        <form className="dbg-add-watch" onSubmit={(e) => { e.preventDefault(); add(expression); }}><input aria-label="Watch expression" placeholder="textResult, textResult.Length, items[0]" value={expression} onChange={(e) => setExpression(e.target.value)} maxLength={200} /><button type="submit" disabled={!expression.trim()}><Icon name="plus" size={14} />Add</button></form>
        {error && <div className="dbg-error" role="alert">{error}</div>}
        <div className="dbg-table-wrap"><table className="dbg-table"><thead><tr><th>Expression</th><th>Type</th><th>Value</th><th><span className="dbg-sr-only">Remove watch</span></th></tr></thead><tbody>
          {results.map((r) => <tr key={r.expression}><td className="dbg-name">{r.expression}</td><td className="dbg-type">{r.value?.type || '—'}</td><td>{r.value ? <Value value={r.value} /> : <span className="dbg-evaluation-error">{r.error}</span>}</td><td><button type="button" className="dbg-watch-btn" title={`Remove watch ${r.expression}`} aria-label={`Remove watch ${r.expression}`} onClick={() => removeWatch(r.expression)}><Icon name="close" size={13} /></button></td></tr>)}
        </tbody></table>{!watches.length && <div className="dbg-empty">Add a variable, an object property, an array index or a string method such as textResult.Trim().</div>}</div>
        <footer className="dbg-watch-note">Expressions are remembered on this device. Runtime values stay in memory.{!live && phase !== 'idle' && ' Start Debug again to evaluate new watches.'}</footer>
      </section>
    </div>
  </div>;
}
