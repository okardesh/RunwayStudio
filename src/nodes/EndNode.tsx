import { memo } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import type { WorkflowNodeData } from '../types';
import './EndNode.css';

function EndNode(_props: NodeProps<WorkflowNodeData>) {
  return (
    <div className="end-node">
      <Handle type="target" position={Position.Top} className="end-node__handle" />
      <span className="end-node__icon">⏹</span>
      <span className="end-node__label">END</span>
    </div>
  );
}

export default memo(EndNode);
