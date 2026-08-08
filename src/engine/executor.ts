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

function resolveProperties(properties: Record<string, unknown>, values: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(properties).map(([key, value]) => [
    key,
    typeof value === 'string'
      ? value.replace(/\{\{\s*([A-Za-z_]\w*)\s*\}\}/g, (_match, name: string) => String(values[name] ?? `{{${name}}}`))
      : value,
  ]));
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

