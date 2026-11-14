import type { RunwayConnection } from './runwayConnection';
import type { RobotJobCatalog, RobotJobRequest, RobotJobView } from '../shared/robotJobs';
import { supportedArgumentType, validArgumentName } from '../shared/invokedWorkflows';

export async function robotJobsRequest(connection: RunwayConnection, path: string, method: 'GET' | 'POST' = 'GET', payload?: unknown): Promise<any> {
  if (!connection.accessToken) throw Error('Reconnect Studio to Runway before using Robot Jobs.');
  const url = new URL('/api/v1/robot-jobs' + path, connection.serverUrl);
  if (!['http:', 'https:'].includes(url.protocol)) throw Error('Runway URL must use HTTP or HTTPS.');
  let result: { status: number; body: string; networkError?: boolean };
  try {
    const bridge = (window as any).electronAPI?.requestRobotJobs;
    if (bridge) result = await bridge(url.toString(), connection.accessToken, connection.organizationId, method, payload);
    else {
      const response = await fetch(url, { method, redirect: 'error', signal: AbortSignal.timeout(15000), headers: { 'Content-Type': 'application/json', 'X-API-Key': connection.accessToken, 'X-Tenant-Id': connection.organizationId }, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) });
      result = { status: response.status, body: await response.text() };
    }
    if (result.networkError) throw Error();
  } catch { throw Error('Runway could not be reached. The job may still be running. Reconnect to check its status.'); }
  if (result.status === 401 || result.status === 403) throw Error('Runway denied Robot Jobs access. Reconnect Studio or check your permissions.');
  if (result.status === 404) throw Error('Robot Jobs is unavailable on this Runway server, or the job is no longer retained.');
  if (result.status < 200 || result.status >= 300) throw Error(`Robot Jobs request failed (${result.status}). Refresh the catalog or reconnect; do not launch a duplicate job.`);
  if (result.body.length > 4_000_000) throw Error('Runway returned too much job data.');
  let data;
  try { data = JSON.parse(result.body); } catch { throw Error('Runway returned invalid Robot Jobs data.'); }
  if (data?.ok !== true) throw Error('Runway did not confirm the Robot Jobs request.');
  return data;
}
export async function fetchRobotJobCatalog(connection: RunwayConnection): Promise<RobotJobCatalog> {
  const data = await robotJobsRequest(connection, '/catalog');
  if (data.schemaVersion !== 1 || !Array.isArray(data.robots) || !Array.isArray(data.packages) || data.robots.length > 1000 || data.packages.length > 1000
    || data.robots.some((r: any) => !r || typeof r.id !== 'string' || typeof r.name !== 'string' || typeof r.online !== 'boolean')
    || data.packages.some((p: any) => !p || typeof p.workflowId !== 'string' || typeof p.name !== 'string' || typeof p.version !== 'string' || typeof p.packageId !== 'string' || !Array.isArray(p.inputArguments) || p.inputArguments.length > 100
      || p.inputArguments.some((a: any) => !a || typeof a.name !== 'string' || !validArgumentName(a.name) || typeof a.type !== 'string' || !supportedArgumentType(a.type) || a.direction !== 'In')
      || new Set(p.inputArguments.map((a: any) => a.name)).size !== p.inputArguments.length)) throw Error('Runway returned an unsupported Robot Jobs catalog.');
  return data;
}
export async function submitRobotJob(connection: RunwayConnection, request: RobotJobRequest): Promise<string> {
  const data = await robotJobsRequest(connection, '', 'POST', request);
  if (typeof data.jobId !== 'string' || !/^[a-zA-Z0-9_-]{1,120}$/.test(data.jobId)) throw Error('Runway did not return a valid job ID.');
  return data.jobId;
}
export async function readRobotJob(connection: RunwayConnection, jobId: string, stop = false): Promise<RobotJobView> {
  const data = await robotJobsRequest(connection, '/' + encodeURIComponent(jobId) + (stop ? '/stop' : ''), stop ? 'POST' : 'GET');
  const j = data.job;
  if (!j || j.jobId !== jobId || !['queued', 'running', 'waiting', 'stopping', 'stopped', 'success', 'failed'].includes(j.status) || !Number.isFinite(j.startedAt) || j.completedAt !== undefined && !Number.isFinite(j.completedAt) || !Array.isArray(j.logs) || j.logs.length > 2000 || j.logs.some((l: any) => !Number.isSafeInteger(l.sequence) || typeof l.timestamp !== 'string' || !['info', 'error'].includes(l.level) || typeof l.message !== 'string')) throw Error('Runway returned invalid job status data.');
  return j;
}
