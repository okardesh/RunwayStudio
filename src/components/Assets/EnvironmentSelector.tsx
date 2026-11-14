import { useEffect } from 'react';
import type { RunwayConnection } from '../../engine/runwayConnection';
import { useAssetsStore } from '../../store/assetsStore';

export function EnvironmentIndicator() {
  const { catalog, selectedProfileId, select, refresh, loading, error } = useAssetsStore();
  if (!catalog.profiles.length && !error) return null;
  return <select aria-label="Run environment" title={error || 'Environment for local Run or Debug. Manage environments and assets in Runway.'}
    value={selectedProfileId} disabled={loading || !!error} onChange={event => { select(event.target.value); void refresh(); }}
    style={{ maxWidth: 190, border: '1px solid var(--studio-border)', borderRadius: 6, background: 'var(--studio-panel)', color: 'var(--studio-muted)', padding: '6px 8px', fontSize: 11 }}>
    {!catalog.profiles.some(p => p.id === selectedProfileId) && <option value={selectedProfileId}>{error ? 'Environment unavailable' : selectedProfileId + ' · Unavailable'}</option>}
    {catalog.profiles.map(profile => <option key={profile.id} value={profile.id} disabled={!profile.enabled}>{profile.name}{profile.enabled ? '' : ' · Disabled'}</option>)}
  </select>;
}

export function AssetsMonitor({ connection }: { connection: RunwayConnection | null }) {
  useEffect(() => { const state = useAssetsStore.getState(); state.setConnection(connection); void state.refresh(); return () => useAssetsStore.getState().setConnection(null); }, [connection]);
  return null;
}
