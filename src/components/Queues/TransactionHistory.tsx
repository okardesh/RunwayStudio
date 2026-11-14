import type { TransactionEvent } from '../../shared/queues';
import './TransactionHistory.css';
export function TransactionHistory({ events }: { events?: TransactionEvent[] }) {
  if (!events?.length) return null;
  return <details className="transaction-history" open><summary>Transactions · {events.length} events</summary>{events.map((e, i) => <div key={i}><strong>{e.reference || e.queueName}</strong><span>{e.queueName} · {e.phase ? `Scope ${e.phase}` : e.status}{e.attempt ? ' · attempt ' + e.attempt : ''}</span>{e.scopeId && <small>Scope: {e.scopeId}</small>}{e.errorType && <small>{e.errorType}: {e.reason}</small>}<small>{new Date(e.at).toLocaleTimeString()}</small></div>)}</details>;
}
