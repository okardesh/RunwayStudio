import { useEffect, useState } from 'react';
import { useExecutionHistoryStore, type ExecutionStep } from '../../store/executionHistoryStore';
import { useWorkflowStore } from '../../store/workflowStore';
import { useUiStore } from '../../store/uiStore';
import './RunHistoryPanel.css';

const duration = (start: number, end?: number) => end === undefined ? 'In progress' : `${Math.max(0, end - start).toLocaleString()} ms`;

export function RunHistoryPanel() {
  const { runs, clear, captureScreenshots, setCaptureScreenshots, storageWarning } = useExecutionHistoryStore();
  const workflow = useWorkflowStore();
  const requestedRunId = useUiStore((s) => s.selectedHistoryRunId);
  const [runId, setRunId] = useState<string | null>(null);
  const [stepId, setStepId] = useState<string | null>(null);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => { setRunId(requestedRunId && runs.some((r) => r.id === requestedRunId) ? requestedRunId : runs[0]?.id ?? null); setStepId(null); }, [runs[0]?.id, requestedRunId]);
  const run = runs.find((r) => r.id === runId) ?? runs[0];
  const steps = run?.steps.filter((s) => !errorsOnly || s.status === 'error') ?? [];
  const step = steps.find((s) => s.id === stepId) ?? steps.find((s) => s.status === 'error') ?? steps[0];
  const sameWorkflow = run && (run.filePath ? run.filePath === workflow.filePath : run.projectName === workflow.projectName);
  const canReveal = (s: ExecutionStep) => sameWorkflow && workflow.nodes.some((n) => n.id === s.nodeId && n.data.activityId === s.activityId);
  const reveal = (s: ExecutionStep) => {
    if (!canReveal(s)) return;
    const parents = new Set<string>();
    let current = workflow.nodes.find((n) => n.id === s.nodeId);
    while (current?.data.parentId && !parents.has(current.data.parentId)) {
      parents.add(current.data.parentId);
      current = workflow.nodes.find((n) => n.id === current?.data.parentId);
    }
    useWorkflowStore.setState((state) => ({ selectedNodeId: s.nodeId,
      nodes: state.nodes.map((n) => parents.has(n.id) ? { ...n, data: { ...n.data, collapsed: false } } : n) }));
    useUiStore.setState({ historyErrorNodeId: s.status === 'error' ? s.nodeId : null });
    requestAnimationFrame(() => document.querySelector('.seq-card--selected, .container-card--selected, .for-each-card--selected, .if-card--selected, .try-catch-card--selected')?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  };

  return <div className="run-history">
    <div className="rh-toolbar">
      <strong>Execution history</strong>
      <label><input type="checkbox" checked={captureScreenshots} onChange={(e) => setCaptureScreenshots(e.target.checked)} /> Capture desktop on error</label>
      <span>Stored on this device · Last 20 runs</span>
      <button onClick={() => { clear(); setRunId(null); setStepId(null); setPreview(null); useUiStore.setState({ historyErrorNodeId: null, selectedHistoryRunId: null }); }}>Clear history</button>
    </div>
    {storageWarning && <div className="rh-notice" role="status">{storageWarning}</div>}
    {!run ? <div className="bp-empty">No runs yet. Run or debug a workflow to inspect its activity timeline.</div> :
      <div className="rh-columns">
        <nav className="rh-runs" aria-label="Workflow runs">
          {runs.map((r) => <button key={r.id} className={`rh-run${r.id === run.id ? ' rh-selected' : ''}`} onClick={() => { setRunId(r.id); setStepId(null); }}>
            <strong>{r.projectName}</strong><time>{new Date(r.startedAt).toLocaleString()}</time>
            {r.test && <span className={`rh-test-label te-status--${r.test.status}`}>Test {r.test.status} · {r.test.testName} / {r.test.rowName}</span>}
            <span><span className={`rh-status rh-status--${r.status}`}>{r.status}</span> · {duration(r.startedAt, r.endedAt)}{r.debug ? ' · Debug' : ''}</span>
          </button>)}
        </nav>
        <section className="rh-timeline" aria-label="Activity timeline">
          <div className="rh-filter"><label><input type="checkbox" checked={errorsOnly} onChange={(e) => setErrorsOnly(e.target.checked)} /> Errors only</label><span>{run.steps.length} activities</span></div>
          {run.truncated && <div className="rh-notice">History limit reached. Only the first activities were retained.</div>}
          {steps.length === 0 && <div className="bp-empty">{run.error || 'No matching activities.'}</div>}
          {steps.map((s, index) => <button key={s.id} className={`rh-step${s.id === step?.id ? ' rh-selected' : ''}`} onClick={() => { setStepId(s.id); reveal(s); }}>
            <span className={`rh-dot rh-status--${s.status}`} aria-label={s.status} /><span className="rh-step-label">{index + 1}. {s.label}<small>{s.activityId} · {s.status}</small></span><time>{duration(s.startedAt, s.endedAt)}</time>
          </button>)}
        </section>
        <section className="rh-detail" aria-label="Activity details">
          {run.test && <section className="rh-test-results" aria-label="Test assertions">
            <strong className={`te-status--${run.test.status}`}>Test {run.test.status}: {run.test.testName} / {run.test.rowName}</strong>
            <small>Activity execution: {run.status}</small>
            {!!run.test.assertions.length && <small>Value previews may be shortened. Checks compare full runtime values.</small>}
            {!run.test.assertions.length && <p>{run.test.status === 'running' ? 'Assertions run after the workflow completes.' : 'Assertions were not evaluated because the workflow did not complete.'}</p>}
            {run.test.assertions.map((a) => <details key={a.expression} open={!a.passed}><summary className={a.passed ? 'te-status--passed' : 'te-status--failed'}>{a.passed ? 'Passed' : 'Failed'} · {a.expression}</summary><div>Expected<pre>{a.expected}</pre>Actual<pre>{a.actual}</pre>{a.error && <p>{a.error}</p>}</div></details>)}
          </section>}
          {step ? <>
            <div className="rh-detail-heading"><strong>{step.label}</strong><button disabled={!canReveal(step)} onClick={() => reveal(step)}>Show on canvas</button></div>
            {!canReveal(step) && <div className="rh-notice">Open the original workflow to locate this activity. The saved details remain available.</div>}
            <p>{step.status} · {duration(step.startedAt, step.endedAt)} · {new Date(step.startedAt).toLocaleTimeString()}</p>
            {step.error && <div className="rh-error" role="alert">{step.error}</div>}
            <details open><summary>Inputs</summary><pre>{JSON.stringify(step.inputs, null, 2)}</pre></details>
            <details><summary>Runtime variables after activity</summary><pre>{JSON.stringify(step.outputs ?? {}, null, 2)}</pre></details>
            {step.screenshot && <button className="rh-image" onClick={() => setPreview(step.screenshot!)} title="Enlarge error screenshot"><img src={step.screenshot} alt={`Desktop at failure: ${step.label}`} /></button>}
            {step.screenshotNote && <p>{step.screenshotNote}</p>}
            {step.screenshot && <small>First display at failure time. Screenshots can include visible application data.</small>}
          </> : <div className="bp-empty">Select an activity to inspect its details.</div>}
        </section>
      </div>}
    {preview && <div className="rh-preview" role="dialog" aria-modal="true" aria-label="Error screenshot" onKeyDown={(e) => { if (e.key === 'Escape') setPreview(null); }} onClick={() => setPreview(null)}><button autoFocus onClick={() => setPreview(null)}>Close screenshot</button><img src={preview} alt="Desktop at failure time" /></div>}
  </div>;
}
