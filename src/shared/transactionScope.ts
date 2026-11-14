import { cloneArgument, resolveArgumentInput, validArgumentName } from './invokedWorkflows';
import type { QueueRunSession, TransactionItem } from './queues';

export class BusinessRuleException extends Error {
  constructor(message: string) { super(message); this.name = 'BusinessRuleException'; }
}
/** A scope already committed its failure; retrying its body would duplicate side effects. */
export class TransactionScopeFailure extends Error {
  constructor(message: string, public kind: 'Business' | 'Application') { super(message); this.name = 'TransactionScopeFailure'; }
}
export const failureKind = (error: unknown): 'Business' | 'Application' => error instanceof BusinessRuleException || error instanceof TransactionScopeFailure && error.kind === 'Business' ? 'Business' : 'Application';
export function validateTransactionScope(p: Record<string, unknown>) {
  if (typeof p.transaction !== 'string' || !p.transaction.trim()) throw Error('Transaction Scope requires a claimed transaction expression.');
  if (!['Continue', 'Stop'].includes(String(p.failureBehavior ?? 'Continue'))) throw Error('Choose Continue or Stop after a transaction failure.');
  const outputs = [p.exceptionOutput ?? 'transactionError', p.resultOutput ?? 'transactionResult'];
  if (outputs.some(v => typeof v !== 'string' || !validArgumentName(v)) || outputs[0] === outputs[1]) throw Error('Transaction error and result outputs require distinct variable names.');
  const root = p.transaction.trim().replace(/^\{\{\s*/, '').match(/^([A-Za-z_]\w*)/)?.[1];
  if (root && outputs.includes(root)) throw Error('Scope outputs must not overwrite the claimed transaction variable.');
  if (p.workflowFile && (typeof p.workflowFile !== 'string' || p.workflowFile.includes('{{'))) throw Error('Choose a static recovery workflow file.');
}
export function resolveScopeValue(raw: unknown, values: Record<string, unknown>) {
  return typeof raw === 'string' && validArgumentName(raw.trim()) && Object.prototype.hasOwnProperty.call(values, raw.trim()) ? values[raw.trim()] : resolveArgumentInput(raw, values).value;
}
/** One item, one attempt. Maestro alone schedules queue retries. Recovery never replays the body. */
export async function executeTransactionScope(id: string, p: Record<string, unknown>, values: Record<string, unknown>, queues: QueueRunSession | undefined, body: () => Promise<void>, recover: (() => Promise<void>) | undefined, checkStop: () => void, secrets: () => string[]) {
  validateTransactionScope(p); if (!queues) throw Error('Transaction Scope requires a Maestro queue session.');
  const item = queues.beginScope(resolveScopeValue(p.transaction, values) as TransactionItem);
  const errorOutput = String(p.exceptionOutput ?? 'transactionError'), resultOutput = String(p.resultOutput ?? 'transactionResult');
  const safe = (message: string) => { for (const secret of secrets().filter(Boolean).sort((a, b) => b.length - a.length)) message = message.split(secret).join('[REDACTED]'); return message.slice(0, 2000); };
  values[errorOutput] = null; values[resultOutput] = null;
  queues.scopeEvent(item, id, 'processing');
  try {
    let failure: unknown, failed = false;
    try { checkStop(); await body(); checkStop(); }
    catch (error) { try { checkStop(); } catch (stop) { queues.scopeEvent(item, id, 'stopped'); throw stop; } queues.assertHealthy(); failure = error; failed = true; }
    const kind = failed ? failureKind(failure) : undefined;
    const reason = failed ? safe(failure instanceof Error ? failure.message : String(failure)) : '';
    // A failed/uncertain commit escapes before recovery: it must never be disguised as a body failure.
    let result;
    try { result = await queues.complete(item, failed ? 'Failed' : 'Successful', kind ?? 'Application', reason, true); }
    catch (error) { queues.scopeEvent(item, id, 'commit-unconfirmed'); throw error; }
    values[resultOutput] = cloneArgument(result);
    if (!failed) { queues.scopeEvent(item, id, 'completed'); return; }
    values[errorOutput] = { type: kind, message: reason, itemId: item.id, reference: item.reference, attempt: item.attempt };
    queues.scopeEvent(item, id, 'failed', kind, reason);
    checkStop();
    if (kind === 'Application' && recover) {
      queues.scopeEvent(item, id, 'recovery-started');
      try { await recover(); checkStop(); queues.scopeEvent(item, id, 'recovery-completed'); }
      catch (error) { try { checkStop(); } catch (stop) { queues.scopeEvent(item, id, 'recovery-stopped'); throw stop; } const message = safe(error instanceof Error ? error.message : String(error)); queues.scopeEvent(item, id, 'recovery-failed', 'Application', message); throw new TransactionScopeFailure('Recovery workflow failed: ' + message, 'Application'); }
    }
    if (p.failureBehavior === 'Stop') throw new TransactionScopeFailure(reason || 'Transaction failed.', kind!);
  } finally { queues.endScope(item.id); }
}
