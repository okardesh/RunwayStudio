import { useDebugStore } from '../../store/debugStore';
import { Icon } from '../Icon';
import './DebugWorkflowView.css';

export function DebugWorkflowView() {
  const { frames, phase, breakpointOverrides } = useDebugStore();
  const frame = frames[frames.length - 1];
  if (!frame) return null;
  const ordered: Array<{ node: typeof frame.nodes[number]; indent: number }> = [], visited = new Set<string>();
  const visit = (id: string, indent: number) => {
    if (visited.has(id) || indent > 16) return;
    const node = frame.nodes.find((n) => n.id === id); if (!node) return;
    visited.add(id); ordered.push({ node, indent });
    for (const childId of [...(node.data.childIds ?? []), ...(node.data.branches ?? []).flatMap((b) => b.childIds)]) visit(childId, indent + 1);
  };
  for (const node of frame.nodes.filter((n) => !n.data.parentId)) visit(node.id, 0);
  for (const node of frame.nodes) if (!visited.has(node.id)) visit(node.id, 0);
  return <section className="seq-canvas debug-workflow-view" aria-label="Invoked workflow debug source"><header className="dwv-header"><Icon name="branch" /><div><strong>{frame.projectName}</strong><small>{frame.filePath}</small></div><span>Read-only debug source · {phase}</span></header>
    <nav className="dwv-stack" aria-label="Debug call stack">{frames.map((f, index) => <span key={f.id}>{index ? ' → ' : ''}{f.projectName}</span>)}</nav>
    <div className="dwv-activities">{ordered.map(({ node, indent }) => {
      const key = `${frame.filePath ?? '<root>'}:${node.id}`;
      const enabled = breakpointOverrides[key] ?? !!node.data.breakpoint;
      return <div key={node.id} className={`dwv-activity${frame.nodeId === node.id ? ' dwv-activity--current' : ''}`} style={{ marginLeft: indent * 18 }}><button aria-label={`Session breakpoint ${node.data.label}`} title="Toggle breakpoint for this debug session; files are unchanged" className={enabled ? 'dwv-breakpoint dwv-breakpoint--set' : 'dwv-breakpoint'} onClick={() => useDebugStore.setState((state) => ({ breakpointOverrides: { ...state.breakpointOverrides, [key]: !enabled } }))}>●</button><Icon name={frame.nodeId === node.id ? 'arrowRight' : 'box'} size={16} /><div><strong>{node.data.label}</strong><small>{node.data.activityId}{node.data.breakpointCondition ? ` · when ${node.data.breakpointCondition}` : ''}{node.data.breakpointHitCount ? ` · hit ${node.data.breakpointHitCount}` : ''}</small></div></div>;
    })}</div><footer>Step Into, Step Over, Continue and Stop control the active called workflow. Locals & Watch shows this frame's values.</footer></section>;
}
