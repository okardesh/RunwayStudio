import { useCallback } from 'react';
import MaestroAudit from '../../../server/maestro_ui/MaestroAudit';
import type { RunwayConnection } from '../../engine/runwayConnection';
export function AuditPanel({ connection }: { connection: RunwayConnection | null }) {
  const request = useCallback(async (query: string, token: string) => {
    if (!connection) throw Error('Connect Studio to Maestro first.');
    const url = new URL('/api/v1/audit?' + query, connection.serverUrl).toString();
    const bridge = (window as any).electronAPI?.requestAudit;
    let result;
    if (bridge) result = await bridge(url, connection.accessToken, connection.organizationId, token);
    else { const r = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(12000), headers: { 'X-API-Key': connection.accessToken ?? '', 'X-Tenant-Id': connection.organizationId, 'X-Runway-Task-Token': token } }); result = { status: r.status, body: await r.text() }; }
    if (result.networkError) throw Error('Maestro audit could not be reached.');
    const data = JSON.parse(result.body); if (result.status !== 200 || !data.ok) throw Error(data.error || 'Audit request failed.'); return data;
  }, [connection]);
  return connection ? <MaestroAudit key={connection.serverUrl + connection.organizationId} scope={connection.serverUrl + '|' + connection.organizationId} request={request} /> : <div className="bp-empty">Connect Studio to Maestro to view the Audit Log.</div>;
}
