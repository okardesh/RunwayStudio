import { memo } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import { useWorkflowStore } from '../store/workflowStore';
import type { WorkflowNodeData } from '../types';
import './DecisionNode.css';

function DecisionNode({ data, selected, id }: NodeProps<WorkflowNodeData>) {
  const executingNodeId = useWorkflowStore((s) => s.executingNodeId);
  const isExecuting = executingNodeId === id;

  return (
    <div
      className={[
        'decision-wrapper',
        selected ? 'selected' : '',
        isExecuting ? 'executing' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <Handle type="target" position={Position.Top} className="decision-handle" />

      <div className="decision-shape" style={{ background: data.color }} />

      <div className="decision-content">
        <span className="decision-content__icon">{data.icon}</span>
        <span className="decision-content__label">{data.label}</span>
      </div>

      {/* True = Right, False = Left */}
      <Handle type="source" position={Position.Right} id="true" className="decision-handle decision-handle--true" />
      <Handle type="source" position={Position.Left}  id="false" className="decision-handle decision-handle--false" />

      <span className="decision-branch decision-branch--true">T</span>
      <span className="decision-branch decision-branch--false">F</span>
    </div>
  );
}

export default memo(DecisionNode);
