import { auditToken } from './auditIdentity';
import { useState } from 'react';

const types = ['String', 'Boolean', 'Int32', 'Double', 'Object', 'Secret', 'Credential'];
const style = { background: '#111827', color: '#e2e8f0', border: '1px solid #27354b', borderRadius: 7, padding: '9px 12px', font: 'inherit' };
const button = { ...style, cursor: 'pointer' };
export default function MaestroAssets({ apiBase = '' }) {
  const [key, setKey] = useState(''), [connected, setConnected] = useState(false);
  const [catalog, setCatalog] = useState({ profiles: [], assets: [] }), [profileId, setProfile] = useState('default');
  const [name, setName] = useState(''), [type, setType] = useState('String'), [value, setValue] = useState('');
  const [username, setUsername] = useState(''), [password, setPassword] = useState(''), [editing, setEditing] = useState(null);
  const [profileName, setProfileName] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  const clear = () => { setName(''); setType('String'); setValue(''); setUsername(''); setPassword(''); setEditing(null); };
  const request = async (suffix = '', data) => {
    const r = await fetch(apiBase + '/api/v1/studio-assets' + suffix, { method: data === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(12000), headers: { 'X-API-Key': key, 'X-Tenant-Id': 'default', 'X-Runway-Task-Token': auditToken(apiBase), 'Content-Type': 'application/json' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    const result = await r.json();
    if (!r.ok || result.ok !== true) throw Error(result.error || 'Asset request failed.');
    return result;
  };
  const refresh = async () => { const c = await request(); setCatalog({ profiles: c.profiles, assets: c.assets }); setConnected(true); };
  const action = async fn => { setBusy(true); setMessage(''); try { await fn(); } catch (e) { setMessage(e.message || 'Request failed.'); } finally { setBusy(false); } };
  const selected = catalog.profiles.find(p => p.id === profileId);
  const field = (label, children) => <label style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>{label}{children}</label>;
  return <section aria-label="Central assets" style={{ display: 'grid', gap: 16, fontSize: 13 }}>
    <div><h2 style={{ margin: '0 0 6px', fontWeight: 500 }}>Assets & Credentials</h2><span style={{ color: '#94a3b8' }}>Environment-specific values for Studio workflows and Robot Jobs.</span></div>
    {!connected ? <form onSubmit={e => { e.preventDefault(); void action(refresh); }} style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}><input style={style} type="password" autoComplete="off" aria-label="Maestro API key" placeholder="Maestro API key" value={key} onChange={e => setKey(e.target.value)} /><button style={button} disabled={busy || !key}>Connect assets</button><small style={{ color: '#94a3b8', alignSelf: 'center' }}>The key is used for this page session only.</small></form> : <>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}><select style={style} aria-label="Maestro environment" value={profileId} disabled={busy} onChange={e => { setProfile(e.target.value); clear(); }}>{catalog.profiles.map(p => <option key={p.id} value={p.id}>{p.name}{p.enabled ? '' : ' · Disabled'}</option>)}</select><button style={button} disabled={busy} onClick={() => void action(refresh)}>Refresh</button><input style={style} aria-label="Environment name" placeholder="New environment name" value={profileName} onChange={e => setProfileName(e.target.value)} /><button style={button} disabled={busy || !profileName.trim()} onClick={() => void action(async () => { await request('/profiles', { name: profileName.trim(), enabled: true }); setProfileName(''); await refresh(); })}>Add environment</button><button style={button} disabled={busy || !selected || selected.id === 'default'} onClick={() => void action(async () => { await request('/profiles', { ...selected, enabled: !selected.enabled }); await refresh(); })}>{selected?.enabled === false ? 'Enable' : 'Disable'} environment</button><button style={button} onClick={() => { setKey(''); setConnected(false); setCatalog({ profiles: [], assets: [] }); clear(); }}>Disconnect</button></div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 18 }}><div><button style={button} disabled={busy} onClick={clear}>New asset</button><div style={{ marginTop: 12, display: 'grid', gap: 8 }}>{catalog.assets.filter(a => a.profileId === profileId).map(a => <button key={a.name} style={{ ...button, textAlign: 'left', display: 'grid', gap: 5 }} disabled={busy} onClick={() => { setEditing(a); setName(a.name); setType(a.type); setValue(a.value === undefined ? '' : typeof a.value === 'string' ? a.value : JSON.stringify(a.value)); setUsername(''); setPassword(''); }}><strong>{a.name}</strong><small style={{ color: '#94a3b8' }}>{a.type} · revision {a.revision}{['Secret', 'Credential'].includes(a.type) ? ' · Protected' : ''}</small></button>)}</div></div>
        <form aria-label="Maestro asset editor" style={{ display: 'grid', gap: 12 }} onSubmit={e => { e.preventDefault(); void action(async () => {
          const parsed = type === 'Credential' ? { username, password } : ['String', 'Secret'].includes(type) ? value : JSON.parse(value);
          await request('/values', { profileId, name, type, value: parsed, revision: editing?.revision ?? 0 }); clear(); await refresh(); setMessage('Saved. New runs use the updated central value.');
        }); }}><strong>{editing ? 'Update asset' : 'New asset'}</strong>{field('Asset name', <input style={style} aria-label="Maestro asset name" value={name} disabled={busy || !!editing} onChange={e => setName(e.target.value)} />)}{field('Asset type', <select style={style} aria-label="Maestro asset type" value={type} disabled={busy || !!editing} onChange={e => { setType(e.target.value); setValue(''); }}>{types.map(t => <option key={t}>{t}</option>)}</select>)}
          {type === 'Credential' ? <>{field('Username', <input style={style} type="password" autoComplete="off" aria-label="Maestro credential username" value={username} onChange={e => setUsername(e.target.value)} />)}{field('Password', <input style={style} type="password" autoComplete="new-password" aria-label="Maestro credential password" value={password} onChange={e => setPassword(e.target.value)} />)}</> : field('Value', <input style={style} type={type === 'Secret' ? 'password' : 'text'} autoComplete="off" aria-label="Maestro asset value" value={value} onChange={e => setValue(e.target.value)} />)}
          <small style={{ color: '#94a3b8' }}>Protected values are encrypted and never displayed. Enter new values to replace them.</small><div style={{ display: 'flex', gap: 10 }}><button style={button} disabled={busy || !name || !selected?.enabled}>Save asset</button>{editing && <button type="button" style={button} disabled={busy || !selected?.enabled} onClick={() => void action(async () => { await request('/values', { profileId, name, revision: editing.revision, delete: true }); clear(); await refresh(); })}>Delete asset</button>}</div>
        </form></div>
    </>}{message && <div role="status" style={{ padding: 12, border: '1px solid #27354b', borderRadius: 7 }}>{message}</div>}
  </section>;
}
