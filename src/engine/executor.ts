import type { Node, Edge } from 'reactflow';
import type { WorkflowNodeData } from '../types';

export type LogLevel = 'Info' | 'Warning' | 'Error' | 'Debug';
export type LogFn = (text: string, level: LogLevel) => void;

let _stopRequested = false;
export function requestStop() { _stopRequested = true; }

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Returns true when running inside Electron with the automation bridge available
const isElectron = () =>
  typeof window !== 'undefined' && 'electronAPI' in window && typeof (window as any).electronAPI?.executeActivity === 'function';

// Best-effort browser-mode simulation for activities that can be faked in a web page
function browserFallback(activityId: string, properties: Record<string, unknown>, onLog: LogFn): boolean {
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
): Promise<boolean> {
  if (isElectron()) {
    const api = (window as any).electronAPI;
    const result: { success: boolean; log: string; outputs?: Record<string, unknown> } =
      await api.executeActivity(activityId, properties);
    onLog(`   ${result.log}`, result.success ? 'Info' : 'Error');
    return result.success;
  }
  // Browser-mode fallback — simulate what we can
  await sleep(300);
  return browserFallback(activityId, properties, onLog);
}

export async function executeWorkflow(
  nodes: Node<WorkflowNodeData>[],
  _edges: Edge[],
  onNodeStart: (id: string) => void,
  onNodeEnd:   (id: string) => void,
  onLog: LogFn
): Promise<'completed' | 'stopped' | 'error'> {
  _stopRequested = false;

  const topLevel = nodes.filter((n) => !n.data.parentId);
  if (topLevel.length === 0) {
    onLog('Nothing to run — drag activities onto the canvas first.', 'Warning');
    return 'error';
  }

  onLog('▶  Workflow started', 'Info');

  for (const node of topLevel) {
    if (_stopRequested) { onLog('Stopped by user', 'Warning'); return 'stopped'; }
    onNodeStart(node.id);
    onLog(`→ ${node.data.label}`, 'Info');

    if (node.data.isContainer) {
      // Open the browser/application context
      const ok = await runActivity(node.data.activityId, node.data.properties, onLog);
      if (!ok) { onNodeEnd(node.id); onLog(`✗  "${node.data.label}" failed`, 'Error'); return 'error'; }

      // Run child activities in sequence
      const childIds = node.data.childIds ?? [];
      const children = childIds.map((id) => nodes.find((n) => n.id === id)).filter(Boolean) as Node<WorkflowNodeData>[];
      for (const child of children) {
        if (_stopRequested) { onLog('Stopped by user', 'Warning'); onNodeEnd(node.id); return 'stopped'; }
        onNodeStart(child.id);
        onLog(`  → ${child.data.label}`, 'Info');
        const childOk = await runActivity(child.data.activityId, child.data.properties, onLog);
        onNodeEnd(child.id);
        if (!childOk) { onNodeEnd(node.id); onLog(`✗  "${child.data.label}" failed`, 'Error'); return 'error'; }
      }
    } else {
      const ok = await runActivity(node.data.activityId, node.data.properties, onLog);
      if (!ok) { onNodeEnd(node.id); onLog(`✗  "${node.data.label}" failed — execution stopped`, 'Error'); return 'error'; }
    }

    onNodeEnd(node.id);
  }

  onLog('✔  Workflow completed', 'Info');
  return 'completed';
}

