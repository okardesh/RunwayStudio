import type { RobotTrigger } from './jobRegistry';
export function robotHumanClient(trigger: RobotTrigger, serverUrl: string, apiKey: string) {
  if (!trigger.assetContext || new URL(trigger.assetContext.serverUrl).origin !== new URL(serverUrl).origin) return undefined;
  return async (data: Record<string, unknown>) => {
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await fetch(new URL('/api/v1/robot-jobs/' + trigger.jobId + '/human/create', serverUrl), { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(12000), headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey, 'X-Runway-Job-Token': trigger.assetContext!.token }, body: JSON.stringify(data) });
        const result = await r.json(); if (!r.ok || !result.ok || !result.task) throw Error('Maestro did not confirm the human task.'); return result.task;
      } catch { if (attempt) throw Error('Human task creation could not be confirmed. Stop and recover the existing job; do not create duplicate work.'); }
    }
  };
}
