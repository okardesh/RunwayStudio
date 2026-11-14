import { executeRobotWorkflow, RobotJobStoppedError, type RobotActivity, type RobotWorkflowResult } from './workflowRuntime';
import { createHash } from 'node:crypto';
import type { AssetResolver } from '../../src/shared/assets';
import type { QueueRunSession } from '../../src/shared/queues';
import { HumanTaskSuspended, type HumanCheckpoint, type HumanResume } from '../../src/shared/humanTasks';
import type { JobJournal, JournalEntry } from './jobJournal';
import { jobIsTerminal, jobSecrets, redactJobValue, type RobotJobView } from '../../src/shared/robotJobs';

export interface RobotTrigger {
  jobId: string; workflowId?: string; workflow?: { definition?: unknown } | Record<string, unknown>;
  definition?: unknown; inputs?: Record<string, unknown>; callbackUrl: string;
  environment?: { id: string; name: string };
  assetContext?: { serverUrl: string; jobId: string; token: string };
  resume?: HumanResume; previous?: RobotJobView;
}
interface Entry { trigger: RobotTrigger; view: RobotJobView; controller: AbortController; secrets: Set<string>; fingerprint: string; result?: RobotWorkflowResult; checkpoint?: HumanCheckpoint }
/** All control is cooperative: an active native activity finishes before cancellation takes effect. */
export class RobotJobRegistry {
  private entries = new Map<string, Entry>();
  private queue: Entry[] = [];
  private active: Entry | undefined;
  private receipts = new Map<string, JournalEntry>();
  constructor(private native: RobotActivity, private complete: (trigger: RobotTrigger, view: RobotJobView, result?: RobotWorkflowResult, checkpoint?: HumanCheckpoint) => Promise<void>, private resolver?: (trigger: RobotTrigger, signal: AbortSignal) => AssetResolver | undefined, private queueFactory?: (trigger: RobotTrigger, signal: AbortSignal) => QueueRunSession | undefined, private humanFactory?: (trigger: RobotTrigger) => ((data: Record<string, unknown>) => Promise<any>) | undefined, private journal?: JobJournal) {
    for (const receipt of journal?.load() ?? []) {
      this.receipts.set(receipt.view.jobId, receipt);
      if (receipt.view.status === 'waiting' && receipt.checkpoint && receipt.callbackUrl) {
        const entry: Entry = { trigger: { jobId: receipt.view.jobId, callbackUrl: receipt.callbackUrl }, view: receipt.view, checkpoint: receipt.checkpoint, fingerprint: receipt.fingerprint, controller: new AbortController(), secrets: new Set() };
        this.entries.set(entry.view.jobId, entry);
        const timer = setTimeout(() => { if (this.entries.get(entry.view.jobId) === entry && entry.checkpoint) void this.notify(entry); }, 3000); timer.unref?.();
      }
    }
  }
  get running() { return !!this.active; }
  get queued() { return this.queue.length; }
  get(jobId: string): RobotJobView | undefined {
    const entry = this.entries.get(jobId);
    if (!entry) return this.receipts.has(jobId) ? structuredClone(this.receipts.get(jobId)!.view) : undefined;
    const view = structuredClone(entry.view);
    view.outputs = redactJobValue(view.outputs, entry.secrets);
    view.error = view.error ? String(redactJobValue(view.error, entry.secrets)) : undefined;
    view.logs = view.logs.map(l => ({ ...l, message: String(redactJobValue(l.message, entry.secrets)) }));
    return view;
  }
  submit(trigger: RobotTrigger) {
    const fingerprint = createHash('sha256').update(JSON.stringify(trigger)).digest('hex');
    if (trigger.resume) {
      const existing = this.get(trigger.jobId), receipt = this.receipts.get(trigger.jobId);
      if (existing?.resumeId === trigger.resume.checkpointId) return existing;
      if (existing && existing.status !== 'waiting') throw Error('This job is not waiting and cannot accept another checkpoint.');
      if (receipt && jobIsTerminal(receipt.view.status)) return receipt.view;
      this.entries.delete(trigger.jobId);
    } else if (this.receipts.has(trigger.jobId) && !this.entries.has(trigger.jobId)) return this.get(trigger.jobId)!;
    if (this.entries.has(trigger.jobId)) {
      if (this.entries.get(trigger.jobId)!.fingerprint !== fingerprint) throw Error('Job ID already belongs to a different request.');
      return this.get(trigger.jobId)!;
    }
    if (this.queue.length >= 10) throw Error('Robot job queue is full.');
    // Bound retained job data; never remove running/queued jobs.
    for (const [id, entry] of this.entries) if (this.entries.size >= 20 && jobIsTerminal(entry.view.status)) this.entries.delete(id);
    const entry: Entry = { trigger, fingerprint, secrets: jobSecrets(trigger.inputs), controller: new AbortController(), view: { ...(trigger.resume ? trigger.previous : {}), jobId: trigger.jobId, status: 'queued', startedAt: trigger.previous?.startedAt ?? Date.now(), logs: trigger.previous?.logs ?? [], environment: trigger.environment, completedAt: undefined, waitingTask: undefined, resumeId: trigger.resume?.checkpointId } };
    if (trigger.resume) {
      entry.view.humanTasks = [...entry.view.humanTasks ?? [], { taskId: String(trigger.resume.result.taskId), phase: 'resumed', decision: String(trigger.resume.result.decision), actor: String(trigger.resume.result.actor), at: Date.now() }];
      // Persist acceptance before any native activity. A crash is never an excuse to replay a checkpoint.
      this.persist(entry);
    }
    if (trigger.assetContext?.token) entry.secrets.add(trigger.assetContext.token);
    this.entries.set(trigger.jobId, entry); this.queue.push(entry);
    const accepted = this.get(trigger.jobId)!;
    void this.drain(); return accepted;
  }
  async stop(jobId: string) {
    const entry = this.entries.get(jobId); if (!entry) {
      const receipt = this.receipts.get(jobId);
      if (receipt && jobIsTerminal(receipt.view.status)) return receipt.view;
      const cancelled = { fingerprint: 'cancelled', view: { ...receipt?.view, jobId, status: 'stopped' as const, startedAt: receipt?.view.startedAt ?? Date.now(), completedAt: Date.now(), logs: receipt?.view.logs ?? [] } };
      this.journal?.save(cancelled); this.receipts.set(jobId, cancelled); return cancelled.view;
    }
    if (jobIsTerminal(entry.view.status) || entry.view.status === 'stopping') return this.get(jobId);
    entry.controller.abort();
    if (entry === this.active && entry.view.status !== 'waiting') { entry.view.status = 'stopping'; this.log(entry, 'info', 'Stop requested. Waiting for the current activity to finish.'); }
    else {
      this.queue = this.queue.filter(e => e !== entry);
      entry.view.status = 'stopped'; entry.view.completedAt = Date.now();
      entry.checkpoint = undefined;
      this.log(entry, 'info', 'Queued job stopped before execution.');
      this.persist(entry);
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
    try { await this.complete(entry.trigger, this.get(entry.trigger.jobId)!, entry.result, entry.checkpoint); entry.checkpoint = undefined; if (entry.view.status === 'waiting' && this.entries.get(entry.view.jobId) === entry) this.persist(entry); }
    catch {
      this.log(entry, 'error', 'Runway completion callback could not be delivered. Result remains available on this Robot.');
      if (entry.view.status === 'waiting' && entry.checkpoint) { const timer = setTimeout(() => { if (entry.checkpoint && entry.view.status === 'waiting' && this.entries.get(entry.view.jobId) === entry) void this.notify(entry); }, 3000); timer.unref?.(); }
    }
  }
  private persist(entry: Entry) {
    const receipt: JournalEntry = { fingerprint: entry.fingerprint, view: redactJobValue(entry.view, entry.secrets) as RobotJobView, ...(entry.checkpoint ? { checkpoint: entry.checkpoint, callbackUrl: entry.trigger.callbackUrl } : {}) };
    this.journal?.save(receipt); this.receipts.set(entry.view.jobId, receipt);
  }
  private async drain() {
    if (this.active) return;
    const entry = this.queue.shift(); if (!entry) return;
    this.active = entry; entry.view.status = 'running';
    let queues: QueueRunSession | undefined;
    let outcome: 'success' | 'failed' | 'stopped' | 'waiting' = 'failed';
    try {
      this.log(entry, 'info', 'Robot started the job.');
      const { trigger } = entry;
      queues = this.queueFactory?.(trigger, entry.controller.signal);
      const definition = trigger.definition ?? (trigger.workflow && 'definition' in trigger.workflow ? trigger.workflow.definition : trigger.workflow);
      entry.result = await executeRobotWorkflow(definition, trigger.inputs ?? {}, this.native, (level, message) => this.log(entry, level, message), { signal: entry.controller.signal, live: true, onSecret: secret => entry.secrets.add(secret), resolveAsset: this.resolver?.(trigger, entry.controller.signal), queueSession: queues, createTask: this.humanFactory?.(trigger), resume: trigger.resume, onHuman: event => { entry.view.humanTasks = [...entry.view.humanTasks ?? [], event].slice(-200); } });
      if (queues?.activeCount) throw Error('A claimed transaction has no committed result. Add Set Transaction Status.');
      outcome = 'success'; entry.view.outputs = entry.result.outputs;
      jobSecrets(entry.result.outputs, entry.secrets);
      entry.view.package = entry.result.package; entry.view.workflowCalls = [...entry.trigger.resume ? entry.trigger.previous?.workflowCalls ?? [] : [], ...entry.result.calls].slice(-100);
      this.log(entry, 'info', 'Job completed successfully.');
    } catch (reason) {
      if (reason instanceof HumanTaskSuspended) {
        outcome = 'waiting'; entry.checkpoint = reason.checkpoint;
        entry.view.waitingTask = { id: reason.checkpoint.taskId, checkpointId: reason.checkpoint.id };
        entry.view.package = { id: reason.checkpoint.packageId, version: (entry.trigger.definition as any)?.portablePackage?.version ?? '' };
        entry.view.workflowCalls = [...entry.trigger.resume ? entry.trigger.previous?.workflowCalls ?? [] : [], ...reason.calls ?? []].slice(-100);
        this.log(entry, 'info', 'Waiting for human response. Robot will be released.');
      } else {
      const stopped = reason instanceof RobotJobStoppedError;
      outcome = stopped ? 'stopped' : 'failed';
      entry.view.error = stopped ? undefined : reason instanceof Error ? reason.message : 'Workflow execution failed.';
      this.log(entry, stopped ? 'info' : 'error', stopped ? 'Job stopped at an activity boundary.' : entry.view.error!);
      }
    } finally {
      try { await queues?.close(); }
      catch { this.log(entry, 'error', 'Transaction cleanup could not be confirmed; lease expiry will recover uncommitted work.'); if (outcome === 'success') { outcome = 'failed'; entry.view.error = 'Transaction cleanup could not be confirmed.'; } }
      if (queues) entry.view.transactions = [...entry.trigger.resume ? entry.trigger.previous?.transactions ?? [] : [], ...redactJobValue(queues.events, entry.secrets) as NonNullable<RobotJobView['transactions']>].slice(-200);
      // Pollers and Maestro must see the final transaction result before a terminal job.
      entry.view.status = outcome;
      entry.view.completedAt = outcome === 'waiting' ? undefined : Date.now();
      if (entry.trigger.resume || outcome === 'waiting') {
        try { this.persist(entry); }
        catch { entry.view.status = 'failed'; entry.view.error = 'Durable Robot receipt could not be saved. Execution was stopped.'; entry.view.completedAt = Date.now(); entry.checkpoint = undefined; }
      }
      await this.notify(entry);
      // Inputs/definition are no longer retained after reporting.
      if (!entry.checkpoint) entry.trigger = { jobId: entry.trigger.jobId, callbackUrl: '' }; entry.result = undefined;
      this.active = undefined; void this.drain();
    }
  }
}
