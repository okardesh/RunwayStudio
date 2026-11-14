import { create } from 'zustand';
import type { TestRunResult } from '../shared/workflowTests';

export type RunStatus = 'running' | 'waiting' | 'completed' | 'error' | 'stopped' | 'interrupted';
export interface ExecutionStep {
  id: string;
  nodeId: string;
  label: string;
  activityId: string;
  startedAt: number;
  endedAt?: number;
  status: RunStatus;
  inputs: unknown;
  outputs?: unknown;
  error?: string;
  screenshot?: string;
  screenshotNote?: string;
}
export interface ExecutionRun {
  id: string;
  projectName: string;
  filePath: string | null;
  startedAt: number;
  endedAt?: number;
  status: RunStatus;
  debug: boolean;
  environment?: { id: string; name: string };
  transactions?: import('../shared/queues').TransactionEvent[];
  humanTasks?: import('../shared/humanTasks').HumanTaskEvent[];
  parentRunId?: string;
  rootRunId?: string;
  invocationNodeId?: string;
  callDepth?: number;
  arguments?: { inputs: unknown; outputs?: unknown };
  steps: ExecutionStep[];
  error?: string;
  truncated?: boolean;
  test?: TestRunResult;
  robotJob?: import('./robotJobsStore').RemoteJob;
}

const KEY = 'runway.execution-history.v1';
const CAPTURE_KEY = 'runway.execution-history.capture';
function loadRuns(): ExecutionRun[] {
  try {
    const runs = JSON.parse(localStorage.getItem(KEY) || '[]');
    if (!Array.isArray(runs)) return [];
    return runs.filter((r) => typeof r.id === 'string' && Array.isArray(r.steps) && typeof r.startedAt === 'number')
      .slice(0, 20).map((r) => ({ ...r, status: r.status === 'running' ? 'interrupted' : r.status,
        ...(r.test ? { test: { ...r.test, status: r.test.status === 'running' ? 'stopped' : r.test.status } } : {}),
        steps: r.steps.map((s: ExecutionStep) => ({ ...s, status: s.status === 'running' ? 'interrupted' : s.status })) }));
  } catch { return []; }
}
function loadCapture() {
  try { return localStorage.getItem(CAPTURE_KEY) !== 'false'; } catch { return false; }
}

interface HistoryState {
  runs: ExecutionRun[];
  captureScreenshots: boolean;
  storageWarning: string | null;
  publish: (run: ExecutionRun, persist?: boolean) => void;
  clear: () => void;
  setCaptureScreenshots: (enabled: boolean) => void;
}

export const useExecutionHistoryStore = create<HistoryState>((set) => ({
  runs: loadRuns(), captureScreenshots: loadCapture(), storageWarning: null,
  publish: (run, persist = false) => set((state) => {
    const runs = [{ ...run, steps: run.steps.map((step) => ({ ...step })) }, ...state.runs.filter((r) => r.id !== run.id)].slice(0, 20);
    let storageWarning = state.storageWarning;
    if (persist) {
      try {
        // Keep recent history under a conservative localStorage budget.
        const saved = runs.slice();
        while (JSON.stringify(saved).length > 1_500_000 && saved.length > 1) saved.pop();
        if (saved[0] && JSON.stringify(saved).length > 1_500_000) {
          saved[0] = { ...saved[0], steps: saved[0].steps.map(({ screenshot: _image, ...step }) => ({ ...step,
            screenshotNote: _image ? 'Screenshot omitted from saved history to fit local storage.' : step.screenshotNote })) };
          while (JSON.stringify(saved).length > 1_500_000 && saved[0].steps.length) {
            saved[0] = { ...saved[0], steps: saved[0].steps.slice(0, -1), truncated: true };
          }
        }
        localStorage.setItem(KEY, JSON.stringify(saved));
        storageWarning = saved.length < runs.length ? 'Only the most recent runs fit in local storage.' : null;
      } catch { storageWarning = 'History is available in this session; local storage could not be updated.'; }
    }
    return { runs, storageWarning };
  }),
  clear: () => set((state) => {
    try { localStorage.removeItem(KEY); }
    catch { return { storageWarning: 'Could not clear local history. Please try again.' }; }
    return { runs: state.runs.filter((r) => r.status === 'running'), storageWarning: null };
  }),
  setCaptureScreenshots: (enabled) => {
    try { localStorage.setItem(CAPTURE_KEY, String(enabled)); } catch { /* Session setting still works. */ }
    set({ captureScreenshots: enabled });
  },
}));

// Snapshots must not retain mutable collection references or known credentials.
export function snapshot(value: unknown, secrets: string[] = [], depth = 0): unknown {
  if (depth > 5) return '[Depth limit]';
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'string') {
    let text = value;
    for (const secret of secrets) if (secret) text = text.split(secret).join('[REDACTED]');
    return text.length > 2000 ? text.slice(0, 2000) + '…' : text;
  }
  if (Array.isArray(value)) return value.slice(0, 30).map((v) => snapshot(v, secrets, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 50).map(([k, v]) =>
    [k, /password|secret|token|api.?key|credential|authorization/i.test(k) ? '[REDACTED]' : snapshot(v, secrets, depth + 1)]));
  return value;
}
