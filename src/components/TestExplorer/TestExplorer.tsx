import { useState } from 'react';
import { useWorkflowStore } from '../../store/workflowStore';
import { useTestExplorerStore } from '../../store/testExplorerStore';
import { useExecutionHistoryStore } from '../../store/executionHistoryStore';
import { useUiStore } from '../../store/uiStore';
import { parseTestObject, testWorkflowKey, type WorkflowTest } from '../../shared/workflowTests';
import { runWorkflowTests, stopTestRun } from '../../engine/testRunner';
import { Icon } from '../Icon';
import './TestExplorer.css';

interface DraftRow { id: string; name: string; inputs: string; expected: string }
interface Draft { id: string; workflowKey: string; name: string; rows: DraftRow[] }
const blankRow = (index: number): DraftRow => ({ id: crypto.randomUUID(), name: `Data ${index}`, inputs: '{}', expected: '{\n  "textResult": "Expected text"\n}' });
const toDraft = (test: WorkflowTest): Draft => ({ ...test, rows: test.rows.map((r) => ({ ...r, inputs: JSON.stringify(r.inputs, null, 2), expected: JSON.stringify(r.expected, null, 2) })) });

export function TestExplorer() {
  const workflow = useWorkflowStore();
  const { tests, active, progress, save, remove } = useTestExplorerStore();
  const runs = useExecutionHistoryStore((s) => s.runs);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [rowId, setRowId] = useState('');
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const key = testWorkflowKey(workflow.filePath, workflow.projectName);
  const visible = tests.filter((test) => test.workflowKey === key);
  const results = runs.filter((r) => r.test && testWorkflowKey(r.filePath, r.projectName) === key);
  const selected = draft?.workflowKey === key ? draft : null;
  const row = selected?.rows.find((r) => r.id === rowId) ?? selected?.rows[0];
  const busy = active || workflow.status === 'running' || workflow.status === 'paused';
  const draftDirty = !!selected && dirty;
  const edit = (changes: Partial<Draft>) => { if (selected) { setDraft({ ...selected, ...changes }); setDirty(true); } };
  const editRow = (changes: Partial<DraftRow>) => { if (selected && row) edit({ rows: selected.rows.map((r) => r.id === row.id ? { ...r, ...changes } : r) }); };
  const open = (test: WorkflowTest) => { setDraft(toDraft(test)); setRowId(test.rows[0].id); setDirty(false); setError(''); };
  const run = async (items: WorkflowTest[]) => { setError(''); try { await runWorkflowTests(items); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Tests could not run.'); } };
  const saveDraft = () => {
    if (!selected) return;
    try {
      const test: WorkflowTest = { ...selected, name: selected.name.trim(), rows: selected.rows.map((r) => ({ ...r, name: r.name.trim(), inputs: parseTestObject(r.inputs), expected: parseTestObject(r.expected) })) };
      save(test); open(test);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Test could not be saved.'); }
  };
  return <div className="test-explorer">
    <header className="te-toolbar"><Icon name="shield" size={16} /><strong>Test Explorer</strong><span className="te-workflow">{workflow.projectName}</span>
      <button disabled={busy || draftDirty} onClick={() => { const first = blankRow(1); setDraft({ id: crypto.randomUUID(), workflowKey: key, name: 'New test', rows: [first] }); setRowId(first.id); setDirty(true); setError(''); }}><Icon name="plus" size={13} />New test</button>
      <button disabled={busy || draftDirty || !visible.length} onClick={() => void run(visible)}><Icon name="play" size={13} />Run all</button>
      <button disabled={!active} onClick={stopTestRun}><Icon name="stop" size={13} />Stop tests</button>
    </header>
    {error && <div className="te-error" role="alert">{error}</div>}
    {progress && <div className="te-progress" role="status">{active && <span className="te-live-dot" />}{progress}</div>}
    <div className="te-columns">
      <nav className="te-list" aria-label="Workflow tests">{visible.map((test) => {
        const latest = runs.find((r) => r.test?.testId === test.id);
        return <button key={test.id} disabled={draftDirty || busy} className={selected?.id === test.id ? 'te-selected' : ''} onClick={() => open(test)}><strong>{test.name}</strong><span>{test.rows.length} data rows{latest?.test ? ` · latest row ${latest.test.status}` : ''}</span></button>;
      })}{!visible.length && <p className="te-empty">No tests for this workflow. Create a test and define data rows with expected output values.</p>}</nav>
      <section className="te-editor" aria-label="Test definition">{selected ? <>
        <div className="te-editor-toolbar"><label>Test name<input aria-label="Test name" maxLength={100} value={selected.name} disabled={busy} onChange={(e) => edit({ name: e.target.value })} /></label>
          <button disabled={busy || !draftDirty} onClick={saveDraft}>Save test</button>
          <button disabled={busy || !draftDirty} onClick={() => { const saved = tests.find((t) => t.id === selected.id); if (saved) open(saved); else { setDraft(null); setDirty(false); } setError(''); }}>Revert</button>
          <button disabled={busy || draftDirty || !tests.some((t) => t.id === selected.id)} onClick={() => void run(tests.filter((t) => t.id === selected.id))}><Icon name="play" size={13} />Run test</button>
          <button disabled={busy || draftDirty || !tests.some((t) => t.id === selected.id)} onClick={() => { try { remove(selected.id); setDraft(null); setError(''); } catch (reason) { setError(String(reason)); } }}>Delete test</button>
        </div>
        <div className="te-row-picker"><label>Data row<select aria-label="Data row" value={row?.id ?? ''} disabled={busy} onChange={(e) => setRowId(e.target.value)}>{selected.rows.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
          <button disabled={busy || selected.rows.length >= 20} onClick={() => { const next = blankRow(selected.rows.length + 1); edit({ rows: [...selected.rows, next] }); setRowId(next.id); }}>Add row</button>
          <button disabled={busy || selected.rows.length < 2} onClick={() => { edit({ rows: selected.rows.filter((r) => r.id !== row?.id) }); setRowId(''); }}>Remove row</button>
          <span>{draftDirty ? 'Unsaved test changes' : 'Saved on this device'}</span>
        </div>
        {row && <><label className="te-row-name">Row name<input aria-label="Data row name" maxLength={100} value={row.name} disabled={busy} onChange={(e) => editRow({ name: e.target.value })} /></label>
          <div className="te-json-fields"><label>Inputs · JSON variable overrides<textarea aria-label="Test inputs JSON" spellCheck={false} maxLength={12000} disabled={busy} value={row.inputs} onChange={(e) => editRow({ inputs: e.target.value })} /></label><label>Expected values · JSON expression → value<textarea aria-label="Expected values JSON" spellCheck={false} maxLength={12000} disabled={busy} value={row.expected} onChange={(e) => editRow({ expected: e.target.value })} /></label></div></>}
        <p className="te-help">Use declared variables in Inputs, e.g. {`{"customer": "Ada"}`}. Expected values use Watch expressions, e.g. {`{"textResult": "Hello Ada", "items.Count": 2}`}. JSON types must match. Each row starts with fresh variable defaults.</p>
      </> : <div className="te-empty">Select a test or create one. Tests run the current canvas without saving workflow files. Activities use real applications; external application state is shared between rows.</div>}</section>
      <aside className="te-results" aria-label="Test results"><header>Recent results <span>Run History · last 20 runs</span></header>{results.map((r) => <button key={r.id} onClick={() => useUiStore.setState({ activeBottomPanelTab: 'history', selectedHistoryRunId: r.id })}><strong>{r.test!.testName} / {r.test!.rowName}</strong><span className={`te-status te-status--${r.test!.status}`}>{r.test!.status} · {r.test!.assertions.filter((a) => a.passed).length}/{r.test!.assertions.length} checks</span><time>{new Date(r.startedAt).toLocaleTimeString()}</time></button>)}{!results.length && <p className="te-empty">Run a test to see results. Open a result for expected / actual values and activity details.</p>}</aside>
    </div>
  </div>;
}
