import type { WorkflowArgument } from '../types';

export type RobotJobStatus = 'queued' | 'running' | 'stopping' | 'waiting' | 'stopped' | 'success' | 'failed';
export const jobIsTerminal = (status: RobotJobStatus) => ['stopped', 'success', 'failed'].includes(status);
export interface RobotJobLog { sequence: number; timestamp: string; level: 'info' | 'error'; message: string }
export interface RobotJobView {
  jobId: string; status: RobotJobStatus; startedAt: number; completedAt?: number;
  environment?: { id: string; name: string };
  transactions?: import('./queues').TransactionEvent[];
  humanTasks?: import('./humanTasks').HumanTaskEvent[];
  waitingTask?: { id: string; checkpointId: string };
  resumeId?: string;
  logs: RobotJobLog[]; outputs?: unknown; error?: string;
  package?: { id: string; version: string };
  workflowCalls?: Array<{ name: string; depth: number; status: string }>;
}
export interface RobotChoice { id: string; name: string; online: boolean }
export interface JobPackageChoice {
  workflowId: string; name: string; version: string; packageId: string;
  inputArguments: WorkflowArgument[]; requiredAssets?: import('./assets').AssetRequirement[]; requiredQueues?: Array<{name: string; operations: string[]}>;
}
export interface RobotJobCatalog { robots: RobotChoice[]; packages: JobPackageChoice[]; environments?: import('./assets').EnvironmentProfile[] }
export interface RobotJobRequest {
  requestId: string; robotId: string; workflowId: string; version: string; packageId: string;
  environmentId?: string;
  inputs: Record<string, unknown>;
}

const sensitive = /password|secret|token|api.?key|credential|authorization/i;
export function jobSecrets(value: unknown, found = new Set<string>(), depth = 0): Set<string> {
  if (!value || typeof value !== 'object' || depth > 12) return found;
  for (const [key, next] of Object.entries(value).slice(0, 1000)) {
    if (sensitive.test(key) && typeof next === 'string' && next) found.add(next);
    if (next && typeof next === 'object') jobSecrets(next, found, depth + 1);
  }
  return found;
}
export function redactJobValue(value: unknown, secrets: Set<string>, depth = 0): unknown {
  if (depth > 12) return '[Depth limit]';
  if (typeof value === 'string') { let s = value; for (const secret of [...secrets].sort((a, b) => b.length - a.length)) s = s.split(secret).join('[REDACTED]'); return s; }
  if (Array.isArray(value)) return value.slice(0, 1000).map(v => redactJobValue(v, secrets, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 1000).map(([k, v]) => [k, sensitive.test(k) ? '[REDACTED]' : redactJobValue(v, secrets, depth + 1)]));
  return value;
}
