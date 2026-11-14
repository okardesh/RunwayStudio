import { useEffect, useRef, useState } from 'react';
import { auditToken, setAuditToken } from './auditIdentity';

const control = { background: 'var(--studio-bg, #111827)', color: 'var(--studio-text, #e2e8f0)', border: '1px solid var(--studio-border, #27354b)', borderRadius: 6, padding: '7px 10px', font: 'inherit' };
const label = actor => actor === 'admin:shared-key' ? 'Shared administrator (individual unknown)' : actor === 'unknown:legacy' ? 'Unknown (historical record)' : actor;
export default function MaestroAudit({ apiBase = '', scope = apiBase, request }) {
  const [key, setKey] = useState(''), [token, setToken] = useState(() => auditToken(scope));
  const [actor, setActor] = useState(''), [action, setAction] = useState(''), [source, setSource] = useState('');
  const [from, setFrom] = useState(''), [to, setTo] = useState('');
  const [data, setData] = useState(null), [facets, setFacets] = useState({ actors: [], actions: [] }), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const load = async (more = false) => {
    const id = ++generation.current; setBusy(true); setError('');
    try {
      const query = new URLSearchParams({ limit: '50' });
      if (actor) query.set('actor', actor); if (action) query.set('action', action); if (source) query.set('source', source);
      if (from) query.set('from', String(new Date(from).getTime()));
      if (to) query.set('to', String(new Date(to).getTime()));
      if (more && data?.nextCursor) { query.set('cursor', data.nextCursor); query.set('snapshot', String(data.snapshot)); }
      let result;
      if (request) result = await request(query.toString(), token);
      else {
        const r = await fetch(apiBase + '/api/v1/audit?' + query, { redirect: 'error', signal: AbortSignal.timeout(12000), headers: { 'X-API-Key': key, 'X-Tenant-Id': 'default', 'X-Runway-Task-Token': token } });
        result = await r.json(); if (!r.ok || !result.ok) throw Error(result.error || 'Audit request failed.');
      }
      if (id !== generation.current) return;
      setAuditToken(scope, token); setFacets(result); setData(previous => ({ ...result, events: more ? [...previous.events, ...result.events] : result.events }));
    } catch (e) { if (id === generation.current) setError(e.message || 'Audit could not be loaded.'); }
    finally { if (id === generation.current) setBusy(false); }
  };
  useEffect(() => () => { generation.current++; }, []);
  const change = setter => event => { generation.current++; setBusy(false); setter(event.target.value); if (setter === setToken) setAuditToken(scope, ''); setData(null); setError(''); };
  const field = (title, child) => <label style={{ display: 'grid', gap: 4 }}>{title}{child}</label>;
  return <section aria-label="Central Audit Log" style={{ padding: 16, display: 'grid', gap: 12, fontSize: 12, height: '100%', alignContent: 'start', overflow: 'auto', boxSizing: 'border-box', color: 'var(--studio-text, #e2e8f0)' }}>
    <div><strong style={{ fontSize: 15 }}>Audit Log</strong><p style={{ margin: '5px 0', opacity: .7 }}>Human Tasks, Assets, environment and Robot Job events in one tenant-scoped timeline. Values, credentials, form answers and comments are excluded.</p></div>
    <form onSubmit={e => { e.preventDefault(); void load(); }} style={{ display: 'flex', gap: 10, alignItems: 'end', flexWrap: 'wrap' }}>
      {!request && field('Administrative API key', <input style={control} aria-label="Audit API key" type="password" autoComplete="off" value={key} onChange={change(setKey)} />)}
      {field('Personal task token (optional)', <input style={control} aria-label="Audit personal token" type="password" autoComplete="off" value={token} onChange={change(setToken)} />)}
      {field('User', <input style={control} aria-label="Audit user" list="audit-users" placeholder="All users · exact identity" value={actor} onChange={change(setActor)} />)}
      <datalist id="audit-users">{facets.actors.map(a => <option key={a} value={a}>{label(a)}</option>)}</datalist>
      {field('Operation', <input style={control} aria-label="Audit operation" list="audit-actions" placeholder="All operations" value={action} onChange={change(setAction)} />)}
      <datalist id="audit-actions">{facets.actions.map(a => <option key={a} value={a} />)}</datalist>
      {field('Source', <select style={control} aria-label="Audit source" value={source} onChange={change(setSource)}><option value="">All sources</option>{['assets','human','operators','jobs'].map(s => <option key={s}>{s}</option>)}</select>)}
      {field('From (local time)', <input style={control} type="datetime-local" aria-label="Audit from" value={from} onChange={change(setFrom)} />)}
      {field('Until (exclusive)', <input style={control} type="datetime-local" aria-label="Audit until" value={to} onChange={change(setTo)} />)}
      <button style={control} disabled={busy || (!request && !key)}>{busy ? 'Loading…' : 'Apply / Refresh'}</button>
    </form>
    <small style={{ opacity: .7 }}>Personal identity is verified by Maestro and kept in session memory only. Without a token, shared-key actions cannot identify an individual.</small>
    {error && <div role="alert">{error}</div>}
    {data && <><div role="status">{data.events.length} records loaded · Current identity: {label(data.identity)}</div><div style={{ overflowX: 'auto' }}><table style={{ borderCollapse: 'collapse', width: '100%', textAlign: 'left', whiteSpace: 'nowrap' }}><thead><tr>{['Time','User','Operation','Target','Result','Environment / Job'].map(t => <th key={t} style={{ padding: 9, borderBottom: control.border }}>{t}</th>)}</tr></thead><tbody>{data.events.map(e => <tr key={e.id}>{[new Date(e.at).toLocaleString(), label(e.actor), e.action, e.targetType + ': ' + e.targetId, e.outcome, [e.profileId,e.jobId].filter(Boolean).join(' / ')].map((value,i) => <td key={i} style={{ padding: 9, borderBottom: control.border, maxWidth: 350, overflow: 'hidden', textOverflow: 'ellipsis' }} title={value}>{value}</td>)}</tr>)}</tbody></table>{!data.events.length && <p>No events match these filters.</p>}</div>{data.nextCursor && <button style={control} disabled={busy} onClick={() => void load(true)}>Load more</button>}</>}
  </section>;
}
