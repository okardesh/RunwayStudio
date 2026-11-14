import type { Node, Edge } from 'reactflow';
import type { WorkflowArgument, WorkflowNodeData, WorkflowVariable } from '../types';
import { createExecutionTrace } from './executionTrace';
import { resolveLogMessage } from '../shared/logMessageExpression';
import { resolveTargetBindings } from '../shared/uiTargets';
import { useUiTargetStore } from '../store/uiTargetStore';
import { createLiveDebugger } from './liveDebugger';
import { useDebugStore, type DebugFrame } from '../store/debugStore';
import { evaluateBreakpointCondition } from './breakpointCondition';
import type { TestExecution } from '../shared/workflowTests';
import { argumentValue, cloneArgument, initializeArguments, loadWorkflowGraph, resolveArgumentInput, type WorkflowGraph, type WorkflowLoader } from '../shared/invokedWorkflows';
import { loadInvokedWorkflow } from './workflowLoader';
import { executeAssetActivity, protectDerivedValues, type AssetResolver } from '../shared/assets';
import { assetRunContext } from '../store/assetsStore';
import { useAssetsStore } from '../store/assetsStore';
import { QueueRunSession, executeQueueActivity, queueActivities } from '../shared/queues';
import { createQueueSession } from './queuesClient';
import { BusinessRuleException, TransactionScopeFailure, executeTransactionScope, resolveScopeValue } from '../shared/transactionScope';
import type { UiTarget } from '../shared/uiTargets';
import { humanActivities, createHumanTask, mockHumanResponse, validateHumanPlacement, validateHumanActivity } from '../shared/humanTasks';

export type LogLevel = 'Info' | 'Warning' | 'Error' | 'Debug';
export type LogFn = (text: string, level: LogLevel) => void;

let _stopRequested = false;
let _executing = false;
export const isWorkflowExecuting = () => _executing;

// ── Debug stepping ──────────────────────────────────────────────────────────
// Single module-level pause slot: at most one workflow runs at a time, so a
// single pending resolver is enough to model "paused, waiting for the user".

export type StepMode = 'continue' | 'step-into' | 'step-over';

let _resumeResolver: ((mode: StepMode) => void) | null = null;

export function isDebugPaused() { return _resumeResolver !== null; }

export function resumeDebug(mode: StepMode) {
  if (!_resumeResolver) return;
  const resolve = _resumeResolver;
  _resumeResolver = null;
  resolve(mode);
}

