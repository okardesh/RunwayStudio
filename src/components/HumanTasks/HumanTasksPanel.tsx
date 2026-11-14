import { useCallback } from 'react';
import MaestroHumanTasks from '../../../server/maestro_ui/MaestroHumanTasks';
import type { RunwayConnection } from '../../engine/runwayConnection';
export function HumanTasksPanel({ connection }: { connection: RunwayConnection | null }) {
  const request = useCallback(async (route: string, body?: unknown, personalToken?: string) => {
    if (!connection) throw Error('Connect to Maestro first.');
    const url = new URL(route, connection.serverUrl).toString(), method = body === undefined ? 'GET' : 'POST';
    const bridge = (window as any).electronAPI?.requestHumanTasks;
    let result;
    if (bridge) result = await bridge(url, connection.accessToken, connection.organizationId, method, body, personalToken);
    else { const r = await fetch(url, { method, signal: AbortSignal.timeout(12000), redirect: 'error', headers: { 'Content-Type': 'application/json', 'X-API-Key': connection.accessToken ?? '', 'X-Tenant-Id': connection.organizationId, 'X-Runway-Task-Token': personalToken ?? '' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); result = { status: r.status, body: await r.text() }; }
    if (result.networkError) throw Error('Human task operation could not be confirmed.');
    const data = JSON.parse(result.body); if (result.status < 200 || result.status >= 300 || !data.ok) { const error = Object.assign(Error(data.error || 'Human task request failed.'), { confirmed: result.status > 0 && result.status < 500 }); throw error; } return data;
  }, [connection]);
  return connection ? <MaestroHumanTasks request={request} /> : <div className="bp-empty">Connect Studio to Maestro to review human tasks.</div>;
}
