import { create } from 'zustand';
import type { AssetCatalog } from '../shared/assets';
import type { RunwayConnection } from '../engine/runwayConnection';
import { fetchAssets, createAssetResolver } from '../engine/assetsClient';
const empty: AssetCatalog = { profiles: [], assets: [] };
const storageKey = (c: RunwayConnection) => `runway.assets.environment:${c.serverUrl}:${c.organizationId}`;
interface AssetsState { catalog: AssetCatalog; connection: RunwayConnection | null; selectedProfileId: string; error: string; loading: boolean; setConnection: (c: RunwayConnection | null) => void; select: (id: string) => void; refresh: () => Promise<void> }
export const useAssetsStore = create<AssetsState>((set, get) => ({
  catalog: empty, connection: null, selectedProfileId: 'default', error: '', loading: false,
  setConnection: c => { let selectedProfileId = 'default'; try { if (c) selectedProfileId = localStorage.getItem(storageKey(c)) || 'default'; } catch { /* Session selection. */ } set({ connection: c, selectedProfileId, catalog: empty, error: '' }); },
  select: id => { const c = get().connection; try { if (c) localStorage.setItem(storageKey(c), id); } catch { /* Session selection. */ } set({ selectedProfileId: id }); },
  refresh: async () => {
    const c = get().connection; if (!c) return; set({ loading: true, error: '' });
    try { const catalog = await fetchAssets(c); if (get().connection === c) set({ catalog }); }
    catch (e) { if (get().connection === c) set({ catalog: empty, error: e instanceof Error ? e.message : 'Assets unavailable.' }); }
    finally { if (get().connection === c) set({ loading: false }); }
  },
}));
export function assetRunContext() {
  const { connection, selectedProfileId, catalog } = useAssetsStore.getState();
  return { environment: { id: selectedProfileId, name: catalog.profiles.find(p => p.id === selectedProfileId)?.name ?? selectedProfileId }, resolve: connection ? createAssetResolver({ ...connection }, selectedProfileId) : undefined };
}
