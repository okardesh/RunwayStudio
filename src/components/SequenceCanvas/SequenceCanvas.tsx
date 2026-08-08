import { useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { Node } from 'reactflow';
import { useWorkflowStore } from '../../store/workflowStore';
import { getActivity } from '../../activities/registry';
import type { WorkflowNodeData } from '../../types';
import { IndicateModal } from '../IndicateModal/IndicateModal';
import { ExpressionInput } from '../PropertiesPanel/ExpressionInput';
import './SequenceCanvas.css';

// ── Container card (Use Application/Browser) ─────────────────────────────────

function ContainerCard({
  node,
  isSelected,
  isExecuting,
  onSelect,
  onDelete,
}: {
  node: Node<WorkflowNodeData>;
  isSelected: boolean;
  isExecuting: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const { nodes, addChildNodeAt, moveChildNode, deleteNode, selectedNodeId, setSelectedNode, executingNodeId, status, toggleBreakpoint } =
    useWorkflowStore();

  const [childDropIdx, setChildDropIdx] = useState(-1);
  const [childDragActive, setChildDragActive] = useState(false);
  const [childDraggingIdx, setChildDraggingIdx] = useState<number | null>(null);
  const [indicating, setIndicating] = useState(false);

  const { updateNodeProperties } = useWorkflowStore();
  const isPaused = status === 'paused';

  const childIds = node.data.childIds ?? [];
  const children = childIds.map((id) => nodes.find((n) => n.id === id)).filter(Boolean) as Node<WorkflowNodeData>[];

  const handleChildDrop = useCallback((e: React.DragEvent, idx: number) => {
    e.preventDefault();
    e.stopPropagation();
    const activityId = e.dataTransfer.getData('application/rpa-activity');
    const nodeIdxStr  = e.dataTransfer.getData('application/rpa-child-idx');
    if (activityId) {
      addChildNodeAt(node.id, activityId, idx);
    } else if (nodeIdxStr !== '') {
      const from = parseInt(nodeIdxStr, 10);
      const to = from < idx ? idx - 1 : idx;
      if (from !== to) moveChildNode(node.id, from, to);
    }
    setChildDragActive(false);
    setChildDropIdx(-1);
    setChildDraggingIdx(null);
  }, [node.id, addChildNodeAt, moveChildNode]);

  const url    = String(node.data.properties['url'] ?? '');
  const hasTarget = url.length > 0;

  return (
    <div
      className={`container-card${isSelected ? ' container-card--selected' : ''}${isExecuting ? ' container-card--executing' : ''}${isExecuting && isPaused ? ' container-card--paused' : ''}`}
      style={{ '--container-color': node.data.color } as React.CSSProperties}
      onClick={(e) => { e.stopPropagation(); onSelect(); }}
    >
      {/* Header */}
      <div className="container-card__hdr">
        <button
          className={`seq-card__bp${node.data.breakpoint ? ' seq-card__bp--set' : ''}`}
          onClick={(e) => { e.stopPropagation(); toggleBreakpoint(node.id); }}
          title={node.data.breakpoint ? 'Remove breakpoint' : 'Set breakpoint'}
        >●</button>
        {isExecuting && isPaused && <span className="seq-card__pause-arrow">▶</span>}
        <span className="container-card__hdr-icon">{node.data.icon}</span>
        <span className="container-card__hdr-name">{node.data.label}</span>
        <div className="container-card__hdr-actions">
          {!hasTarget && <span className="container-card__warn" title="No target set">⚠</span>}
          <button className="container-card__del" onClick={(e) => { e.stopPropagation(); onDelete(); }} title="Remove">×</button>
        </div>
      </div>

      {/* Indicate area */}
      <div className="container-card__indicate">
        {hasTarget ? (
          <span
            className="container-card__target-url"
            onClick={(e) => { e.stopPropagation(); setIndicating(true); }}
            title="Click to re-indicate"
          >
            🔗 {url}
          </span>
        ) : (
          <span className="container-card__indicate-hint">
            <span
              className="container-card__indicate-link"
              onClick={(e) => { e.stopPropagation(); setIndicating(true); }}
            >
              Indicate application to automate
            </span>
            <span className="container-card__indicate-sub">or drag a screen from Object Repository</span>
          </span>
        )}
      </div>

      {indicating && createPortal(
        <IndicateModal
          onConfirm={(result) => {
            updateNodeProperties(node.id, {
              ...node.data.properties,
              url: result.url,
              windowTitle: result.windowTitle,
              browser: result.browserType,
              targetType: result.targetType,
            });
            setIndicating(false);
          }}
          onClose={() => setIndicating(false)}
        />,
        document.body
      )}

      {/* Do section */}
      <div
        className="container-card__do"
        onDragEnter={(e) => { e.preventDefault(); setChildDragActive(true); }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) { setChildDragActive(false); setChildDropIdx(-1); } }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const actId = e.dataTransfer.getData('application/rpa-activity');
          if (actId && childDropIdx === -1) addChildNodeAt(node.id, actId, children.length);
          setChildDragActive(false); setChildDropIdx(-1); setChildDraggingIdx(null);
        }}
      >
        <div className="container-card__do-hdr">↳ Do</div>
        <div className="container-card__do-body">
          <InsertZone index={0} active={childDropIdx === 0} visible={childDragActive}
            onDragOver={() => setChildDropIdx(0)} onDrop={handleChildDrop} />

          {children.length === 0 && !childDragActive && (
            <div className="seq-canvas__empty" style={{ padding: '20px 12px' }}>
              <div className="seq-canvas__empty-icon">⊕</div>
              <p>Drop activity here</p>
            </div>
          )}

          {children.map((child, idx) => {
            const isDragging = childDraggingIdx === idx;
            const childIsExecuting = child.id === executingNodeId;
            const childIsSelected  = child.id === selectedNodeId;
            const childIsPaused = childIsExecuting && isPaused;
            return (
              <div key={child.id} className="seq-item" style={{ opacity: isDragging ? 0.35 : 1 }}>
                <div
                  className={`seq-card${childIsSelected ? ' seq-card--selected' : ''}${childIsExecuting ? ' seq-card--executing' : ''}${childIsPaused ? ' seq-card--paused' : ''}`}
                  style={{ borderLeftColor: child.data.color ?? '#0078D4' }}
                  onClick={(e) => { e.stopPropagation(); setSelectedNode(child.id); }}
                  draggable
                  onDragOver={(e) => e.preventDefault()}
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/rpa-child-idx', String(idx));
                    e.dataTransfer.effectAllowed = 'move';
                    setChildDraggingIdx(idx);
                    setChildDragActive(true);
                  }}
                  onDragEnd={() => setChildDraggingIdx(null)}
                >
                  <button
                    className={`seq-card__bp${child.data.breakpoint ? ' seq-card__bp--set' : ''}`}
                    onClick={(e) => { e.stopPropagation(); toggleBreakpoint(child.id); }}
                    title={child.data.breakpoint ? 'Remove breakpoint' : 'Set breakpoint'}
                  >●</button>
                  {childIsPaused && <span className="seq-card__pause-arrow">▶</span>}
                  <div className="seq-card__icon" style={{ background: child.data.color ?? '#0078D4' }}>
                    {child.data.icon}
                  </div>
                  <div className="seq-card__body">
                    <span className="seq-card__name">{child.data.label}</span>
                    {(() => {
                      const act = getActivity(child.data.activityId);
                      const hint = act?.properties.map((p) => child.data.properties[p.name]).find((v) => v && String(v).trim());
                      return hint ? <span className="seq-card__hint">{String(hint)}</span> : null;
                    })()}
                  </div>
                  {childIsExecuting && !isPaused && <div className="seq-card__spinner" />}
                  <button className="seq-card__delete" onClick={(e) => { e.stopPropagation(); deleteNode(child.id); }} title="Remove">×</button>
                </div>
                <InsertZone index={idx + 1} active={childDropIdx === idx + 1} visible={childDragActive}
                  onDragOver={() => setChildDropIdx(idx + 1)} onDrop={handleChildDrop} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function IfCard({ node, isSelected, isExecuting, onSelect, onDelete }: {
  node: Node<WorkflowNodeData>;
  isSelected: boolean;
  isExecuting: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const { nodes, variables, addIfBranch, addIfBranchChildAt, moveIfBranchChild, deleteNode, selectedNodeId, setSelectedNode, updateIfBranch } = useWorkflowStore();
  const branches = node.data.branches ?? [];
  const hasConditionalElse = branches.some((branch) => branch.kind === 'elseIf');

  return (
    <div className={`if-card${isSelected ? ' if-card--selected' : ''}${isExecuting ? ' if-card--executing' : ''}`} onClick={(event) => { event.stopPropagation(); onSelect(); }}>
      <div className="if-card__hdr">
        <span className="if-card__icon">{node.data.icon}</span>
        <span className="if-card__title">{node.data.label}</span>
        <button className="if-card__delete" onClick={(event) => { event.stopPropagation(); onDelete(); }} title="Remove If">×</button>
      </div>
      <div className="if-card__branches">
        {branches.map((branch) => {
          const children = branch.childIds.map((id) => nodes.find((item) => item.id === id)).filter(Boolean) as Node<WorkflowNodeData>[];
          const branchLabel = branch.kind === 'if' ? 'IF' : branch.kind === 'elseIf' ? 'ELSE IF' : 'ELSE';
          const conditionRequired = branch.kind === 'if' || branch.kind === 'elseIf';
          const isInvalid = conditionRequired && hasConditionalElse && !branch.condition.trim();
          return (
            <section
              key={branch.id}
              className={`if-branch${isInvalid ? ' if-branch--invalid' : ''}`}
              onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }}
              onDrop={(event) => {
                event.preventDefault();
                event.stopPropagation();
                const activityId = event.dataTransfer.getData('application/rpa-activity');
                const childId = event.dataTransfer.getData('application/rpa-if-child-id');
                const sourceBranchId = event.dataTransfer.getData('application/rpa-if-branch-id');
                if (activityId) addIfBranchChildAt(node.id, branch.id, activityId, children.length);
                else if (childId && sourceBranchId) moveIfBranchChild(node.id, sourceBranchId, branch.id, childId, children.length);
              }}
            >
              <div className="if-branch__hdr">
                <span className="if-branch__label">{branchLabel}</span>
                {conditionRequired && (
                  <ExpressionInput
                    value={branch.condition}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(condition) => updateIfBranch(node.id, branch.id, { condition })}
                    placeholder={branch.kind === 'if' ? 'Condition, e.g. {{total}} == "10"' : 'Condition required'}
                    variables={variables}
                  />
                )}
              </div>
              {isInvalid && <div className="if-branch__validation">Condition required when using multiple ELSE branches.</div>}
              <div className="if-branch__body">
                {children.length === 0 ? <div className="if-branch__empty">Drop activity here</div> : children.map((child) => (
                  <div key={child.id} className={`seq-card if-branch__activity${selectedNodeId === child.id ? ' seq-card--selected' : ''}`} style={{ borderLeftColor: child.data.color ?? '#0078D4' }} onClick={(event) => { event.stopPropagation(); setSelectedNode(child.id); }} draggable onDragStart={(event) => {
                    event.dataTransfer.setData('application/rpa-if-child-id', child.id);
                    event.dataTransfer.setData('application/rpa-if-branch-id', branch.id);
                    event.dataTransfer.effectAllowed = 'move';
                  }}>
                    <div className="seq-card__icon" style={{ background: child.data.color ?? '#0078D4' }}>{child.data.icon}</div>
                    <div className="seq-card__body"><span className="seq-card__name">{child.data.label}</span></div>
                    <button className="seq-card__delete" onClick={(event) => { event.stopPropagation(); deleteNode(child.id); }} title="Remove">×</button>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
      <button className="if-card__add-else" onClick={(event) => { event.stopPropagation(); addIfBranch(node.id); }}>+ Add Else</button>
    </div>
  );
}

// ── Sequence canvas ───────────────────────────────────────────────────────────

export function SequenceCanvas() {
  const { nodes, addNodeAtIndex, moveNode, deleteNode, selectedNodeId, setSelectedNode, executingNodeId, status, toggleBreakpoint } =
    useWorkflowStore();
  const isPaused = status === 'paused';

  // Only top-level nodes are rendered here; children are rendered inside ContainerCard
  const topLevelNodes = nodes.filter((n) => !n.data.parentId);
  const [dropIndex, setDropIndex] = useState(-1);
  // Whether any drag is currently over the canvas (shows all insertion lines)
  const [canvasDragActive, setCanvasDragActive] = useState(false);
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);

  // Drag enters the whole canvas — show all insertion lines
  const handleCanvasDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setCanvasDragActive(true);
  }, []);

  // Drag leaves the whole canvas — hide insertion lines
  const handleCanvasDragLeave = useCallback((e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setCanvasDragActive(false);
      setDropIndex(-1);
    }
  }, []);

  const handleCanvasDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  // Drop on canvas background → append to end
  const handleCanvasDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const activityId = e.dataTransfer.getData('application/rpa-activity');
    if (activityId && dropIndex === -1) {
      addNodeAtIndex(activityId, nodes.length);
    }
    setCanvasDragActive(false);
    setDropIndex(-1);
    setDraggingIdx(null);
  }, [dropIndex, topLevelNodes.length, addNodeAtIndex]);

  // Drop on a specific zone
  const handleZoneDrop = useCallback((e: React.DragEvent, idx: number) => {
    e.preventDefault();
    e.stopPropagation();
    const activityId = e.dataTransfer.getData('application/rpa-activity');
    const nodeIdxStr = e.dataTransfer.getData('application/rpa-node-idx');
    if (activityId) {
      addNodeAtIndex(activityId, idx);
    } else if (nodeIdxStr !== '') {
      const from = parseInt(nodeIdxStr, 10);
      const to = from < idx ? idx - 1 : idx;
      if (from !== to) moveNode(from, to);
    }
    setCanvasDragActive(false);
    setDropIndex(-1);
    setDraggingIdx(null);
  }, [addNodeAtIndex, moveNode]);

  const handleNodeDragStart = useCallback((e: React.DragEvent, idx: number) => {
    e.dataTransfer.setData('application/rpa-node-idx', String(idx));
    e.dataTransfer.effectAllowed = 'move';
    setDraggingIdx(idx);
    setCanvasDragActive(true);
  }, []);

  return (
    <div
      className="seq-canvas"
      onDragEnter={handleCanvasDragEnter}
      onDragLeave={handleCanvasDragLeave}
      onDragOver={handleCanvasDragOver}
      onDrop={handleCanvasDrop}
    >
      {/* UiPath-style canvas tab header */}
      <div className="seq-canvas__header">
        <div className="seq-canvas__tabs">
          <div className="seq-canvas__tab seq-canvas__tab--active">
            <span>Main</span>
            <button className="seq-canvas__tab-close">×</button>
          </div>
        </div>
        <div className="seq-canvas__header-actions">
          <button className="seq-canvas__act-btn">Expand All</button>
          <button className="seq-canvas__act-btn">Collapse All</button>
        </div>
      </div>

      <div className="seq-canvas__scroll" onDragOver={e => e.preventDefault()}>
        <div className="seq-canvas__track" onDragOver={e => e.preventDefault()}>

          <div className="seq-container">
            <div className="seq-container__header">
              <span className="seq-container__name">Main Sequence</span>
            </div>
            <div className="seq-container__body">

              <InsertZone
                index={0}
                active={dropIndex === 0}
                visible={canvasDragActive}
                onDragOver={() => setDropIndex(0)}
                onDrop={handleZoneDrop}
              />

              {topLevelNodes.length === 0 && !canvasDragActive && (
                <div className="seq-canvas__empty">
                  <div className="seq-canvas__empty-icon">⊕</div>
                  <p>Drop activity here</p>
                </div>
              )}

              {topLevelNodes.map((node, idx) => {
                const activity = getActivity(node.data.activityId);
                const isExecuting = node.id === executingNodeId;
                const isSelected = node.id === selectedNodeId;
                const isDragging = draggingIdx === idx;

                if (node.data.activityId === 'if') {
                  return (
                    <div key={node.id} className="seq-item" style={{ opacity: isDragging ? 0.35 : 1 }}>
                      <IfCard node={node} isSelected={isSelected} isExecuting={isExecuting} onSelect={() => setSelectedNode(node.id)} onDelete={() => deleteNode(node.id)} />
                      <InsertZone index={idx + 1} active={dropIndex === idx + 1} visible={canvasDragActive} onDragOver={() => setDropIndex(idx + 1)} onDrop={handleZoneDrop} />
                    </div>
                  );
                }

                if (node.data.isContainer) {
                  return (
                    <div key={node.id} className="seq-item" style={{ opacity: isDragging ? 0.35 : 1 }}>
                      <ContainerCard
                        node={node}
                        isSelected={isSelected}
                        isExecuting={isExecuting}
                        onSelect={() => setSelectedNode(node.id)}
                        onDelete={() => deleteNode(node.id)}
                      />
                      <InsertZone
                        index={idx + 1}
                        active={dropIndex === idx + 1}
                        visible={canvasDragActive}
                        onDragOver={() => setDropIndex(idx + 1)}
                        onDrop={handleZoneDrop}
                      />
                    </div>
                  );
                }

                const nodeIsPaused = isExecuting && isPaused;

                return (
                  <div key={node.id} className="seq-item" style={{ opacity: isDragging ? 0.35 : 1 }}>
                    <div
                      className={`seq-card${isSelected ? ' seq-card--selected' : ''}${isExecuting ? ' seq-card--executing' : ''}${nodeIsPaused ? ' seq-card--paused' : ''}`}
                      style={{ borderLeftColor: node.data.color ?? '#0078D4' }}
                      onClick={() => setSelectedNode(node.id)}
                      draggable
                      onDragOver={e => e.preventDefault()}
                      onDragStart={(e) => handleNodeDragStart(e, idx)}
                      onDragEnd={() => { setDraggingIdx(null); }}
                    >
                      <div className="seq-card__drag" title="Drag to reorder">⠿</div>
                      <button
                        className={`seq-card__bp${node.data.breakpoint ? ' seq-card__bp--set' : ''}`}
                        onClick={(e) => { e.stopPropagation(); toggleBreakpoint(node.id); }}
                        title={node.data.breakpoint ? 'Remove breakpoint' : 'Set breakpoint'}
                      >●</button>
                      {nodeIsPaused && <span className="seq-card__pause-arrow">▶</span>}
                      <div className="seq-card__icon" style={{ background: node.data.color ?? '#0078D4' }}>
                        {node.data.icon}
                      </div>
                      <div className="seq-card__body">
                        <span className="seq-card__name">{node.data.label}</span>
                        {(() => {
                          const hint = activity?.properties
                            .map((p) => node.data.properties[p.name])
                            .find((v) => v && String(v).trim());
                          return hint ? <span className="seq-card__hint">{String(hint)}</span> : null;
                        })()}
                      </div>
                      {isExecuting && !isPaused && <div className="seq-card__spinner" />}
                      <button
                        className="seq-card__delete"
                        onClick={(e) => { e.stopPropagation(); deleteNode(node.id); }}
                        title="Remove"
                      >×</button>
                    </div>

                    {/* Zone after this node */}
                    <InsertZone
                      index={idx + 1}
                      active={dropIndex === idx + 1}
                      visible={canvasDragActive}
                      onDragOver={() => setDropIndex(idx + 1)}
                      onDrop={handleZoneDrop}
                    />
                  </div>
                );
              })}
            </div>
          </div>

        </div>
      </div>

      {/* Zoom controls bottom-right */}
      <div className="seq-canvas__zoom-bar">
        <button className="seq-zoom-btn" title="Fit">⤢</button>
        <button className="seq-zoom-btn" title="Reset zoom">↺</button>
        <span className="seq-zoom-label">100%</span>
      </div>
    </div>
  );
}

function InsertZone({
  index, active, visible, onDragOver, onDrop,
}: {
  index: number;
  active: boolean;
  visible: boolean;
  onDragOver: () => void;
  onDrop: (e: React.DragEvent, idx: number) => void;
}) {
  return (
    <div
      className={`seq-zone${visible ? ' seq-zone--visible' : ''}${active ? ' seq-zone--active' : ''}`}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; onDragOver(); }}
      onDrop={(e) => onDrop(e, index)}
    >
      <div className="seq-zone__line" />
    </div>
  );
}

