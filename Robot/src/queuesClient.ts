import type { RobotTrigger } from './jobRegistry';
import { QueueRunSession, QueueTransportError } from '../../src/shared/queues';
export function robotQueueSession(trigger: RobotTrigger, serverUrl: string, apiKey: string, signal: AbortSignal) {
  const c = trigger.assetContext; if (!c) return undefined;
  if (new URL(c.serverUrl).origin !== new URL(serverUrl).origin || c.jobId !== trigger.jobId) throw Error('Queue context does not belong to the connected Maestro server.');
  return new QueueRunSession(async (payload, cleanup) => {
    const controller = new AbortController(), abort = () => controller.abort();
    if (!cleanup) { if (signal.aborted) throw new QueueTransportError('Job stopped.'); signal.addEventListener('abort', abort, { once: true }); }
    const timer = setTimeout(abort, 12000);
    let response, text;
    try { response = await fetch(new URL('/api/v1/robot-jobs/' + trigger.jobId + '/queues/operate', serverUrl), { method: 'POST', redirect: 'error', signal: controller.signal, headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey, 'X-Runway-Job-Token': c.token }, body: JSON.stringify(payload) }); text = await response.text(); }
    catch { throw new QueueTransportError('Maestro could not confirm the queue operation.', true); }
    finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
    if (!response.ok) throw new QueueTransportError('Queue operation was rejected or transaction ownership was lost.', response.status >= 500);
    try { const data = JSON.parse(text); if (!data.ok || text.length > 2000000) throw Error(); return data; }
    catch { throw new QueueTransportError('Maestro returned invalid queue data.', true); }
  });
}