export function requestStop() {
  _stopRequested = true;
  resumeDebug('continue'); // unblock a paused debug session so it can observe the stop
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Returns true when running inside Electron with the automation bridge available
const isElectron = () =>
  typeof window !== 'undefined' && 'electronAPI' in window && typeof (window as any).electronAPI?.executeActivity === 'function';

// Best-effort browser-mode simulation for activities that can be faked in a web page
function browserFallback(activityId: string, properties: Record<string, unknown>, onLog: LogFn): { success: boolean } {
  switch (activityId) {
    case 'use-app-browser':
    case 'open-browser':
    case 'navigate-to': {
      const url = String(properties['url'] ?? 'about:blank');
      if (url && url !== 'about:blank') window.open(url, '_blank');
      onLog(`   Opened ${url} in new tab (browser mode)`, 'Info');
      return { success: true };
    }
    case 'throw':
      onLog(`   ${String(properties.message ?? 'Workflow error')}`, 'Error');
      return { success: false };
    default:
      onLog(`   (simulated) ${activityId}`, 'Debug');
      return { success: true };
  }
}

async function runActivity(
  activityId: string,
  properties: Record<string, unknown>,
  onLog: LogFn
): Promise<{ success: boolean; log?: string; outputs?: Record<string, unknown> }> {
  if (isElectron()) {
    const api = (window as any).electronAPI;
    const result: { success: boolean; log: string; outputs?: Record<string, unknown> } =
      await api.executeActivity(activityId, properties);
    onLog(`   ${result.log}`, result.success ? 'Info' : 'Error');
    return result;
  }
  // Browser-mode fallback — simulate what we can
  await sleep(300);
  return browserFallback(activityId, properties, onLog);
}

function resolveMember(value: unknown, member: string) {
  const text = String(value ?? '');
  switch (member) {
    case 'Length': return text.length;
    case 'ToLower()': return text.toLowerCase();
    case 'ToUpper()': return text.toUpperCase();
    case 'Trim()': return text.trim();
    case 'ToString()': return text;
    default: return undefined;
  }
}

function resolveProperties(properties: Record<string, unknown>, values: Record<string, unknown>) {
  const resolveVariable = (_match: string, name: string, member?: string) => {
    if (!(name in values)) return _match;
    const resolved = member ? resolveMember(values[name], member) : values[name];
    return resolved === undefined ? _match : String(resolved);
  };
  return Object.fromEntries(Object.entries(properties).map(([key, value]) => [
    key,
    typeof value === 'string'
      ? value
        .replace(/\{\{\s*([A-Za-z_]\w*)\s*\}\}\.([A-Za-z_]\w*(?:\(\))?)/g, resolveVariable)
        .replace(/\{\{\s*([A-Za-z_]\w*)(?:\.([A-Za-z_]\w*(?:\(\))?))?\s*\}\}/g, resolveVariable)
      : value,
  ]));
}

function evaluateCondition(expression: string, values: Record<string, unknown>): boolean {
  const resolved = String(resolveProperties({ expression }, values).expression ?? '').trim();
  if (resolved.toLowerCase() === 'true') return true;
  if (resolved.toLowerCase() === 'false' || !resolved) return false;

  const comparison = resolved.match(/^(.*?)\s*(==|!=|>=|<=|>|<)\s*(.*?)$/);
  if (!comparison) return false;
  const [, rawLeft, operator, rawRight] = comparison;
  const unquote = (value: string) => value.trim().replace(/^(["'])(.*)\1$/, '$2');
  const left = unquote(rawLeft);
  const right = unquote(rawRight);
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  const numeric = !Number.isNaN(leftNumber) && !Number.isNaN(rightNumber);
  const first = numeric ? leftNumber : left;
  const second = numeric ? rightNumber : right;
  switch (operator) {
    case '==': return first === second;
    case '!=': return first !== second;
    case '>': return first > second;
    case '>=': return first >= second;
    case '<': return first < second;
    case '<=': return first <= second;
    default: return false;
  }
}

function resolveCollection(expression: unknown, values: Record<string, unknown>): unknown[] | null {
  const reference = String(expression ?? '').trim().match(/^\{\{\s*([A-Za-z_]\w*)\s*\}\}$/);
  const raw = reference ? values[reference[1]] : expression;
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // A comma-separated fallback makes simple preview values usable without JSON syntax.
  }
  return raw.trim() ? raw.split(',').map((item) => item.trim()) : [];
}

function getCollectionVariableName(value: unknown) {
  return String(value ?? '').trim().replace(/^\{\{\s*|\s*\}\}$/g, '');
}

function resolveCollectionValue(value: unknown, values: Record<string, unknown>) {
  const reference = String(value ?? '').trim().match(/^\{\{\s*([A-Za-z_]\w*)\s*\}\}$/);
  return reference && reference[1] in values ? values[reference[1]] : value;
}

export interface DebugOptions {
  queueSession?: QueueRunSession;
  assetContext?: { resolve?: AssetResolver; environment?: { id: string; name: string } };
  arguments?: WorkflowArgument[];
  loadWorkflow?: WorkflowLoader;
  initialValues?: Record<string, unknown>;
  test?: TestExecution;
  projectName?: string;
  filePath?: string | null;
  debug?: boolean;
  hasBreakpoint?: (nodeId: string) => boolean;
  getBreakpoint?: (nodeId: string) => { enabled: boolean; condition?: string; hitCount?: number } | undefined;
  onPause?: (nodeId: string, location?: { projectName: string; filePath: string | null; activityName: string }) => void;
  onResume?: () => void;
}

interface ExecutionSession { queues?: QueueRunSession; assets?: AssetResolver; environment?: { id: string; name: string }; graph?: WorkflowGraph; targets: UiTarget[]; frames: DebugFrame[]; rootRunId?: string; step: 'run' | StepMode; stepOverDepth: number }
interface ExecutionFrame { depth: number; parentRunId?: string; invocationNodeId?: string; inheritedSecrets?: string[] }
interface ExecutionResult { status: 'completed' | 'stopped' | 'error'; values: Record<string, unknown>; secrets: string[]; failure?: Error }
export async function executeWorkflow(nodes: Node<WorkflowNodeData>[], edges: Edge[], variables: WorkflowVariable[], onNodeStart: (id: string) => void, onNodeEnd: (id: string) => void, onLog: LogFn, options?: DebugOptions): Promise<'completed' | 'stopped' | 'error'> {
  if (_executing) throw Error('Another workflow is already running. Stop it before starting a new run.');
  _executing = true; _stopRequested = false;
  const assets = options?.assetContext ?? assetRunContext();
  const c = useAssetsStore.getState().connection;
  const queues = options?.queueSession ?? (c ? createQueueSession({ ...c }, assets.environment?.id ?? 'default') : undefined);
  const session: ExecutionSession = { queues, assets: assets.resolve, environment: assets.environment, targets: JSON.parse(JSON.stringify(useUiTargetStore.getState().targets)), frames: [], step: 'run', stepOverDepth: 0 };
  try { return (await executeWorkflowRecorded(nodes, edges, variables, onNodeStart, onNodeEnd, onLog, options, session, { depth: 0 })).status; }
  finally { _executing = false; _resumeResolver = null; useDebugStore.setState({ frames: [] }); }
}

async function executeWorkflowRecorded(
  nodes: Node<WorkflowNodeData>[],
  edges: Edge[],
  variables: WorkflowVariable[],
  onNodeStart: (id: string) => void,
  onNodeEnd: (id: string) => void,
  onLog: LogFn,
  debugOptions: DebugOptions | undefined,
  session: ExecutionSession,
  frame: ExecutionFrame
): Promise<ExecutionResult> {
  const trace = createExecutionTrace(nodes, variables, { ...debugOptions, ...frame, environment: session.environment, callDepth: session.frames.length, rootRunId: session.rootRunId });
  const protectedLog: LogFn = (text, level) => { let safe = text; for (const secret of [...trace.secrets].sort((a, b) => b.length - a.length)) if (secret) safe = safe.split(secret).join('[REDACTED]'); onLog(safe, level); };
  session.rootRunId ??= trace.runId;
  const live = debugOptions?.debug ? createLiveDebugger(debugOptions.projectName || 'Workflow', nodes, [...variables, ...(debugOptions.arguments ?? []).map((a) => ({ ...a, scope: `Argument (${a.direction})` }))], frame.depth === 0, trace.secrets) : undefined;
  if (!live && frame.depth === 0) useDebugStore.getState().clearSession();
  const currentFrame: DebugFrame = { id: trace.runId, projectName: debugOptions?.projectName || 'Workflow', filePath: debugOptions?.filePath ?? null, nodes, nodeId: null, depth: frame.depth };
  session.frames.push(currentFrame);
  const publishFrame = (nodeId: string | null) => { currentFrame.nodeId = nodeId; if (live) useDebugStore.setState({ frames: session.frames.map((f) => ({ ...f })) }); };
  let finalValues: Record<string, unknown> = {};
  let executionFailure: Error | undefined;
  try {
    if (frame.depth === 0 && nodes.some((n) => n.data.activityId === 'invoke-workflow' || n.data.activityId === 'transaction-scope' && n.data.properties.workflowFile)) session.graph = await loadWorkflowGraph({ projectName: currentFrame.projectName, nodes, edges, variables, arguments: debugOptions?.arguments ?? [] }, currentFrame.filePath, debugOptions?.loadWorkflow ?? loadInvokedWorkflow);
    if (frame.depth === 0) {
      const definitions = [{ nodes }, ...session.graph?.files.map(f => f.definition) ?? []]; validateHumanPlacement(definitions);
      for (const d of definitions) for (const n of d.nodes) if (humanActivities.includes(n.data.activityId)) {
        validateHumanActivity(n.data.activityId, n.data.properties);
        if (!debugOptions?.debug) throw Error('Human tasks need durable Robot Jobs execution. Publish and launch through Jobs, or use Debug mock decisions.');
      }
    }
    const resolvedNodes = resolveTargetBindings(nodes, session.targets);
    const invoke = async (nodeId: string, properties: Record<string, unknown>, values: Record<string, unknown>, depth: number) => {
      const loaded = session.graph?.resolve(currentFrame.filePath, nodeId);
      if (!loaded) throw Error('Invoked workflow dependency is unavailable.');
      const provided: Record<string, unknown> = Object.create(null);
      for (const arg of loaded.definition.arguments.filter((a) => a.direction === 'In')) if (Object.prototype.hasOwnProperty.call(properties.inArguments ?? {}, arg.name)) {
        try {
          const input = resolveArgumentInput((properties.inArguments as Record<string, unknown>)[arg.name], values);
          provided[arg.name] = argumentValue(input.value, arg.type, input.authoredText);
        } catch { throw Error(`Input argument "${arg.name}" could not be resolved as ${arg.type}. Check its caller mapping.`); }
      }
      const child = loaded.definition;
      for (const target of child.uiTargets ?? []) if (!session.targets.some((t) => t.id === target.id)) session.targets.push(JSON.parse(JSON.stringify(target)));
      const result = await executeWorkflowRecorded(JSON.parse(JSON.stringify(child.nodes)), child.edges, JSON.parse(JSON.stringify(child.variables)), () => {}, () => {}, protectedLog,
        { ...debugOptions, projectName: child.projectName, filePath: loaded.path, arguments: child.arguments, initialValues: provided, test: undefined, hasBreakpoint: undefined, getBreakpoint: undefined }, session,
        { depth: depth + 1, parentRunId: trace.runId, invocationNodeId: nodeId, inheritedSecrets: trace.secrets });
      for (const secret of result.secrets) if (!trace.secrets.includes(secret)) trace.secrets.push(secret);
      publishFrame(nodeId);
      if (result.status !== 'completed') { if (result.status === 'error') throw result.failure ?? Error('Called workflow failed.'); return false; }
      const outputs: Record<string, unknown> = Object.create(null);
      for (const arg of child.arguments.filter((a) => a.direction === 'Out')) {
        const destination = (properties.outArguments as Record<string, string> | undefined)?.[arg.name];
        if (destination) outputs[destination] = cloneArgument(result.values[arg.name]);
      }
      for (const [name, value] of Object.entries(outputs)) Object.defineProperty(values, name, { value, writable: true, configurable: true, enumerable: true });
      return true;
    };
    let result = await executeWorkflowCore(resolvedNodes, edges, variables, onNodeStart, onNodeEnd, protectedLog, trace, debugOptions, live, session, frame.depth, publishFrame, invoke, (values) => { finalValues = values; }, error => { executionFailure = error; });
    if (_stopRequested) result = 'stopped';
    if (frame.depth === 0 && session.queues) {
      if (result === 'completed' && session.queues.activeCount) { result = 'error'; trace.error('A claimed transaction has no committed result. Add Set Transaction Status.'); }
      await session.queues.close();
    }
    if (session.queues) trace.transactions(session.queues.events);
    if (result === 'completed') for (const arg of debugOptions?.arguments ?? []) if (arg.direction === 'Out') {
      try { finalValues[arg.name] = argumentValue(finalValues[arg.name], arg.type); } catch { throw Error(`Output argument "${arg.name}" does not match its declared ${arg.type} type.`); }
    }
    if (frame.depth === 0) live?.finish(result);
    await trace.finish(result);
    return { status: result, values: finalValues, secrets: trace.secrets, failure: executionFailure };
  } catch (error) {
    const status = _stopRequested ? 'stopped' : 'error';
    if (frame.depth === 0) try { await session.queues?.close(); } catch { protectedLog('Transaction cleanup could not be confirmed. Lease expiry will recover uncommitted work.', 'Warning'); }
    if (session.queues) trace.transactions(session.queues.events);
    if (frame.depth === 0) live?.finish(status);
    if (!_stopRequested) protectedLog(error instanceof Error ? error.message : String(error), 'Error');
    await trace.finish(status, _stopRequested ? undefined : error);
    return { status, values: {}, secrets: trace.secrets, failure: error instanceof Error ? error : Error(String(error)) };
  } finally { session.frames.pop(); }
}

async function executeWorkflowCore(
  nodes: Node<WorkflowNodeData>[],
  _edges: Edge[],
  variables: WorkflowVariable[],
  notifyStart: (id: string) => void,
  notifyEnd:   (id: string) => void,
  notifyLog: LogFn,
  trace: ReturnType<typeof createExecutionTrace>,
  debugOptions: DebugOptions | undefined,
  live: ReturnType<typeof createLiveDebugger> | undefined,
  session: ExecutionSession,
  baseDepth: number,
  publishFrame: (nodeId: string | null) => void,
  invoke: (nodeId: string, properties: Record<string, unknown>, values: Record<string, unknown>, depth: number) => Promise<boolean>,
  captureValues: (values: Record<string, unknown>) => void,
  captureError: (error: Error) => void
): Promise<'completed' | 'stopped' | 'error'> {
  const values: Record<string, unknown> = Object.fromEntries(variables.map((variable) => [variable.name, variable.defaultValue]));
  if (debugOptions?.initialValues) for (const name of Object.keys(values)) if (Object.prototype.hasOwnProperty.call(debugOptions.initialValues, name)) values[name] = debugOptions.initialValues[name];
  Object.assign(values, initializeArguments(debugOptions?.arguments ?? [], variables, debugOptions?.initialValues));
  captureValues(values);
  trace.runtime(values);
  let currentNodeId: string | null = null;
  live?.capture(values, null);
  let currentDepth = baseDepth;
  let strictScope = 0;
  let lastActivityFailure: Error | undefined;
  const checkScopeStop = () => { if (_stopRequested) throw Error('Stopped by user'); };
  const onNodeStart = (id: string) => { currentNodeId = id; publishFrame(id); live?.capture(values, id); trace.start(id, values); notifyStart(id); };
  const onNodeEnd = (id: string) => { trace.runtime(values); live?.capture(values, id); trace.end(id, _stopRequested); notifyEnd(id); };
  const onLog: LogFn = (text, level) => { if (level === 'Error' && !_stopRequested) trace.error(text); notifyLog(_stopRequested && level === 'Error' ? 'Stopped by user' : text, _stopRequested && level === 'Error' ? 'Warning' : level); };
  const runWithValues = async (activityId: string, properties: Record<string, unknown>) => {
    lastActivityFailure = undefined;
    const inputs = resolveProperties(properties, values);
    if (activityId === 'log-message') inputs.message = resolveLogMessage(properties.message, values);
    protectDerivedValues(properties, inputs, values, trace.secrets, v => { if (!trace.secrets.includes(v)) trace.secrets.push(v); });
    trace.inputs(inputs);
    let success = false;
    try { success = activityId === 'invoke-workflow' ? await invoke(currentNodeId!, properties, values, currentDepth) : await runWithValuesCore(activityId, properties); }
    catch (error) {
      const failure = error instanceof Error ? error : Error(String(error)); lastActivityFailure = failure; captureError(failure);
      onLog(failure.message, 'Error');
      if (strictScope) { trace.outputs(values); await trace.captureFailure(); throw failure; }
    }
    live?.capture(values, currentNodeId, 'running', true);
    trace.outputs(values);
    if (!success && !_stopRequested) { trace.error('Activity failed. See error details in Output.'); await trace.captureFailure(); }
    return success;
  };
  const runWithValuesCore = async (activityId: string, properties: Record<string, unknown>) => {
    session.queues?.assertHealthy();
    if (humanActivities.includes(activityId)) {
      if (!debugOptions?.debug) throw Error('Run human tasks through Robot Jobs or Debug mock mode.');
      if (activityId === 'create-human-task') { const task = await createHumanTask(currentNodeId!, properties, values, trace.secrets); trace.human({ taskId: task.id, phase: 'debug-created', at: Date.now() }); }
      else { if (session.queues?.activeCount) throw Error('Finish all transactions before waiting for human input.'); const id = mockHumanResponse(properties, values); trace.human({ taskId: id, phase: 'debug-response', decision: String(properties.debugDecision ?? 'Approved'), at: Date.now() }); }
      onLog('Human task simulated for Debug. No approval was created or submitted.', 'Info'); return true;
    }
    if (activityId === 'business-rule-exception') throw new BusinessRuleException(String(resolveScopeValue(properties.message ?? 'Business rule was not satisfied.', values)));
    if (activityId === 'transaction-scope') {
      const node = nodes.find(n => n.id === currentNodeId)!;
      const scopeDepth = currentDepth - baseDepth;
      await executeTransactionScope(node.id, properties, values, session.queues, async () => {
        strictScope++;
        try { await scopeSequence(node.data.childIds ?? [], scopeDepth + 1); }
        finally { strictScope--; publishFrame(node.id); currentNodeId = node.id; currentDepth = scopeDepth + baseDepth; }
      }, properties.workflowFile ? async () => { publishFrame(node.id); currentNodeId = node.id; if (!await invoke(node.id, properties, values, currentDepth)) checkScopeStop(); } : undefined, checkScopeStop, () => trace.secrets);
      if (session.queues) trace.transactions(session.queues.events);
      live?.capture(values, node.id); return true;
    }
    if (queueActivities.includes(activityId)) {
      const outputs = await executeQueueActivity(activityId, properties, values, session.queues, trace.secrets);
      if (_stopRequested) return false;
      Object.assign(values, outputs); if (session.queues) trace.transactions(session.queues.events);
      onLog('Central queue operation completed.', 'Info'); return true;
    }
    if (activityId === 'get-asset' || activityId === 'get-credential') {
      const outputs = await executeAssetActivity(activityId, properties, session.assets, value => { if (!trace.secrets.includes(value)) trace.secrets.push(value); });
      if (_stopRequested) return false;
      Object.assign(values, outputs);
      onLog('Read central ' + (activityId === 'get-credential' ? 'credential' : 'asset') + ' from the selected environment.', 'Info');
      return true;
    }
    if (activityId === 'create-list') {
      const output = getCollectionVariableName(properties.output);
      if (!output) return false;
      values[output] = [];
      onLog(`   Created empty list ${output}`, 'Info');
      return true;
    }
    if (activityId === 'add-to-collection' || activityId === 'remove-from-collection' || activityId === 'clear-collection') {
      const collectionName = getCollectionVariableName(properties.collection);
      const collection = values[collectionName];
      if (!collectionName || !Array.isArray(collection)) {
        onLog(`   Collection variable "${collectionName || 'unknown'}" is not a list`, 'Error');
        return false;
      }
      if (activityId === 'clear-collection') {
        collection.length = 0;
        onLog(`   Cleared ${collectionName}`, 'Info');
        return true;
      }
      const value = resolveCollectionValue(properties.value, values);
      if (activityId === 'add-to-collection') {
        collection.push(value);
        onLog(`   Added item to ${collectionName}`, 'Info');
        return true;
      }
      const index = collection.findIndex((item) => String(item) === String(value));
      if (index >= 0) collection.splice(index, 1);
      onLog(index >= 0 ? `   Removed item from ${collectionName}` : `   No matching item in ${collectionName}`, 'Info');
      return true;
    }
    const resolvedProperties = resolveProperties(properties, values);
    if (activityId === 'assign' && typeof properties.value === 'string' && /^\s*\{\{[^{}]+\}\}\s*$/.test(properties.value)) resolvedProperties.value = resolveArgumentInput(properties.value, values).value;
    if (activityId === 'log-message') resolvedProperties.message = resolveLogMessage(properties.message, values);
    protectDerivedValues(properties, resolvedProperties, values, trace.secrets, v => { if (!trace.secrets.includes(v)) trace.secrets.push(v); });
    if (activityId === 'write-csv') {
      resolvedProperties.data = resolveCollectionValue(properties.data, values);
    }
    const result = await runActivity(activityId, resolvedProperties, onLog);
    session.queues?.assertHealthy();
    if (!result.success) throw Error(result.log || `Activity failed: ${activityId}`);
    if (result.outputs) Object.assign(values, result.outputs);
    return result.success;
  };

  const topLevel = nodes.filter((n) => !n.data.parentId);
  if (topLevel.length === 0) {
    onLog('Nothing to run — drag activities onto the canvas first.', 'Warning');
    return 'error';
  }

  const debug = debugOptions?.debug ?? false;
  const hasBreakpoint = debugOptions?.hasBreakpoint ?? (() => false);
  const breakpointHits = new Map<string, number>();
  // A fresh debug run only pauses at breakpoints until the user starts stepping.

  // Pauses (awaiting a resume command) before a node runs, when debugging and either
  // it carries a breakpoint or the previous step command asked to stop here.
  async function maybeBreak(nodeId: string, depth: number) {
    depth += baseDepth; currentDepth = depth;
    if (!debug) return;
    const node = nodes.find((n) => n.id === nodeId);
    const config = debugOptions?.getBreakpoint ? debugOptions.getBreakpoint(nodeId) : {
      enabled: debugOptions?.hasBreakpoint ? hasBreakpoint(nodeId) : !!node?.data.breakpoint,
      condition: node?.data.breakpointCondition, hitCount: node?.data.breakpointHitCount,
    };
    const override = useDebugStore.getState().breakpointOverrides[`${debugOptions?.filePath ?? '<root>'}:${nodeId}`];
    if (config && override !== undefined) config.enabled = override;
    let breakpointPause = false;
    if (config?.enabled) {
      const hit = (breakpointHits.get(nodeId) ?? 0) + 1;
      breakpointHits.set(nodeId, hit);
      const invalidHit = config.hitCount !== undefined && (!Number.isSafeInteger(config.hitCount) || config.hitCount < 1);
      if (invalidHit) { onLog('Breakpoint hit count must be a positive whole number; paused for inspection.', 'Warning'); breakpointPause = true; }
      else if (config.hitCount === undefined || hit === config.hitCount) {
        const result = config.condition?.trim() ? evaluateBreakpointCondition(config.condition, values) : { value: true };
        breakpointPause = !!result.value || !!result.error;
        if (result.error) onLog(`Breakpoint condition could not be evaluated: ${result.error} Paused for inspection.`, 'Warning');
      }
    }
    const shouldPause =
      breakpointPause ||
      session.step === 'step-into' ||
      (session.step === 'step-over' && depth <= session.stepOverDepth);
    if (!shouldPause) return;

    const paused = new Promise<StepMode>((resolve) => { _resumeResolver = resolve; });
    live?.capture(values, nodeId, 'paused');
    debugOptions?.onPause?.(nodeId, { projectName: debugOptions.projectName || 'Workflow', filePath: debugOptions.filePath ?? null, activityName: node?.data.label ?? nodeId });
    const mode = await paused;
    live?.capture(values, nodeId, 'running');
    debugOptions?.onResume?.();

    if (mode === 'continue') session.step = 'run';
    else if (mode === 'step-into') session.step = 'step-into';
    else { session.step = 'step-over'; session.stepOverDepth = depth; }
  }

  onLog('▶  Workflow started', 'Info');

  let scopeSteps = 0;
  async function scopeSequence(ids: string[], depth: number): Promise<'normal' | 'break' | 'continue'> {
    if (depth > 64) throw Error('Transaction Scope nesting limit exceeded.');
    for (const id of ids) {
      checkScopeStop(); session.queues?.assertHealthy();
      if (++scopeSteps > 10000) throw Error('Transaction Scope activity limit exceeded.');
      const node = nodes.find(n => n.id === id); if (!node) throw Error('Transaction Scope has a missing child activity.');
      const d = node.data, p = d.properties;
      onNodeStart(id); await maybeBreak(id, depth);
      try {
        checkScopeStop(); onLog(`  → ${d.label}`, 'Info');
        if (d.activityId === 'break' || d.activityId === 'continue') return d.activityId;
        if (d.activityId === 'if') {
          const branch = (d.branches ?? []).find(b => b.kind === 'else' || evaluateCondition(b.condition, values));
          if (branch) { const flow = await scopeSequence(branch.childIds, depth + 1); if (flow !== 'normal') return flow; }
        } else if (d.activityId === 'for-each') {
          const name = d.loopVariable?.name, items = resolveCollection(p.collection, values);
          if (!name || !items) throw Error('For Each requires a collection and loop variable.');
          const had = Object.prototype.hasOwnProperty.call(values, name), old = values[name];
          try { for (const item of items) { if (++scopeSteps > 10000) throw Error('Transaction Scope activity limit exceeded.'); values[name] = item; const flow = await scopeSequence(d.childIds ?? [], depth + 1); if (flow === 'break') break; } }
          finally { if (had) values[name] = old; else delete values[name]; }
        } else if (d.activityId === 'retry-scope') {
          const count = Number(p.maxRetries ?? 3), delay = Number(p.retryDelay ?? 1000);
          if (!Number.isSafeInteger(count) || count < 0 || count > 1000 || !Number.isFinite(delay) || delay < 0 || delay > 120000) throw Error('Invalid retry count or delay.');
          for (let attempt = 0; ; attempt++) {
            try { const flow = await scopeSequence(d.childIds ?? [], depth + 1); if (flow !== 'normal') return flow; break; }
            catch (error) { checkScopeStop(); if (error instanceof BusinessRuleException || error instanceof TransactionScopeFailure || attempt >= count) throw error; if (delay) await sleep(delay); }
          }
        } else if (d.activityId === 'try-catch') {
          const branches = d.branches ?? [], body = branches.find(b => b.kind === 'try'), final = branches.find(b => b.kind === 'finally');
          if (!body) throw Error('Try Catch has no TRY branch.');
          let flow: 'normal' | 'break' | 'continue' = 'normal';
          try { try { flow = await scopeSequence(body.childIds, depth + 1); }
            catch (error) { checkScopeStop(); const handler = branches.find(b => b.kind === 'catch'); if (!handler) throw error; const name = String(p.exception ?? 'exception'); values[name] = { type: error instanceof BusinessRuleException ? 'Business' : 'Application', message: error instanceof Error ? error.message : String(error) }; flow = await scopeSequence(handler.childIds, depth + 1); }
          } finally { if (final && !_stopRequested) { const result = await scopeSequence(final.childIds, depth + 1); if (result !== 'normal') flow = result; } }
          if (flow !== 'normal') return flow;
        } else {
          if (d.activityId !== 'sequence' && !await runWithValues(d.activityId, p)) { checkScopeStop(); throw Error(`Activity failed: ${d.label}`); }
          if (d.isContainer && d.activityId !== 'transaction-scope') { const flow = await scopeSequence(d.childIds ?? [], depth + 1); if (flow !== 'normal') return flow; }
        }
      } finally { onNodeEnd(id); }
    }
    return 'normal';
  }

  for (const node of topLevel) {
    if (_stopRequested) { onLog('Stopped by user', 'Warning'); return 'stopped'; }
    onNodeStart(node.id);
    await maybeBreak(node.id, 0);
    if (_stopRequested) { onNodeEnd(node.id); onLog('Stopped by user', 'Warning'); return 'stopped'; }
    onLog(`→ ${node.data.label}`, 'Info');

    if (node.data.activityId === 'transaction-scope') {
      const ok = await runWithValues(node.data.activityId, node.data.properties); onNodeEnd(node.id);
      if (!ok) return _stopRequested ? 'stopped' : 'error';
      continue;
    }

    if (node.data.isContainer) {
      if (node.data.activityId === 'retry-scope') {
        const childIds = node.data.childIds ?? [];
        const children = childIds.map((id) => nodes.find((item) => item.id === id)).filter(Boolean) as Node<WorkflowNodeData>[];
        const maxRetries = Math.max(0, Number(node.data.properties.maxRetries ?? 3));
        const retryDelay = Math.max(0, Number(node.data.properties.retryDelay ?? 1000));
        let succeeded = false;

        for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
          if (attempt > 0) {
            onLog(`  Retry ${attempt} of ${maxRetries}`, 'Warning');
            if (retryDelay > 0) await sleep(retryDelay);
          }
          let attemptSucceeded = true;
          for (const child of children) {
            if (_stopRequested) { onNodeEnd(node.id); onLog('Stopped by user', 'Warning'); return 'stopped'; }
            onNodeStart(child.id);
            await maybeBreak(child.id, 1);
            if (_stopRequested) { onNodeEnd(child.id); onNodeEnd(node.id); onLog('Stopped by user', 'Warning'); return 'stopped'; }
            onLog(`  → ${child.data.label}`, 'Info');
            const childOk = await runWithValues(child.data.activityId, child.data.properties);
            onNodeEnd(child.id);
            if (!childOk) { if (lastActivityFailure instanceof BusinessRuleException || lastActivityFailure instanceof TransactionScopeFailure) { onNodeEnd(node.id); return 'error'; } attemptSucceeded = false; break; }
          }
          if (attemptSucceeded) { succeeded = true; break; }
        }
        onNodeEnd(node.id);
        if (!succeeded) { onLog(`✗  "${node.data.label}" exhausted all retries`, 'Error'); return 'error'; }
        continue;
      }

      if (node.data.activityId === 'for-each') {
        const loopVariable = node.data.loopVariable;
        const items = resolveCollection(node.data.properties.collection, values);
        if (!loopVariable || !items) {
          onNodeEnd(node.id);
          onLog('✗  For Each requires a selected collection', 'Error');
          return 'error';
        }
        const children = (node.data.childIds ?? []).map((id) => nodes.find((item) => item.id === id)).filter(Boolean) as Node<WorkflowNodeData>[];
        const previousValue = values[loopVariable.name];
        const hadPreviousValue = loopVariable.name in values;
        onLog(`  Iterating ${items.length} item${items.length === 1 ? '' : 's'} as ${loopVariable.name}`, 'Info');

        let shouldBreakLoop = false;
        for (const item of items) {
          values[loopVariable.name] = item;
          live?.capture(values, node.id);
          for (const child of children) {
            if (_stopRequested) {
              if (hadPreviousValue) values[loopVariable.name] = previousValue;
              else delete values[loopVariable.name];
              onNodeEnd(node.id);
              onLog('Stopped by user', 'Warning');
              return 'stopped';
            }
            onNodeStart(child.id);
            await maybeBreak(child.id, 1);
            if (_stopRequested) {
              onNodeEnd(child.id);
              if (hadPreviousValue) values[loopVariable.name] = previousValue;
              else delete values[loopVariable.name];
              onNodeEnd(node.id);
              onLog('Stopped by user', 'Warning');
              return 'stopped';
            }
            onLog(`  → ${child.data.label}`, 'Info');
            if (child.data.activityId === 'break') {
              onNodeEnd(child.id);
              onLog('  Break: exiting For Each', 'Info');
              shouldBreakLoop = true;
              break;
            }
            if (child.data.activityId === 'continue') {
              onNodeEnd(child.id);
              onLog('  Continue: next For Each item', 'Info');
              break;
            }
            const childOk = await runWithValues(child.data.activityId, child.data.properties);
            onNodeEnd(child.id);
            if (!childOk) {
              if (hadPreviousValue) values[loopVariable.name] = previousValue;
              else delete values[loopVariable.name];
              onNodeEnd(node.id);
              onLog(`✗  "${child.data.label}" failed`, 'Error');
              return 'error';
            }
          }
          if (shouldBreakLoop) break;
        }
        if (hadPreviousValue) values[loopVariable.name] = previousValue;
        else delete values[loopVariable.name];
        onNodeEnd(node.id);
        continue;
      }

      if (node.data.activityId === 'if') {
        const branches = node.data.branches ?? [];
        let selectedBranch = undefined;
        for (const branch of branches) {
          if (branch.kind === 'else') {
            selectedBranch ??= branch;
            continue;
          }
          if (!branch.condition.trim()) {
            onNodeEnd(node.id);
            onLog(`✗  ${branch.kind === 'if' ? 'IF' : 'ELSE IF'} condition is required`, 'Error');
            return 'error';
          }
          if (evaluateCondition(branch.condition, values)) {
            selectedBranch = branch;
            break;
          }
        }

        if (!selectedBranch) {
          onLog('  No IF branch matched.', 'Warning');
          onNodeEnd(node.id);
          continue;
        }

        const branchLabel = selectedBranch.kind === 'if' ? 'IF' : selectedBranch.kind === 'elseIf' ? 'ELSE IF' : 'ELSE';
        onLog(`  ${branchLabel} branch selected`, 'Info');
        const children = selectedBranch.childIds.map((id) => nodes.find((item) => item.id === id)).filter(Boolean) as Node<WorkflowNodeData>[];
        for (const child of children) {
          if (_stopRequested) { onLog('Stopped by user', 'Warning'); onNodeEnd(node.id); return 'stopped'; }
          onNodeStart(child.id);
          await maybeBreak(child.id, 1);
          if (_stopRequested) { onNodeEnd(child.id); onNodeEnd(node.id); onLog('Stopped by user', 'Warning'); return 'stopped'; }
          onLog(`  → ${child.data.label}`, 'Info');
          const childOk = await runWithValues(child.data.activityId, child.data.properties);
          onNodeEnd(child.id);
          if (!childOk) { onNodeEnd(node.id); onLog(`✗  "${child.data.label}" failed`, 'Error'); return 'error'; }
        }
        onNodeEnd(node.id);
        continue;
      }

      if (node.data.activityId === 'try-catch') {
        const branches = node.data.branches ?? [];
        const runBranch = async (branch: typeof branches[number], label: string): Promise<'completed' | 'failed' | 'stopped'> => {
          const children = branch.childIds.map((id) => nodes.find((item) => item.id === id)).filter(Boolean) as Node<WorkflowNodeData>[];
          if (children.length > 0) onLog(`  ${label} branch`, 'Info');
          for (const child of children) {
            if (_stopRequested) return 'stopped';
            onNodeStart(child.id);
            await maybeBreak(child.id, 1);
            if (_stopRequested) { onNodeEnd(child.id); return 'stopped'; }
            onLog(`  → ${child.data.label}`, 'Info');
            const childOk = await runWithValues(child.data.activityId, child.data.properties);
            onNodeEnd(child.id);
            if (!childOk) return 'failed';
          }
          return 'completed';
        };

        const tryBranch = branches.find((branch) => branch.kind === 'try');
        if (!tryBranch) {
          onNodeEnd(node.id);
          onLog('✗  Try Catch block has no TRY branch', 'Error');
          return 'error';
        }

        let result = await runBranch(tryBranch, 'TRY');
        if (result === 'failed') {
          const catches = branches.filter((branch) => branch.kind === 'catch');
          if (catches.length === 0) onLog('✗  TRY failed and no CATCH branch is available', 'Error');
          for (let index = 0; result === 'failed' && index < catches.length; index += 1) {
            onLog(`  CATCH ${index + 1} handling failure`, 'Warning');
            result = await runBranch(catches[index], `CATCH ${index + 1}`);
          }
        }

        const finallyBranch = branches.find((branch) => branch.kind === 'finally');
        if (finallyBranch) {
          const finallyResult = await runBranch(finallyBranch, 'FINALLY');
          if (finallyResult === 'stopped') result = 'stopped';
          else if (finallyResult === 'failed') result = 'failed';
        }

        onNodeEnd(node.id);
        if (result === 'stopped') { onLog('Stopped by user', 'Warning'); return 'stopped'; }
        if (result === 'failed') { onLog(`✗  "${node.data.label}" failed`, 'Error'); return 'error'; }
        continue;
      }

      // Open the browser/application context
      const ok = await runWithValues(node.data.activityId, node.data.properties);
      if (!ok) { onNodeEnd(node.id); onLog(`✗  "${node.data.label}" failed`, 'Error'); return 'error'; }

      // Run child activities in sequence
      const childIds = node.data.childIds ?? [];
      const children = childIds.map((id) => nodes.find((n) => n.id === id)).filter(Boolean) as Node<WorkflowNodeData>[];
      for (const child of children) {
        if (_stopRequested) { onLog('Stopped by user', 'Warning'); onNodeEnd(node.id); return 'stopped'; }
        onNodeStart(child.id);
        await maybeBreak(child.id, 1);
        if (_stopRequested) { onNodeEnd(child.id); onNodeEnd(node.id); onLog('Stopped by user', 'Warning'); return 'stopped'; }
        onLog(`  → ${child.data.label}`, 'Info');
        const childOk = await runWithValues(child.data.activityId, child.data.properties);
        onNodeEnd(child.id);
        if (!childOk) { onNodeEnd(node.id); onLog(`✗  "${child.data.label}" failed`, 'Error'); return 'error'; }
      }
    } else {
      const ok = await runWithValues(node.data.activityId, node.data.properties);
      if (!ok) { onNodeEnd(node.id); onLog(`✗  "${node.data.label}" failed — execution stopped`, 'Error'); return 'error'; }
    }

    onNodeEnd(node.id);
  }

  if (_stopRequested) { onLog('Stopped by user', 'Warning'); return 'stopped'; }
  onLog('✔  Workflow completed', 'Info');
  return 'completed';
}

