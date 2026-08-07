import { memo } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import { useWorkflowStore } from '../store/workflowStore';
import type { WorkflowNodeData } from '../types';
import './StartNode.css';

function StartNode({ id }: NodeProps<WorkflowNodeData>) {
  const executingNodeId = useWorkflowStore((s) => s.executingNodeId);
  const isExecuting = executingNodeId === id;

  return (
    <div className={`start-node${isExecuting ? ' start-node--executing' : ''}`}>
      <span className="start-node__icon">▶</span>
      <span className="start-node__label">START</span>
      <Handle type="source" position={Position.Bottom} className="start-node__handle" />
    </div>
  );
}

export default memo(StartNode);
