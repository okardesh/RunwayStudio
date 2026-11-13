import { executeWorkflow, isWorkflowExecuting, requestStop } from './executor';
import { useWorkflowStore } from '../store/workflowStore';
import { useTestExplorerStore } from '../store/testExplorerStore';
import { useExecutionHistoryStore } from '../store/executionHistoryStore';
import { useUiStore } from '../store/uiStore';
import { testWorkflowKey, validateTest, type WorkflowTest } from '../shared/workflowTests';

export function stopTestRun() {
  if (!useTestExplorerStore.getState().active) return;
  useTestExplorerStore.setState({ stopRequested: true, progress: 'Stopping after the current activity…' });
  requestStop();
}

export async function runWorkflowTests(selected: WorkflowTest[]) {
  const workflow = useWorkflowStore.getState();
  if (useTestExplorerStore.getState().active || isWorkflowExecuting() || workflow.status === 'running' || workflow.status === 'paused') throw Error('Stop the current run before starting tests.');
  if (!workflow.nodes.length) throw Error('Add activities to the workflow before running tests.');
  if (!selected.length) throw Error('Save a test for this workflow first.');
  const tests: WorkflowTest[] = JSON.parse(JSON.stringify(selected));
  const key = testWorkflowKey(workflow.filePath, workflow.projectName);
  const variables = new Set(workflow.variables.map((v) => v.name));
  for (const test of tests) {
    validateTest(test);
    if (test.workflowKey !== key) throw Error('These tests belong to a different workflow.');
    for (const row of test.rows) for (const name of Object.keys(row.inputs)) if (!variables.has(name)) throw Error(`Unknown input variable "${name}" in ${test.name} / ${row.name}. Declare it in Data Manager first.`);
  }
  const total = tests.reduce((count, test) => count + test.rows.length, 0);
  if (total > 100) throw Error('Run up to 100 data rows in one batch.');
  const source = JSON.parse(JSON.stringify({ nodes: workflow.nodes, edges: workflow.edges, variables: workflow.variables }));
  const batchId = crypto.randomUUID(); let completed = 0, passed = 0, failed = 0, errors = 0, stopped = false;
  useTestExplorerStore.setState({ active: true, stopRequested: false, completed: 0, total, progress: 'Starting tests…' });
  useUiStore.setState({ selectedHistoryRunId: null });
  workflow.setStatus('running');
  try {
    outer: for (const test of tests) for (const row of test.rows) {
      if (useTestExplorerStore.getState().stopRequested) { stopped = true; break outer; }
      useTestExplorerStore.setState({ progress: `${test.name} / ${row.name}` });
      const fresh = JSON.parse(JSON.stringify(source));
      const result = await executeWorkflow(fresh.nodes, fresh.edges, fresh.variables,
        (id) => useWorkflowStore.getState().setExecutingNodeId(id), () => {},
        (text, level) => useUiStore.getState().addOutputMessage({ text, level }), {
          projectName: workflow.projectName, filePath: workflow.filePath, debug: false,
          initialValues: JSON.parse(JSON.stringify(row.inputs)),
          test: { testId: test.id, testName: test.name, rowName: row.name, batchId, expected: row.expected },
        });
      completed++;
      const run = useExecutionHistoryStore.getState().runs.find((r) => r.test?.batchId === batchId);
      if (run?.test?.status === 'passed') passed++; else if (run?.test?.status === 'failed') failed++; else if (result === 'error') errors++;
      useTestExplorerStore.setState({ completed });
      if (result === 'stopped') { stopped = true; break outer; }
    }
    useTestExplorerStore.setState({ progress: `${stopped ? 'Stopped' : 'Finished'} · ${completed}/${total} rows · ${passed} passed · ${failed} failed · ${errors} errors` });
    useWorkflowStore.getState().setStatus(stopped ? 'idle' : errors || failed ? 'error' : 'completed');
  } catch (error) {
    useTestExplorerStore.setState({ progress: 'Test batch could not be completed.' });
    useWorkflowStore.getState().setStatus('error');
    throw error;
  } finally {
    useWorkflowStore.getState().setExecutingNodeId(null);
    useTestExplorerStore.setState({ active: false });
  }
}
