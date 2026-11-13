import type { ReactNode } from 'react';
import { useUiTargetStore } from '../../store/uiTargetStore';
import { useWorkflowStore } from '../../store/workflowStore';
import { useUiStore } from '../../store/uiStore';
import { Icon } from '../Icon';
import './UiTargets.css';

export function TargetSelector({ nodeId, property, targetType, application, children }: {
  nodeId: string; property: string; targetType: 'browser' | 'desktop'; application: string; children: ReactNode;
}) {
  const { targets } = useUiTargetStore();
  const { nodes, bindUiTarget } = useWorkflowStore();
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  const id = node.data.targetBindings?.[property];
  const target = targets.find((t) => t.id === id);
  const manage = () => {
    useUiStore.setState({ activeBottomPanelTab: 'targets', selectedUiTargetId: id || null, uiTargetDraft: null });
  };
  return <div className="target-selector">
    <select aria-label={`Shared UI target for ${property}`} value={id || ''} onChange={(e) => bindUiTarget(nodeId, property, e.target.value || null)}>
      <option value="">Local selector</option>
      {id && !target && <option value={id}>Missing target — reconnect</option>}
      {targets.filter((t) => t.targetType === targetType || t.id === id).sort((a, b) => `${a.application}/${a.name}`.localeCompare(`${b.application}/${b.name}`)).map((t) => <option key={t.id} value={t.id}>{t.application ? `${t.application} / ` : ''}{t.name}</option>)}
    </select>
    {id ? <>
      <textarea className={`target-selector__resolved${!target ? ' target-selector__resolved--missing' : ''}`} aria-label="Shared selector" value={target?.selector || 'Target missing. Choose another target or unlink to use a local selector.'} readOnly rows={3} />
      <div className="target-selector__actions"><button type="button" onClick={manage}><Icon name="layers" size={13} />Edit in library</button><button type="button" onClick={() => bindUiTarget(nodeId, property, null)}>Unlink</button></div>
      <span className="target-selector__hint">{target ? 'Linked · always uses the current library selector.' : 'Running is blocked until this reference is repaired.'}</span>
    </> : <>
      {children}
      <button type="button" className="target-selector__save" disabled={!String(node.data.properties[property] || '').trim()} onClick={() => useUiStore.setState({
        activeBottomPanelTab: 'targets', selectedUiTargetId: null,
        uiTargetDraft: { nodeId, property, selector: String(node.data.properties[property] || ''), targetType, application, name: node.data.label },
      })}><Icon name="plus" size={13} />Save as shared target</button>
    </>}
  </div>;
}
