import { useMemo, useState } from 'react';
import { useWorkflowStore } from '../../store/workflowStore';
import { useUiTargetStore } from '../../store/uiTargetStore';
import { useWorkflowAnalyzerStore } from '../../store/workflowAnalyzerStore';
import { useUiStore } from '../../store/uiStore';
import { analysisSignature, type AnalysisFinding, type FindingSeverity } from '../../engine/workflowAnalyzer';
import { analyzeCurrentWorkflow } from '../../engine/analyzeCurrentWorkflow';
import { Icon } from '../Icon';
import './WorkflowAnalyzerPanel.css';

export function WorkflowAnalyzerPanel() {
  const { nodes, edges, variables, arguments: args, projectName, filePath } = useWorkflowStore();
  const targets = useUiTargetStore((s) => s.targets);
  const report = useWorkflowAnalyzerStore((s) => s.report);
  const [filter, setFilter] = useState<'all' | FindingSeverity>('all');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const signature = useMemo(() => analysisSignature({ nodes, edges, variables, arguments: args, targets, projectName, filePath }), [nodes, edges, variables, args, targets, projectName, filePath]);
  const stale = !!report && report.signature !== signature;
  const findings = report?.findings ?? [];
  const counts = { error: findings.filter((f) => f.severity === 'error').length, warning: findings.filter((f) => f.severity === 'warning').length, info: findings.filter((f) => f.severity === 'info').length };
  const shown = findings.filter((f) => (filter === 'all' || f.severity === filter) && `${f.code} ${f.activity} ${f.property} ${f.message}`.toLowerCase().includes(search.toLowerCase()));
  const selected = shown.find((f) => f.id === selectedId) ?? shown[0];
  const canReveal = (finding: AnalysisFinding) => !stale && !!finding.nodeId && nodes.filter((n) => n.id === finding.nodeId).length === 1;
  const reveal = (finding: AnalysisFinding) => {
    if (!canReveal(finding)) return;
    const parents = new Set<string>(); let current = nodes.find((n) => n.id === finding.nodeId);
    while (current?.data.parentId && !parents.has(current.data.parentId)) { parents.add(current.data.parentId); current = nodes.find((n) => n.id === current?.data.parentId); }
    useWorkflowStore.setState((state) => ({ selectedNodeId: finding.nodeId!, nodes: state.nodes.map((n) => parents.has(n.id) && n.data.collapsed ? { ...n, data: { ...n.data, collapsed: false } } : n) }));
    useUiStore.setState({ analyzerNodeId: finding.nodeId!, historyErrorNodeId: null });
    requestAnimationFrame(() => document.querySelector('.seq-card--selected, .container-card--selected, .for-each-card--selected, .if-card--selected, .try-catch-card--selected')?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  };
  return <div className="workflow-analyzer">
    <header className="wa-toolbar"><Icon name="shield" size={16} /><strong>Workflow Analyzer</strong><span className="wa-context">{report ? `${report.projectName} · ${new Date(report.analyzedAt).toLocaleTimeString()}` : projectName}</span><button onClick={() => { analyzeCurrentWorkflow(); setSelectedId(null); }}><Icon name="shield" size={14} />Analyze workflow</button></header>
    {stale && <div className="wa-stale" role="status">Workflow or UI targets changed. These results are out of date. Analyze again before relying on them.</div>}
    {report?.truncated && <div className="wa-stale" role="status">Analysis limits reached. Results are incomplete; reduce the workflow size or fix reported issues and analyze again.</div>}
    {!report ? <div className="wa-empty"><Icon name="shield" size={26} /><strong>Check this workflow before running it</strong><p>Choose Analyze workflow or press F8 to check required fields, variable references, UI targets and activity structure. Analysis does not execute activities or save workflow files.</p></div> : <>
      <div className="wa-filters"><button className={filter === 'all' ? 'wa-active' : ''} onClick={() => setFilter('all')}>All {findings.length}</button><button className={filter === 'error' ? 'wa-active' : ''} onClick={() => setFilter('error')}>Errors {counts.error}</button><button className={filter === 'warning' ? 'wa-active' : ''} onClick={() => setFilter('warning')}>Warnings {counts.warning}</button><button className={filter === 'info' ? 'wa-active' : ''} onClick={() => setFilter('info')}>Info {counts.info}</button><input aria-label="Search analysis findings" placeholder="Find an activity, rule or issue…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
      {!findings.length && <div className="wa-empty"><Icon name="check" size={26} /><strong>{stale ? 'No findings in the previous analysis' : 'No issues found by the current rules'}</strong><p>Static analysis cannot verify live selectors, application availability or every runtime value. Use Test Explorer to verify behavior.</p></div>}
      {!!findings.length && <div className="wa-columns"><section className="wa-findings" aria-label="Analysis findings">{shown.map((finding) => <button key={finding.id} className={`wa-finding${selected?.id === finding.id ? ' wa-finding--selected' : ''}`} onClick={() => { setSelectedId(finding.id); reveal(finding); }}><span className={`wa-severity wa-severity--${finding.severity}`}>{finding.severity}</span><span className="wa-finding-content"><strong>{finding.message}</strong><small>{finding.activity} · {finding.property}</small></span><code>{finding.code}</code></button>)}{!shown.length && <div className="wa-empty">No findings match these filters.</div>}</section>
        <aside className="wa-detail" aria-label="Analysis details">{selected ? <><span className={`wa-severity wa-severity--${selected.severity}`}>{selected.severity} · {selected.code}</span><h3>{selected.activity}</h3><p>{selected.message}</p><strong>Suggested action</strong><p>{selected.recommendation}</p><button disabled={!canReveal(selected)} onClick={() => reveal(selected)}>Show on canvas</button>{!selected.nodeId && <p className="wa-hint">This finding applies to the workflow or Data Manager.</p>}{stale && <p className="wa-hint">Analyze again to navigate current findings.</p>}</> : <p>Select a finding to view its suggested action.</p>}</aside>
      </div>}
    </>}
  </div>;
}
