import { memo } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import { useWorkflowStore } from '../store/workflowStore';
import type { WorkflowNodeData } from '../types';
import './SequenceNode.css';

function SequenceNode({ data, selected, id }: NodeProps<WorkflowNodeData>) {
  const executingNodeId = useWorkflowStore((s) => s.executingNodeId);
  const isExecuting = executingNodeId === id;

  return (
    <div
      className={[
        'sequence-node',
        selected ? 'sequence-node--selected' : '',
        isExecuting ? 'sequence-node--executing' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ borderColor: data.color + '80' }}
    >
      <Handle type="target" position={Position.Top} className="sequence-node__handle" />

      <div className="sequence-node__header" style={{ background: data.color + '20', borderBottomColor: data.color + '40' }}>
        <span className="sequence-node__icon" style={{ color: data.color }}>{data.icon}</span>
        <span className="sequence-node__title">{data.label}</span>
      </div>

      <div className="sequence-node__body">
        <span className="sequence-node__hint">Drop activities here</span>
      </div>

      <Handle type="source" position={Position.Bottom} className="sequence-node__handle" />
    </div>
  );
}

export default memo(SequenceNode);
