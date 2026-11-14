import { useEffect, useRef, useState } from 'react';
import { accessibleSelector, type AccessibleNameMatch, type ExplorerSnapshot } from '../../shared/uiExplorer';
import { copyText } from '../../shared/clipboard';
import { useWorkflowStore } from '../../store/workflowStore';
import { useUiStore } from '../../store/uiStore';
import './UiExplorer.css';

export function UiExplorer() {
  const [windows, setWindows] = useState<{ id: string; name: string }[]>([]), [title, setTitle] = useState('');
  const [provider, setProvider] = useState<'msaa' | 'uia'>('msaa');
  const [snapshot, setSnapshot] = useState<ExplorerSnapshot | null>(null), [selected, setSelected] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set()), [query, setQuery] = useState('');
  const [selector, setSelector] = useState(''), [mode, setMode] = useState<AccessibleNameMatch>('IgnoreUnreadCount');
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
  const generation = useRef(0);
  const { nodes, selectedNodeId, updateNodeProperties } = useWorkflowStore();
  const workflowNode = nodes.find(n => n.id === selectedNodeId);
  const targetProperty = useUiStore(s => s.explorerTargetProperty) ?? 'selector';
  const canApply = !!workflowNode && Object.prototype.hasOwnProperty.call(workflowNode.data.properties, targetProperty) && !workflowNode.data.targetBindings?.[targetProperty];
  const bridge = () => (window as any).electronAPI;
  const reset = () => { generation.current++; setSnapshot(null); setSelected(''); setSelector(''); setMessage(''); setError(''); setBusy(false); };
  const refreshWindows = async () => {
    reset(); const id = generation.current; setBusy(true);
    try { if (!bridge()?.getOpenWindows) throw Error('UI Explorer requires the Windows desktop build.'); const result = await bridge().getOpenWindows(); if (id === generation.current) { setWindows(result); setTitle(current => result.some((w: any) => w.name === current) ? current : result[0]?.name ?? ''); } }
    catch (reason) { if (id === generation.current) setError(reason instanceof Error ? reason.message : 'Windows could not be listed.'); }
    finally { if (id === generation.current) setBusy(false); }
  };
  useEffect(() => { void refreshWindows(); return () => { generation.current++; }; }, []);
  const inspect = async () => {
    reset(); const id = generation.current; setBusy(true);
    try { const result: ExplorerSnapshot = await bridge().inspectUi(title, provider); if (id !== generation.current) return; setSnapshot(result); setExpanded(new Set(result.nodes.filter(n => n.parentId === null).map(n => n.id))); }
    catch (reason) { if (id === generation.current) setError(reason instanceof Error ? reason.message : 'Inspection failed. Refresh after the application changes.'); }
    finally { if (id === generation.current) setBusy(false); }
  };
  const chosen = snapshot?.nodes.find(n => n.id === selected);
  const choose = (id: string) => { generation.current++; setBusy(false); const node = snapshot?.nodes.find(n => n.id === id); setSelected(id); setMode('IgnoreUnreadCount'); setSelector(node?.selector ?? ''); setMessage(''); setError(''); };
  const validate = async (highlight = false) => {
    const id = ++generation.current; setBusy(true); setError(''); setMessage('');
    try { const result = await bridge().validateUiSelector(selector, highlight); if (id === generation.current) setMessage(result.ok ? 'One target found' + (highlight ? ' · Highlighted' : '') + ': ' + result.name : 'No target found.'); }
    catch (reason) { if (id === generation.current) setError(reason instanceof Error ? reason.message : 'Selector is not valid.'); }
    finally { if (id === generation.current) setBusy(false); }
  };
  const byId = new Map(snapshot?.nodes.map(n => [n.id, n]) ?? []);
  const allowed = new Set<string>();
  if (query) for (const node of snapshot?.nodes ?? []) if (`${node.name} ${node.controlType} ${node.automationId} ${node.className}`.toLowerCase().includes(query.toLowerCase())) {
    let current: typeof node | undefined = node;
    while (current && !allowed.has(current.id)) { allowed.add(current.id); current = current.parentId === null ? undefined : byId.get(current.parentId); }
  }
  return <section className="ui-explorer" aria-label="UI Explorer">
    <header><strong>UI Explorer</strong><select aria-label="Explorer application" value={title} disabled={busy} onChange={e => { reset(); setTitle(e.target.value); }}><option value="">Select application</option>{windows.map(w => <option key={w.id} value={w.name}>{w.name}</option>)}</select><select aria-label="Accessibility provider" value={provider} disabled={busy} onChange={e => { reset(); setProvider(e.target.value as 'msaa' | 'uia'); }}><option value="msaa">MSAA · Chromium / legacy</option><option value="uia">UI Automation · Windows</option></select><button disabled={busy} onClick={() => void refreshWindows()}>Refresh windows</button><button disabled={busy || !title} onClick={() => void inspect()}>{busy ? 'Working…' : 'Inspect'}</button></header>
    {error && <div role="alert" className="uxe-message">{error}</div>}{message && <div role="status" className="uxe-message">{message}</div>}
    {snapshot?.truncated && <div className="uxe-message">Partial snapshot: the hierarchy reached its size, depth or time limit. Switch provider or refresh after opening the target screen.</div>}
    <div className="uxe-columns"><div className="uxe-tree-panel"><input aria-label="Search UI hierarchy" placeholder="Search name, type or AutomationId…" value={query} onChange={e => setQuery(e.target.value)} /><div role="tree" aria-label="Application UI hierarchy">
      {(snapshot?.nodes ?? []).map(node => {
        let depth = 0, current = node, visible = true; const seen = new Set<string>();
        while (current.parentId !== null && !seen.has(current.id)) { seen.add(current.id); const parent = byId.get(current.parentId); if (!parent) break; if (!expanded.has(parent.id)) visible = false; depth++; current = parent; }
        if (query ? !allowed.has(node.id) : !visible) return null;
        const children = snapshot!.nodes.some(n => n.parentId === node.id);
        return <div key={node.id} role="treeitem" aria-level={depth + 1} aria-selected={selected === node.id} {...(children ? { 'aria-expanded': query ? true : expanded.has(node.id) } : {})} className={selected === node.id ? 'uxe-node uxe-selected' : 'uxe-node'} style={{ paddingLeft: 6 + depth * 14 }}>
          {children ? <button aria-label={`Toggle ${node.name || node.controlType}`} onClick={() => setExpanded(previous => { const next = new Set(previous); next.has(node.id) ? next.delete(node.id) : next.add(node.id); return next; })}>{expanded.has(node.id) || query ? '▾' : '▸'}</button> : <span className="uxe-leaf" />}
          <button title={node.name} onClick={() => choose(node.id)}><small>{node.controlType}</small> {node.name || '(unnamed)'}</button>
        </div>;
      })}
      {!snapshot && <p>Choose an open application and Inspect to load its UI hierarchy. No workflow is changed by inspection.</p>}
      {snapshot && !snapshot.nodes.length && <p>No accessible elements were exposed. Try the other provider and check application permissions.</p>}
    </div></div><div className="uxe-properties">
      <strong>Element properties</strong>{chosen ? <><dl>{Object.entries({ Name: chosen.name, 'Control type': chosen.controlType, AutomationId: chosen.automationId, 'Class name': chosen.className, Provider: snapshot?.provider }).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value || '—'}</dd></div>)}</dl>
        {chosen.protected ? <p>Protected control: its contents and selector are not exposed.</p> : <>{snapshot?.provider === 'msaa' && <label>Name matching<select aria-label="Accessible name matching" value={mode} onChange={e => { generation.current++; setBusy(false); setMode(e.target.value as AccessibleNameMatch); setSelector(accessibleSelector(title, chosen.name, chosen.controlType, e.target.value as AccessibleNameMatch)); setMessage(''); }}><option value="IgnoreUnreadCount">Ignore trailing unread message count</option><option value="Exact">Exact name</option></select></label>}
        <label>Selector<textarea aria-label="Explorer selector" rows={3} value={selector} onChange={e => { generation.current++; setBusy(false); setSelector(e.target.value); setMessage(''); }} /></label><div className="uxe-actions"><button disabled={busy || !selector} onClick={() => void validate()}>Validate</button><button disabled={busy || !selector} onClick={() => void validate(true)}>Highlight</button><button disabled={!selector} onClick={() => void copyText(selector).then(ok => setMessage(ok ? 'Selector copied.' : 'Copy failed.'))}>Copy selector</button><button disabled={!selector || !canApply || busy} onClick={() => { updateNodeProperties(workflowNode!.id, { ...workflowNode!.data.properties, [targetProperty]: selector }); setMessage('Applied to ' + workflowNode!.data.label + '. Save the workflow when ready.'); }}>Use in selected activity</button><button disabled={!selector} onClick={() => useUiStore.setState({ activeBottomPanelTab: 'targets', selectedUiTargetId: null, uiTargetDraft: { nodeId: canApply ? workflowNode!.id : '', property: targetProperty, selector, targetType: 'desktop', application: title, name: chosen.name || chosen.controlType } })}>Save to UI Target Library</button></div><small>Validate before applying. Matching requires a unique element and the same control type. Inspection is read-only; applying updates only the open workflow.</small></>}
      </> : <p>Select an element in the hierarchy to inspect its attributes and selector.</p>}
    </div></div>
  </section>;
}
