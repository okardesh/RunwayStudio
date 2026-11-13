import { create } from 'zustand';
import { jobIsTerminal, jobSecrets, redactJobValue, type RobotJobView, type RobotJobRequest, type JobPackageChoice, type RobotChoice } from '../shared/robotJobs';
import { useExecutionHistoryStore, snapshot, type ExecutionRun } from './executionHistoryStore';
import { readRobotJob, submitRobotJob } from '../engine/robotJobsClient';
import type { RunwayConnection } from '../engine/runwayConnection';

export interface RemoteJob extends RobotJobView {
  serverUrl: string; tenantId: string; robotName: string; workflowName: string; version: string; packageId: string;
  inputPreview: unknown; connectionError?: string;
}
const historyId = (j: RemoteJob) => `robot:${j.serverUrl}:${j.tenantId}:${j.jobId}`;
function safeJob(job: RemoteJob, secrets: string[] = []): RemoteJob {
  const preview = (value: unknown) => { const safe = snapshot(value, secrets); return (JSON.stringify(safe)?.length ?? 0) > 100000 ? '[Preview exceeds 100 KB; omitted from local history.]' : safe; };
  return { ...job, inputPreview: preview(job.inputPreview), outputs: preview(job.outputs), error: job.error ? String(snapshot(job.error, secrets)) : undefined,
    logs: job.logs.slice(-300).map(l => ({ ...l, message: String(snapshot(l.message, secrets)) })),
    workflowCalls: job.workflowCalls?.slice(0, 100).map(c => ({ ...c, name: String(snapshot(c.name, secrets)) })) };
}
function publish(job: RemoteJob) {
  const run: ExecutionRun = { id: historyId(job), projectName: job.workflowName, filePath: null,
    startedAt: job.startedAt, endedAt: job.completedAt, debug: false,
    status: job.status === 'success' ? 'completed' : job.status === 'failed' ? 'error' : job.status === 'stopped' ? 'stopped' : 'running',
    arguments: { inputs: job.inputPreview, outputs: job.outputs }, error: job.error, steps: [], robotJob: job };
  useExecutionHistoryStore.getState().publish(run, true);
}
interface JobsState {
  jobs: RemoteJob[]; selectedId: string | null; launching: boolean;
  pending: RobotJobRequest | null; pendingMeta: { robot: RobotChoice; pkg: JobPackageChoice; serverUrl: string; tenant: string } | null;
  launch: (connection: RunwayConnection, request: RobotJobRequest, robot: RobotChoice, pkg: JobPackageChoice) => Promise<string>;
  update: (job: RemoteJob) => void;
}
export const useRobotJobsStore = create<JobsState>((set, get) => ({
  jobs: useExecutionHistoryStore.getState().runs.flatMap(r => r.robotJob ? [r.robotJob] : []), selectedId: null, launching: false, pending: null, pendingMeta: null,
  update: job => { const safe = safeJob(job); set(s => {
    const all = [safe, ...s.jobs.filter(j => historyId(j) !== historyId(safe))];
    const active = all.filter(j => !jobIsTerminal(j.status));
    return { jobs: [...active, ...all.filter(j => jobIsTerminal(j.status)).slice(0, Math.max(0, 20 - active.length))] };
  }); publish(safe); },
  launch: async (connection, request, robot, pkg) => {
    if (get().launching) throw Error('A launch request is already in progress.');
    if (!get().pending && get().jobs.filter(j => !jobIsTerminal(j.status)).length >= 10) throw Error('Ten jobs are already being monitored. Finish or stop a job before launching another.');
    set({ launching: true, pending: request, pendingMeta: { robot, pkg, serverUrl: connection.serverUrl, tenant: connection.organizationId } });
    try {
      const jobId = await submitRobotJob(connection, request);
      const job: RemoteJob = { jobId, status: 'queued', startedAt: Date.now(), logs: [], serverUrl: connection.serverUrl, tenantId: connection.organizationId,
        robotName: robot.name, workflowName: pkg.name, version: pkg.version, packageId: pkg.packageId, inputPreview: snapshot(redactJobValue(request.inputs, jobSecrets(request.inputs))) };
      get().update(job); set({ selectedId: historyId(job), pending: null, pendingMeta: null }); return jobId;
    } finally { set({ launching: false }); }
  },
}));

const inFlight = new Set<string>();
// Polling is independent of the selected tab. Failures never change a job to a terminal status.
export async function pollRobotJobs(connection: RunwayConnection) {
  const jobs = useRobotJobsStore.getState().jobs.filter(j => j.serverUrl === connection.serverUrl && j.tenantId === connection.organizationId && !jobIsTerminal(j.status));
  await Promise.all(jobs.map(async original => {
    const id = historyId(original); if (inFlight.has(id)) return; inFlight.add(id);
    try {
      const view = await readRobotJob(connection, original.jobId);
      const latest = useRobotJobsStore.getState().jobs.find(j => historyId(j) === id) ?? original;
      if (!jobIsTerminal(latest.status)) useRobotJobsStore.getState().update({ ...latest, ...view, connectionError: undefined });
    } catch (error) {
      const latest = useRobotJobsStore.getState().jobs.find(j => historyId(j) === id) ?? original;
      if (!jobIsTerminal(latest.status)) useRobotJobsStore.getState().update({ ...latest, connectionError: error instanceof Error ? error.message : 'Status unavailable.' });
    } finally { inFlight.delete(id); }
  }));
}
export async function stopRobotJob(connection: RunwayConnection, job: RemoteJob) {
  const id = historyId(job);
  if (connection.serverUrl !== job.serverUrl || connection.organizationId !== job.tenantId) throw Error('Reconnect to this job’s Runway server before stopping it.');
  const view = await readRobotJob(connection, job.jobId, true);
  const latest = useRobotJobsStore.getState().jobs.find(j => historyId(j) === id) ?? job;
  if (!jobIsTerminal(latest.status)) useRobotJobsStore.getState().update({ ...latest, ...view, connectionError: undefined });
}
export const robotJobHistoryId = historyId;
