import { useEffect, useState } from 'react';
import type { RunwayConnection } from '../../engine/runwayConnection';
import { assetsRequest } from '../../engine/assetsClient';
import { useAssetsStore } from '../../store/assetsStore';
import { assetTypes, type AssetType } from '../../shared/assets';
import './AssetsPanel.css';
import { useUiStore } from '../../store/uiStore';

export function EnvironmentIndicator() {
  const { catalog, selectedProfileId } = useAssetsStore();
  if (!catalog.profiles.length) return null;
  const profile = catalog.profiles.find(p => p.id === selectedProfileId);
  return <button className="assets-environment-indicator" title="Environment for the next local Run or Debug" onClick={() => useUiStore.getState().setActiveBottomPanelTab('assets')}>Environment: {profile?.name ?? selectedProfileId}{profile?.enabled === false ? ' · Disabled' : ''}</button>;
}

export function AssetsMonitor({ connection }: { connection: RunwayConnection | null }) {
  useEffect(() => { const s = useAssetsStore.getState(); s.setConnection(connection); void s.refresh(); return () => useAssetsStore.getState().setConnection(null); }, [connection]);
  return null;
}
export function AssetsPanel() {
  const { connection, catalog, selectedProfileId, select, refresh, error, loading } = useAssetsStore();
  const [edit, setEdit] = useState(''), [name, setName] = useState(''), [kind, setKind] = useState<AssetType>('String');
  const [value, setValue] = useState(''), [username, setUsername] = useState(''), [password, setPassword] = useState('');
  const [profileName, setProfileName] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  const selected = catalog.profiles.find(p => p.id === selectedProfileId);
  const items = catalog.assets.filter(a => a.profileId === selectedProfileId);
  const existing = items.find(a => a.name === edit);
  const clear = () => { setEdit(''); setName(''); setKind('String'); setValue(''); setUsername(''); setPassword(''); };
  useEffect(() => { clear(); setMessage(''); }, [selectedProfileId]);
  const update = async (path: string, body: unknown) => {
    if (!connection) return;
    setBusy(true); setMessage('');
    try { await assetsRequest(connection, path, body); setValue(''); setUsername(''); setPassword(''); await refresh(); setMessage('Saved in Maestro. New runs read the updated value.'); return true; }
    catch (e) { setMessage(e instanceof Error ? e.message : 'Asset request failed.'); return false; }
    finally { setBusy(false); }
  };
  return <section className="assets-panel" aria-label="Assets and environments">
    <header><div><strong>Assets & Credentials</strong><small>Central Maestro values · secrets stay outside workflow packages</small></div><button disabled={loading || busy || !connection} onClick={() => void refresh()}>Refresh assets</button></header>
    {(error || message) && <div className="assets-notice" role={error ? 'alert' : 'status'}>{error || message}</div>}
    <div className="assets-environment"><label>Environment<select aria-label="Asset environment" value={selectedProfileId} disabled={busy} onChange={e => select(e.target.value)}>{catalog.profiles.map(p => <option key={p.id} value={p.id}>{p.name}{p.enabled ? '' : ' · Disabled'}</option>)}</select></label><small>Used by local Run and Debug. Robot Jobs chooses its environment separately.</small><input aria-label="New environment name" placeholder="New environment name" value={profileName} disabled={busy} onChange={e => setProfileName(e.target.value)} /><button disabled={busy || !profileName.trim() || !connection} onClick={async () => { if (await update('/profiles', { name: profileName.trim(), enabled: true })) setProfileName(''); }}>Add environment</button><button disabled={busy || !selected || selected.id === 'default'} onClick={() => selected && void update('/profiles', { ...selected, enabled: !selected.enabled })}>{selected?.enabled === false ? 'Enable environment' : 'Disable environment'}</button></div>
    <div className="assets-columns"><div className="assets-list"><div className="assets-list-heading"><strong>{selected?.name ?? 'Environment unavailable'}</strong><button disabled={busy} onClick={clear}>New asset</button></div>{!items.length && <p>No assets in this environment. Add a value or credential to start.</p>}{items.map(a => <button key={a.name} className={edit === a.name ? 'assets-selected' : ''} disabled={busy} onClick={() => { setEdit(a.name); setName(a.name); setKind(a.type); setValue(a.value === undefined ? '' : typeof a.value === 'string' ? a.value : JSON.stringify(a.value)); setUsername(''); setPassword(''); setMessage(''); }}><strong>{a.name}</strong><span>{a.type} · revision {a.revision}</span><small>{['Secret', 'Credential'].includes(a.type) ? 'Protected · value hidden' : JSON.stringify(a.value)?.slice(0, 110)}</small></button>)}</div>
      <form className="assets-editor" aria-label="Asset editor" onSubmit={async e => {
        e.preventDefault(); let parsed: unknown = value;
        try { if (kind === 'Credential') parsed = { username, password }; else if (!['String', 'Secret'].includes(kind)) parsed = JSON.parse(value); }
        catch { setMessage('Enter a JSON value matching the selected type.'); return; }
        if (await update('/values', { profileId: selectedProfileId, name, type: kind, value: parsed, revision: existing?.revision ?? 0 })) clear();
      }}><strong>{edit ? 'Update ' + edit : 'New asset'}</strong><label>Asset name<input aria-label="Asset name" value={name} disabled={busy || !!edit} onChange={e => setName(e.target.value)} placeholder="ERP_URL" /></label><label>Asset type<select aria-label="Asset type" value={kind} disabled={busy || !!edit} onChange={e => { setKind(e.target.value as AssetType); setValue(''); setUsername(''); setPassword(''); }}>{assetTypes.map(t => <option key={t}>{t}</option>)}</select></label>
        {kind === 'Credential' ? <><label>Username<input aria-label="Credential username" type="password" value={username} autoComplete="off" disabled={busy} onChange={e => setUsername(e.target.value)} /></label><label>Password<input aria-label="Credential password" type="password" value={password} autoComplete="new-password" disabled={busy} onChange={e => setPassword(e.target.value)} /></label><small>Enter both fields to replace the credential. Saved values are never displayed.</small></> : <label>Value{kind === 'Secret' ? <input aria-label="Asset value" type="password" value={value} autoComplete="new-password" disabled={busy} onChange={e => setValue(e.target.value)} /> : <textarea aria-label="Asset value" rows={3} value={value} disabled={busy} placeholder={['String'].includes(kind) ? 'Value' : 'JSON value'} onChange={e => setValue(e.target.value)} />}</label>}
        <div className="assets-actions"><button disabled={busy || !selected?.enabled || !name || !connection}>{busy ? 'Saving…' : 'Save asset'}</button>{existing && <button type="button" disabled={busy || !selected?.enabled} onClick={async () => { if (await update('/values', { profileId: selectedProfileId, name: existing.name, revision: existing.revision, delete: true })) clear(); }}>Delete asset</button>}</div>
      </form></div>
  </section>;
}
