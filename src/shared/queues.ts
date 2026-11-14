import { cloneArgument, resolveArgumentInput, validArgumentName } from './invokedWorkflows';
import { containsProtectedValue, validAssetName } from './assets';
export interface TransactionItem { id: string; queueName: string; environmentId: string; reference: string; content: Record<string, unknown>; status: string; attempt: number; retryCount: number; readyAt: number; leaseUntil?: number; errorType?: string; reason?: string }
export interface QueueDefinition { name: string; enabled: boolean; maxRetries: number; retryDelaySeconds: number; leaseSeconds: number; revision: number; counts: Record<string, number> }
export interface TransactionEvent { itemId?: string; queueName: string; reference?: string; attempt?: number; status: string; scopeId?: string; phase?: string; errorType?: string; reason?: string; at: number }
export interface QueueResponse { item: TransactionItem | null; leaseToken?: string; leaseSeconds?: number; released?: TransactionItem[]; duplicate?: boolean }
export type QueueTransport = (payload: Record<string, unknown>, cleanup?: boolean) => Promise<QueueResponse>;
export class QueueTransportError extends Error { constructor(message: string, public uncertain = false) { super(message); } }
export const queueActivities = ['add-queue-item', 'get-transaction-item', 'set-transaction-status'];
export function validateQueueActivity(id: string, p: Record<string, unknown>) {
  if (id !== 'set-transaction-status' && !validAssetName(p.queueName)) throw Error('Queue name must be a static central name.');
  if (id === 'set-transaction-status' && (!['Successful', 'Failed'].includes(String(p.status)) || p.status === 'Failed' && !['Application', 'Business'].includes(String(p.errorType)))) throw Error('Choose Successful or Failed with an Application/Business error type.');
  if (p.output && !validArgumentName(String(p.output))) throw Error('Choose a valid output variable.');
  if (id === 'get-transaction-item' && (!p.output || p.hasItemOutput && (!validArgumentName(String(p.hasItemOutput)) || p.hasItemOutput === p.output))) throw Error('Transaction and Has transaction outputs require distinct valid variable names.');
}
/** Private lease receipts never enter workflow variables, debug snapshots or packages. */
export class QueueRunSession {
  readonly events: TransactionEvent[] = [];
  private claims = new Map<string, { item: TransactionItem; token: string; timer: ReturnType<typeof setInterval>; pending?: Promise<void> }>();
  private failure: Error | undefined;
  private closed = false;
  private used = false;
  private scopeItem: string | undefined;
  constructor(private transport: QueueTransport) {}
  get activeCount() { return this.claims.size; }
  assertHealthy() { if (this.failure) throw this.failure; }
  beginScope(item: TransactionItem) {
    this.assertHealthy(); const claim = this.claims.get(item?.id);
    if (this.closed || this.scopeItem || !claim || claim.item.attempt !== item.attempt || claim.item.queueName !== item.queueName) throw Error('Transaction Scope requires an uncommitted claim from this run; nested scopes are not supported.');
    this.scopeItem = item.id; return structuredClone(claim.item);
  }
  endScope(id: string) { if (this.scopeItem === id) this.scopeItem = undefined; }
  scopeEvent(item: TransactionItem, scopeId: string, phase: string, errorType?: string, reason?: string) {
    this.events.push({ itemId: item.id, queueName: item.queueName, reference: item.reference, attempt: item.attempt, status: 'scope', scopeId, phase, errorType, reason, at: Date.now() });
    if (this.events.length > 200) this.events.shift();
  }
  private record(item: TransactionItem | null, queueName: string, status?: string) {
    this.events.push({ itemId: item?.id, queueName, reference: item?.reference, attempt: item?.attempt, status: status ?? item?.status ?? 'empty', errorType: item?.errorType, reason: item?.reason, at: Date.now() });
    if (this.events.length > 200) this.events.shift();
  }
  private async send(payload: Record<string, unknown>, cleanup = false) {
    this.used = true;
    const request = { ...payload, requestId: 'qr_' + crypto.randomUUID() };
    let uncertainty: Error | undefined;
    for (let attempt = 0; ; attempt++) {
      try {
        const result = await this.transport(request, cleanup);
        if (uncertainty && this.failure === uncertainty) this.failure = undefined;
        return result;
      }
      catch (error) {
        if (error instanceof QueueTransportError && error.uncertain) {
          uncertainty = error; this.failure = error;
          if (!attempt) continue; // Retry the identical operation ID, never a fresh mutation.
        }
        throw error;
      }
    }
  }
  async add(queueName: string, reference: string, content: Record<string, unknown>) {
    this.assertHealthy(); if (this.closed) throw Error('Queue run has ended.');
    const result = await this.send({ operation: 'add', queueName, reference, content });
    this.record(result.item, queueName, result.duplicate ? 'duplicate' : undefined); return result.item;
  }
  async claim(queueName: string) {
    if (this.scopeItem) throw Error('Claim the next transaction after the current Transaction Scope ends.');
    this.assertHealthy(); if (this.closed || this.claims.size >= 20) throw Error('Finish the current transactions before claiming more work.');
    const result = await this.send({ operation: 'claim', queueName }); this.record(result.item, queueName);
    if (result.item) {
      if (!result.leaseToken || !Number.isFinite(result.leaseSeconds) || result.leaseSeconds! < 30) { this.failure = Error('Maestro did not return a valid transaction lease.'); throw this.failure; }
      const item = result.item, token = result.leaseToken;
      const timer = setInterval(() => {
        const claim = this.claims.get(item.id); if (!claim || claim.pending || this.closed) return;
        claim.pending = this.send({ operation: 'renew', queueName, itemId: item.id, leaseToken: token }).then(() => {}).catch(() => { this.failure = Error('Transaction ownership could not be renewed. The run must stop before processing more work.'); }).finally(() => { claim.pending = undefined; });
      }, Math.max(1000, result.leaseSeconds! * 1000 / 3));
      (timer as any).unref?.();
      this.claims.set(item.id, { item: structuredClone(item), token, timer });
    }
    return result.item;
  }
  async complete(item: TransactionItem, status: string, errorType: string, reason: string, managed = false) {
    if (this.scopeItem === item?.id && !managed) throw Error('Transaction Scope manages this item. Remove Set Transaction Status from its body.');
    this.assertHealthy(); const claim = this.claims.get(item?.id);
    if (this.closed || !claim || claim.item.queueName !== item.queueName || claim.item.attempt !== item.attempt) throw Error('This transaction was not claimed by the current run.');
    clearInterval(claim.timer);
    if (claim.pending) await claim.pending; this.assertHealthy();
    let result;
    try { result = await this.send({ operation: 'complete', queueName: claim.item.queueName, itemId: item.id, leaseToken: claim.token, status, errorType, reason }); }
    catch (error) { this.failure = error instanceof Error ? error : Error('Transaction result was not committed.'); throw error; }
    clearInterval(claim.timer); this.claims.delete(item.id); this.record(result.item, item.queueName); return result.item;
  }
  async close() {
    if (this.closed) return; this.closed = true;
    if (!this.used) return;
    if (!this.claims.size && !this.failure) return;
    const pending = [...this.claims.values()]; for (const claim of pending) clearInterval(claim.timer);
    await Promise.allSettled(pending.flatMap(c => c.pending ? [c.pending] : []));
    try { const result = await this.send({ operation: 'releaseAll' }, true); for (const item of result.released ?? []) this.record(item, item.queueName); }
    finally { this.claims.clear(); }
  }
}
export async function executeQueueActivity(id: string, p: Record<string, unknown>, values: Record<string, unknown>, session: QueueRunSession | undefined, secrets: string[]) {
  validateQueueActivity(id, p); if (!session) throw Error('Connect to Maestro and select an environment before using queues.');
  const value = (raw: unknown) => typeof raw === 'string' && validArgumentName(raw.trim()) && Object.prototype.hasOwnProperty.call(values, raw.trim()) ? values[raw.trim()] : resolveArgumentInput(raw, values).value;
  let item;
  if (id === 'add-queue-item') {
    let content = value(p.content ?? '{}'); if (typeof content === 'string') { try { content = JSON.parse(content); } catch { throw Error('Queue content must be a JSON object or an object variable.'); } }
    content = cloneArgument(content); const reference = String(value(p.reference) ?? '').trim();
    if (!content || typeof content !== 'object' || Array.isArray(content) || !reference) throw Error('A reference and JSON object content are required.');
    // Content is cloned JSON: inspect every nested string without the preview depth/size limits.
    const protectedContent = (v: unknown): boolean => typeof v === 'string' ? containsProtectedValue(v, secrets) : !!v && typeof v === 'object' && Object.entries(v).some(([k, item]) => containsProtectedValue(k, secrets) || protectedContent(item));
    if (protectedContent(content) || containsProtectedValue(reference, secrets)) throw Error('Protected runtime values cannot be stored in queue content or references.');
    item = await session.add(String(p.queueName), reference, content as Record<string, unknown>);
  } else if (id === 'get-transaction-item') item = await session.claim(String(p.queueName));
  else {
    const transaction = value(p.transaction); if (!transaction || typeof transaction !== 'object') throw Error('Set Transaction Status requires a claimed transaction variable.');
    let reason = String(value(p.reason ?? '') ?? ''); for (const secret of secrets) if (secret) reason = reason.split(secret).join('[REDACTED]');
    item = await session.complete(transaction as TransactionItem, String(p.status), String(p.errorType ?? 'Application'), reason);
  }
  const outputs: Record<string, unknown> = p.output ? { [String(p.output)]: cloneArgument(item) } : {};
  if (id === 'get-transaction-item' && p.hasItemOutput) { if (!validArgumentName(String(p.hasItemOutput))) throw Error('Choose a valid Has transaction output variable.'); outputs[String(p.hasItemOutput)] = !!item; }
  return outputs;
}
