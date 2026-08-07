import { memo } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import { useWorkflowStore } from '../store/workflowStore';
import type { WorkflowNodeData } from '../types';
import './ActivityNode.css';

function ActivityNode({ data, selected, id }: NodeProps<WorkflowNodeData>) {
  const executingNodeId = useWorkflowStore((s) => s.executingNodeId);
  const isExecuting = executingNodeId === id;

  return (
    <div className={`activity-node${selected ? ' activity-node--selected' : ''}${isExecuting ? ' activity-node--executing' : ''}`}>
      <Handle type="target" position={Position.Top} className="activity-node__handle" />
      <div className="activity-node__header" style={{ backgroundColor: data.color }}>
        <span className="activity-node__icon">{data.icon}</span>
        <span className="activity-node__label">{data.label}</span>
      </div>
      <Handle type="source" position={Position.Bottom} className="activity-node__handle" />
    </div>
  );
}

export default memo(ActivityNode);
