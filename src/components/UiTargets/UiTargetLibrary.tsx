import { useEffect, useState } from 'react';
import { useUiTargetStore } from '../../store/uiTargetStore';
import { useUiStore } from '../../store/uiStore';
import { useWorkflowStore } from '../../store/workflowStore';
import type { UiTarget } from '../../shared/uiTargets';
import { Icon } from '../Icon';
import './UiTargets.css';

const blank = { name: '', application: '', selector: '', targetType: 'browser' as UiTarget['targetType'] };
export function UiTargetLibrary() {
  const { targets, workflows, add, update, remove } = useUiTargetStore();
  const { selectedUiTargetId, uiTargetDraft } = useUiStore();
  const { nodes, filePath, bindUiTarget, setSelectedNode } = useWorkflowStore();
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState(blank);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [dirty, setDirty] = useState(false);
  const selected = targets.find((t) => t.id === selectedUiTargetId);
  useEffect(() => {
    setDraft(selected ? { name: selected.name, application: selected.application, selector: selected.selector, targetType: selected.targetType } : uiTargetDraft ? { name: uiTargetDraft.name, application: uiTargetDraft.application, selector: uiTargetDraft.selector, targetType: uiTargetDraft.targetType } : blank);
    setError(''); setDirty(false);
  }, [selectedUiTargetId, uiTargetDraft, selected?.updatedAt]);
  const usages = selected ? workflows.flatMap((w) => w.usages.filter((u) => u.targetId === selected.id).map((u) => ({ ...u, workflow: w }))) : [];
  const currentUsages = selected ? nodes.filter((n) => Object.values(n.data.targetBindings || {}).includes(selected.id)) : [];
  const change = (patch: Partial<typeof draft>) => { setDraft((d) => ({ ...d, ...patch })); setDirty(true); setMessage(''); };
  const reset = (id: string | null) => { setMessage(''); setError(''); useUiStore.setState({ selectedUiTargetId: id, uiTargetDraft: null }); if (!id && !selectedUiTargetId) { setDraft(blank); setDirty(false); } };
  const select = (id: string | null) => {
    if (dirty && !window.confirm('Discard the unsaved target edit?')) return;
    reset(id);
  };
  const save = () => {
    try {
      let id = selected?.id;
      if (id) update(id, draft); else id = add(draft);
      if (uiTargetDraft && nodes.some((n) => n.id === uiTargetDraft.nodeId)) bindUiTarget(uiTargetDraft.nodeId, uiTargetDraft.property, id);
      useUiStore.setState({ selectedUiTargetId: id, uiTargetDraft: null }); setDirty(false); setError('');
      setMessage(selected ? 'Updated. All linked local workflows use this selector on their next run.' : 'UI target saved. Select it in an activity’s selector field to reuse it.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save this target.'); }
  };
  const filtered = targets.filter((t) => `${t.application} ${t.name} ${t.selector}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="ui-targets">
    <div className="ut-toolbar"><Icon name="layers" size={16} /><strong>UI Target Library</strong><span>One selector. Every linked workflow.</span><button onClick={() => select(null)}><Icon name="plus" size={14} />New target</button></div>
    <div className="ut-columns">
      <section className="ut-list" aria-label="Shared UI targets">
        <input aria-label="Search UI targets" placeholder="Search targets or applications..." value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="ut-list__items">{filtered.map((t) => <button key={t.id} className={selected?.id === t.id ? 'ut-list__item ut-list__item--selected' : 'ut-list__item'} onClick={() => select(t.id)}><Icon name={t.targetType === 'browser' ? 'browser' : 'cursor'} size={16} /><span><strong>{t.name}</strong><small>{t.application || 'General'} · {t.targetType}</small></span></button>)}
          {!filtered.length && <div className="ut-empty">{targets.length ? 'No matching targets.' : 'Create a target here, or save an activity’s selector to the library.'}</div>}
        </div>
      </section>
      <form className="ut-editor" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <div className="ut-editor__heading"><strong>{selected ? 'Edit shared target' : uiTargetDraft ? 'Save selector to library' : 'New shared target'}</strong>{selected && <span>{usages.length} known uses</span>}</div>
        <div className="ut-fields"><label>Name<input required value={draft.name} onChange={(e) => change({ name: e.target.value })} placeholder="Save invoice" /></label><label>Application<input value={draft.application} onChange={(e) => change({ application: e.target.value })} placeholder="Invoice portal" /></label><label>Target type<select value={draft.targetType} onChange={(e) => change({ targetType: e.target.value as UiTarget['targetType'] })} disabled={!!selected && (usages.length > 0 || currentUsages.length > 0)}><option value="browser">Browser</option><option value="desktop">Desktop</option></select></label></div>
        <label>Selector<textarea required aria-label="Target selector" value={draft.selector} onChange={(e) => change({ selector: e.target.value })} placeholder="#save-invoice or window:Application > automationId:save" rows={3} /></label>
        {error && <div className="ut-error" role="alert">{error}</div>}{message && <div className="ut-success" role="status">{message}</div>}
        <div className="ut-editor__footer"><span>{uiTargetDraft ? 'Saving also links the selected activity.' : 'Updates do not rewrite workflow files.'}</span><button type="submit" className="ut-primary">{selected ? 'Update target' : 'Save target'}</button></div>
      </form>
      <section className="ut-usage" aria-label="Target usage"><strong>Used by</strong><p>Known workflows are indexed when opened or saved. Published Robot versions require publishing again.</p>
        {usages.map((u, i) => <button key={`${u.workflow.key}-${u.nodeId}-${u.property}-${i}`} disabled={u.workflow.filePath !== filePath || !nodes.some((n) => n.id === u.nodeId)} title={u.workflow.filePath || 'Current unsaved workflow'} onClick={() => setSelectedNode(u.nodeId)}><Icon name="file" size={14} /><span>{u.workflow.name}<small>{u.label} · {u.property}</small></span></button>)}
        {selected && !usages.length && <span className="ut-empty">No known references yet.</span>}
        {selected && <button className="ut-delete" disabled={usages.length > 0 || currentUsages.length > 0} title={usages.length || currentUsages.length ? 'Unlink known references before deleting.' : 'Delete unused target'} onClick={() => { try { remove(selected.id); reset(null); } catch (reason) { setError(String(reason)); } }}>Delete unused target</button>}
      </section>
    </div>
  </div>;
}
