import { executeRobotWorkflow, RobotJobStoppedError, type RobotActivity, type RobotWorkflowResult } from './workflowRuntime';
import { createHash } from 'node:crypto';
import { jobIsTerminal, jobSecrets, redactJobValue, type RobotJobView } from '../../src/shared/robotJobs';

export interface RobotTrigger {
  jobId: string; workflowId?: string; workflow?: { definition?: unknown } | Record<string, unknown>;
  definition?: unknown; inputs?: Record<string, unknown>; callbackUrl: string;
}
interface Entry { trigger: RobotTrigger; view: RobotJobView; controller: AbortController; secrets: Set<string>; fingerprint: string; result?: RobotWorkflowResult }
/** All control is cooperative: an active native activity finishes before cancellation takes effect. */
export class RobotJobRegistry {
  private entries = new Map<string, Entry>();
  private queue: Entry[] = [];
  private active: Entry | undefined;
  constructor(private native: RobotActivity, private complete: (trigger: RobotTrigger, view: RobotJobView, result?: RobotWorkflowResult) => Promise<void>) {}
  get running() { return !!this.active; }
  get queued() { return this.queue.length; }
  get(jobId: string): RobotJobView | undefined {
    const entry = this.entries.get(jobId);
    if (!entry) return undefined;
    const view = structuredClone(entry.view);
    view.outputs = redactJobValue(view.outputs, entry.secrets);
    view.error = view.error ? String(redactJobValue(view.error, entry.secrets)) : undefined;
    view.logs = view.logs.map(l => ({ ...l, message: String(redactJobValue(l.message, entry.secrets)) }));
    return view;
  }
  submit(trigger: RobotTrigger) {
    const fingerprint = createHash('sha256').update(JSON.stringify(trigger)).digest('hex');
    if (this.entries.has(trigger.jobId)) {
      if (this.entries.get(trigger.jobId)!.fingerprint !== fingerprint) throw Error('Job ID already belongs to a different request.');
      return this.get(trigger.jobId)!;
    }
    if (this.queue.length >= 10) throw Error('Robot job queue is full.');
    // Bound retained job data; never remove running/queued jobs.
    for (const [id, entry] of this.entries) if (this.entries.size >= 20 && jobIsTerminal(entry.view.status)) this.entries.delete(id);
    const entry: Entry = { trigger, fingerprint, secrets: jobSecrets(trigger.inputs), controller: new AbortController(), view: { jobId: trigger.jobId, status: 'queued', startedAt: Date.now(), logs: [] } };
    this.entries.set(trigger.jobId, entry); this.queue.push(entry);
    const accepted = this.get(trigger.jobId)!;
    void this.drain(); return accepted;
  }
  async stop(jobId: string) {
    const entry = this.entries.get(jobId); if (!entry) return undefined;
    if (jobIsTerminal(entry.view.status) || entry.view.status === 'stopping') return this.get(jobId);
    entry.controller.abort();
    if (entry === this.active) { entry.view.status = 'stopping'; this.log(entry, 'info', 'Stop requested. Waiting for the current activity to finish.'); }
    else {
      this.queue = this.queue.filter(e => e !== entry);
      entry.view.status = 'stopped'; entry.view.completedAt = Date.now();
      this.log(entry, 'info', 'Queued job stopped before execution.');
      await this.notify(entry);
      entry.trigger = { jobId, callbackUrl: '' };
    }
    return this.get(jobId);
  }
  private log(entry: Entry, level: 'info' | 'error', message: string) {
    const logs = entry.view.logs;
    logs.push({ sequence: (logs[logs.length - 1]?.sequence ?? 0) + 1, timestamp: new Date().toISOString(), level, message: message.slice(0, 2000) });
    if (logs.length > 300) logs.shift();
  }
  private async notify(entry: Entry) {
    try { await this.complete(entry.trigger, this.get(entry.trigger.jobId)!, entry.result); }
    catch { this.log(entry, 'error', 'Runway completion callback could not be delivered. Result remains available on this Robot.'); }
  }
  private async drain() {
    if (this.active) return;
    const entry = this.queue.shift(); if (!entry) return;
    this.active = entry; entry.view.status = 'running';
    try {
      this.log(entry, 'info', 'Robot started the job.');
      const { trigger } = entry;
      const definition = trigger.definition ?? (trigger.workflow && 'definition' in trigger.workflow ? trigger.workflow.definition : trigger.workflow);
      entry.result = await executeRobotWorkflow(definition, trigger.inputs ?? {}, this.native, (level, message) => this.log(entry, level, message), { signal: entry.controller.signal, live: true, onSecret: secret => entry.secrets.add(secret) });
      entry.view.status = 'success'; entry.view.outputs = entry.result.outputs;
      jobSecrets(entry.result.outputs, entry.secrets);
      entry.view.package = entry.result.package; entry.view.workflowCalls = entry.result.calls;
      this.log(entry, 'info', 'Job completed successfully.');
    } catch (reason) {
      const stopped = reason instanceof RobotJobStoppedError;
      entry.view.status = stopped ? 'stopped' : 'failed';
      entry.view.error = stopped ? undefined : reason instanceof Error ? reason.message : 'Workflow execution failed.';
      this.log(entry, stopped ? 'info' : 'error', stopped ? 'Job stopped at an activity boundary.' : entry.view.error!);
    } finally {
      entry.view.completedAt = Date.now(); await this.notify(entry);
      // Inputs/definition are no longer retained after reporting.
      entry.trigger = { jobId: entry.trigger.jobId, callbackUrl: '' }; entry.result = undefined;
      this.active = undefined; void this.drain();
    }
  }
}
