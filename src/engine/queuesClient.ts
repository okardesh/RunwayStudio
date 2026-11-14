import type { RunwayConnection } from './runwayConnection';
import { QueueRunSession, QueueTransportError } from '../shared/queues';
export async function queuesRequest(connection: RunwayConnection, suffix = '', payload?: unknown, sessionId?: string) {
  if (!connection.accessToken) throw new QueueTransportError('Connect Studio to Maestro before using queues.');
  const url = new URL('/api/v1/studio-queues' + suffix, connection.serverUrl).toString();
  let result;
  try {
    const bridge = (window as any).electronAPI?.requestStudioQueues;
    if (bridge) result = await bridge(url, connection.accessToken, connection.organizationId, payload === undefined ? 'GET' : 'POST', payload, sessionId);
    else { const r = await fetch(url, { method: payload === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(12000), headers: { 'X-API-Key': connection.accessToken, 'X-Tenant-Id': connection.organizationId, 'X-Runway-Queue-Session': sessionId ?? '', 'Content-Type': 'application/json' }, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) }); result = { status: r.status, body: await r.text() }; }
    if (result.networkError) throw Error();
  } catch { throw new QueueTransportError('Maestro could not confirm the queue operation.', true); }
  if (result.status < 200 || result.status >= 300) throw new QueueTransportError(result.status === 404 ? 'Update Maestro to enable queues.' : 'Maestro rejected the queue operation. Check the queue, reference and transaction ownership.', result.status >= 500);
  try { if (result.body.length > 2000000) throw Error(); const data = JSON.parse(result.body); if (data.ok !== true) throw Error(); return data; }
  catch { throw new QueueTransportError('Maestro returned an invalid queue response.', true); }
}
export function createQueueSession(connection: RunwayConnection, profileId: string) {
  const sessionId = 'run_' + crypto.randomUUID();
  return new QueueRunSession(async payload => queuesRequest(connection, '/operate', { ...payload, profileId }, sessionId));
}
