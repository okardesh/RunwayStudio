import { auditToken } from '../../server/maestro_ui/auditIdentity';
import type { RunwayConnection } from './runwayConnection';
import { assetTypes, validAssetName, type AssetCatalog, type AssetResolver, type AssetType } from '../shared/assets';
export async function assetsRequest(connection: RunwayConnection, path = '', payload?: unknown): Promise<any> {
  if (!connection.accessToken) throw Error('Connect Studio to Maestro before using assets.');
  const url = new URL('/api/v1/studio-assets' + path, connection.serverUrl).toString();
  const personalToken = auditToken(connection.serverUrl + '|' + connection.organizationId);
  let result;
  try {
    const bridge = (window as any).electronAPI?.requestStudioAssets;
    if (bridge) result = await bridge(url, connection.accessToken, connection.organizationId, payload === undefined ? 'GET' : 'POST', payload, personalToken);
    else { const response = await fetch(url, { method: payload === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(12000), headers: { 'X-API-Key': connection.accessToken, 'X-Tenant-Id': connection.organizationId, 'Content-Type': 'application/json', 'X-Runway-Task-Token': personalToken }, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) }); result = { status: response.status, body: await response.text() }; }
    if (result.networkError) throw Error();
  } catch { throw Error('Maestro assets could not be reached. No fallback environment was used.'); }
  if (result.status === 409) throw Error('This asset changed. Refresh its details before saving.');
  if (result.status === 401 || result.status === 403) throw Error('Maestro denied access to assets. Reconnect or check your permissions.');
  if (result.status === 404) throw Error('Update Maestro to enable centralized assets.');
  if (result.status < 200 || result.status >= 300) throw Error('Maestro rejected the asset request. Check the environment, name, type and value.');
  let data;
  try { if (result.body.length > 2000000) throw Error(); data = JSON.parse(result.body); } catch { throw Error('Maestro returned invalid asset data.'); }
  if (data.ok !== true) throw Error('Maestro did not confirm the asset request.');
  return data;
}
export async function fetchAssets(connection: RunwayConnection): Promise<AssetCatalog> {
  const data = await assetsRequest(connection);
  if (!Array.isArray(data.profiles) || !Array.isArray(data.assets) || data.profiles.some((p: any) => !p || typeof p.id !== 'string' || typeof p.name !== 'string' || typeof p.enabled !== 'boolean')
    || data.assets.some((a: any) => !a || !validAssetName(a.name) || !assetTypes.includes(a.type) || typeof a.profileId !== 'string' || !Number.isSafeInteger(a.revision) || a.revision < 1)) throw Error('Maestro returned an invalid asset catalog.');
  // Even a malformed server response must not place protected values in a UI store.
  return { profiles: data.profiles, assets: data.assets.map((a: any) => { const { value, ...meta } = a; return ['Secret', 'Credential'].includes(a.type) ? meta : { ...meta, value }; }) };
}
export function createAssetResolver(connection: RunwayConnection, profileId: string): AssetResolver {
  const cache = new Map<string, Awaited<ReturnType<AssetResolver>>>();
  return async (name: string, type: AssetType) => {
    const key = type + ':' + name;
    if (!cache.has(key)) { const data = await assetsRequest(connection, '/resolve', { profileId, name, type }); cache.set(key, data.asset); }
    return structuredClone(cache.get(key)!);
  };
}
