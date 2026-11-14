import type { AssetResolver } from '../../src/shared/assets';
import type { RobotTrigger } from './jobRegistry';
export function robotAssetResolver(trigger: RobotTrigger, serverUrl: string, apiKey: string, signal: AbortSignal): AssetResolver | undefined {
  const context = trigger.assetContext;
  if (!context) return undefined;
  if (new URL(context.serverUrl).origin !== new URL(serverUrl).origin || context.jobId !== trigger.jobId || !context.token) throw Error('Job asset context does not belong to the connected Maestro server.');
  const url = new URL('/api/v1/robot-jobs/' + encodeURIComponent(trigger.jobId) + '/assets/resolve', serverUrl);
  const cache = new Map<string, Awaited<ReturnType<AssetResolver>>>();
  return async (name, type) => {
    const key = type + ':' + name;
    if (signal.aborted) throw Error('Job stopped.');
    if (!cache.has(key)) {
      const controller = new AbortController(), abort = () => controller.abort();
      signal.addEventListener('abort', abort, { once: true });
      const timeout = setTimeout(abort, 12000);
      try {
        const response = await fetch(url, { method: 'POST', redirect: 'error', signal: controller.signal, headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey, 'X-Runway-Job-Token': context.token }, body: JSON.stringify({ name, type }) });
        const text = await response.text();
        if (!response.ok || text.length > 150000) throw Error();
        const data = JSON.parse(text);
        if (data.ok !== true || !data.asset) throw Error();
        cache.set(key, data.asset);
      } catch { throw Error('Maestro could not resolve the required asset for this job and environment.'); }
      finally { clearTimeout(timeout); signal.removeEventListener('abort', abort); }
    }
    return structuredClone(cache.get(key)!);
  };
}
