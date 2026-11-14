import type { HumanTaskEvent } from '../../shared/humanTasks';
export function HumanTaskHistory({ events }: { events?: HumanTaskEvent[] }) {
  return events?.length ? <details className="transaction-history" open><summary>Human tasks · {events.length} events</summary>{events.map((e, i) => <div key={i}><strong>{e.taskId}</strong><span>{e.phase}{e.decision ? ` · ${e.decision}` : ''}{e.actor ? ` · ${e.actor}` : ''}</span><small>{new Date(e.at).toLocaleString()}</small></div>)}</details> : null;
}
