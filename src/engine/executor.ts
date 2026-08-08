import type { Node, Edge } from 'reactflow';
import type { WorkflowNodeData, WorkflowVariable } from '../types';

export type LogLevel = 'Info' | 'Warning' | 'Error' | 'Debug';
export type LogFn = (text: string, level: LogLevel) => void;

let _stopRequested = false;

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
      return true;
    }
    default:
      onLog(`   (simulated) ${activityId}`, 'Debug');
      return true;
  }
}

async function runActivity(
  activityId: string,
  properties: Record<string, unknown>,
  onLog: LogFn
): Promise<{ success: boolean; outputs?: Record<string, unknown> }> {
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

export interface DebugOptions {
  debug?: boolean;
  hasBreakpoint?: (nodeId: string) => boolean;
  onPause?: (nodeId: string) => void;
  onResume?: () => void;
}

export async function executeWorkflow(
  nodes: Node<WorkflowNodeData>[],
  _edges: Edge[],
  variables: WorkflowVariable[],
  onNodeStart: (id: string) => void,
  onNodeEnd:   (id: string) => void,
  onLog: LogFn,
  debugOptions?: DebugOptions
): Promise<'completed' | 'stopped' | 'error'> {
  _stopRequested = false;
  const values = Object.fromEntries(variables.map((variable) => [variable.name, variable.defaultValue]));
  const runWithValues = async (activityId: string, properties: Record<string, unknown>) => {
    const result = await runActivity(activityId, resolveProperties(properties, values), onLog);
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
  // A fresh debug run only pauses at breakpoints until the user starts stepping.
  let pendingStep: 'run' | StepMode = 'run';
  let stepOverBaseDepth = 0;

  // Pauses (awaiting a resume command) before a node runs, when debugging and either
  // it carries a breakpoint or the previous step command asked to stop here.
  async function maybeBreak(nodeId: string, depth: number) {
    if (!debug) return;
    const shouldPause =
      hasBreakpoint(nodeId) ||
      pendingStep === 'step-into' ||
      (pendingStep === 'step-over' && depth <= stepOverBaseDepth);
    if (!shouldPause) return;

    debugOptions?.onPause?.(nodeId);
    const mode = await new Promise<StepMode>((resolve) => { _resumeResolver = resolve; });
    debugOptions?.onResume?.();

    if (mode === 'continue') pendingStep = 'run';
    else if (mode === 'step-into') pendingStep = 'step-into';
    else { pendingStep = 'step-over'; stepOverBaseDepth = depth; }
  }

  onLog('▶  Workflow started', 'Info');

  for (const node of topLevel) {
    if (_stopRequested) { onLog('Stopped by user', 'Warning'); return 'stopped'; }
    onNodeStart(node.id);
    await maybeBreak(node.id, 0);
    if (_stopRequested) { onNodeEnd(node.id); onLog('Stopped by user', 'Warning'); return 'stopped'; }
    onLog(`→ ${node.data.label}`, 'Info');

    if (node.data.isContainer) {
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

  onLog('✔  Workflow completed', 'Info');
  return 'completed';
}

