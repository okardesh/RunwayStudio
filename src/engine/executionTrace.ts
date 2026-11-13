import type { Node } from 'reactflow';
import type { WorkflowArgument, WorkflowNodeData, WorkflowVariable } from '../types';
import { snapshot, useExecutionHistoryStore, type ExecutionRun, type ExecutionStep } from '../store/executionHistoryStore';
import { assertTestValues, type TestExecution } from '../shared/workflowTests';

export function createExecutionTrace(nodes: Node<WorkflowNodeData>[], variables: WorkflowVariable[], meta?: { projectName?: string; filePath?: string | null; debug?: boolean; test?: TestExecution; parentRunId?: string; rootRunId?: string; invocationNodeId?: string; callDepth?: number; arguments?: WorkflowArgument[]; inheritedSecrets?: string[] }) {
  const run: ExecutionRun = {
    id: crypto.randomUUID(), projectName: meta?.projectName || 'Workflow', filePath: meta?.filePath ?? null,
    startedAt: Date.now(), status: 'running', debug: !!meta?.debug, steps: [],
  };
  if (meta?.parentRunId) { run.parentRunId = meta.parentRunId; run.rootRunId = meta.rootRunId; run.invocationNodeId = meta.invocationNodeId; run.callDepth = meta.callDepth; }
  if (meta?.test) { const { expected: _expected, ...identity } = meta.test; run.test = { ...identity, status: 'running', assertions: [] }; }
  let runtimeValues: Record<string, unknown> = {};
  const secrets = [...(meta?.inheritedSecrets ?? []), ...variables.filter((v) => /password|secret|token|api.?key|credential/i.test(v.name)).map((v) => String(v.defaultValue)).filter(Boolean)];
  for (const node of nodes) for (const [key, value] of Object.entries(node.data.properties)) {
    if (/password|secret|token|api.?key|credential|authorization/i.test(key) && typeof value === 'string' && !value.includes('{{')) secrets.push(value);
  }
  const clean = (value: unknown) => {
    const result = snapshot(value, secrets);
    const json = JSON.stringify(result);
    return json && json.length > 8000 ? json.slice(0, 8000) + '… [Snapshot limit]' : result;
  };
  const active = new Map<string, ExecutionStep>();
  const collectSecrets = (values: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(values)) {
      if (/password|secret|token|api.?key|credential|authorization/i.test(key) && typeof value === 'string' && value && !secrets.includes(value)) secrets.push(value);
    }
  };
  let touched: ExecutionStep | undefined;
  let screenshots = 0;
  let lastSaved = 0;
  const publish = (persist = false) => {
    const shouldSave = persist || Date.now() - lastSaved > 1000;
    if (shouldSave) lastSaved = Date.now();
    useExecutionHistoryStore.getState().publish(run, shouldSave);
  };
  publish();
  return {
    runId: run.id,
    secrets,
    runtime(values: Record<string, unknown>) {
      runtimeValues = values; collectSecrets(values);
      if (meta?.arguments?.length && !run.arguments) run.arguments = { inputs: clean(Object.fromEntries(meta.arguments.filter((a) => a.direction === 'In').map((a) => [a.name, values[a.name]]))) };
    },
    start(id: string, values: Record<string, unknown>) {
      collectSecrets(values);
      const node = nodes.find((n) => n.id === id);
      if (!node) return;
      if (run.steps.length >= 300) { run.truncated = true; touched = undefined; return; }
      const step: ExecutionStep = { id: crypto.randomUUID(), nodeId: id, label: String(clean(node.data.label)),
        activityId: node.data.activityId, startedAt: Date.now(), status: 'running', inputs: clean({ properties: node.data.properties, variables: values }) };
      run.steps.push(step); active.set(id, step); touched = step; publish();
    },
    end(id: string, stopped: boolean) {
      const step = active.get(id);
      if (!step) return;
      step.endedAt = Date.now(); step.status = stopped ? 'stopped' : step.error ? 'error' : 'completed';
      touched = step; active.delete(id); publish();
    },
    inputs(properties: Record<string, unknown>) {
      collectSecrets(properties);
      if (touched) touched.inputs = clean(properties);
    },
    outputs(values: Record<string, unknown>) {
      collectSecrets(values);
      if (touched) touched.outputs = clean(values);
    },
    error(message: string) {
      if (touched) { touched.error ||= String(clean(message)); touched.status = 'error'; }
    },
    async captureFailure() {
      const step = touched;
      if (!step || step.screenshot || step.screenshotNote) return;
      if (!useExecutionHistoryStore.getState().captureScreenshots) { step.screenshotNote = 'Screenshot capture was disabled.'; return; }
      if (screenshots >= 3) { step.screenshotNote = 'Screenshot limit reached (3 per run).'; return; }
      const capture = (window as any).electronAPI?.captureFailureScreenshot;
      if (!capture) { step.screenshotNote = 'Desktop screenshots are available in the desktop app.'; return; }
      screenshots++;
      try {
        let timer: ReturnType<typeof setTimeout> | undefined;
        let result;
        try {
          result = await Promise.race([capture(), new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('Screenshot timeout')), 3000);
          })]);
        } finally { clearTimeout(timer); }
        if (result?.image) step.screenshot = result.image;
        else step.screenshotNote = result?.error || 'Screenshot unavailable.';
      } catch { step.screenshotNote = 'Screenshot capture failed.'; }
      publish();
    },
    async finish(status: 'completed' | 'stopped' | 'error', error?: unknown) {
      if (error) this.error(error instanceof Error ? error.message : String(error));
      if (status === 'error') {
        if (touched) { touched.status = 'error'; touched.error ||= 'Workflow failed at this activity.'; }
        await this.captureFailure();
        run.error = touched?.error || 'Workflow could not be executed.';
      }
      run.status = status; run.endedAt = Date.now();
      if (run.arguments && meta?.arguments) run.arguments.outputs = clean(Object.fromEntries(meta.arguments.filter((a) => a.direction === 'Out').map((a) => [a.name, runtimeValues[a.name]])));
      if (run.test && meta?.test) {
        const assertions = status === 'completed' ? assertTestValues(meta.test.expected, runtimeValues, secrets) : [];
        run.test = { ...run.test, status: status === 'completed' ? assertions.every((a) => a.passed) ? 'passed' : 'failed' : status, assertions };
      }
      runtimeValues = {};
      for (const step of active.values()) { step.status = status === 'completed' ? 'completed' : status; step.endedAt = run.endedAt; }
      publish(true);
    },
  };
}
