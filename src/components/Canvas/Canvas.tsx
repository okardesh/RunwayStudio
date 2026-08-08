import { useCallback, useRef, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
  type ReactFlowInstance,
  type Node,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { useWorkflowStore } from '../../store/workflowStore';
import { nodeTypes } from '../../nodes';
import './Canvas.css';

const SEQUENCE_NODE_W = 260;
const SEQUENCE_NODE_H = 180;

export function Canvas() {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null);

  const { nodes, edges, onNodesChange, onEdgesChange, onConnect, addNode, setSelectedNode } =
    useWorkflowStore();

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      if (!rfInstance || !reactFlowWrapper.current) return;

      const activityId = event.dataTransfer.getData('application/rpa-activity');
      if (!activityId) return;

      const bounds = reactFlowWrapper.current.getBoundingClientRect();
      const flowPos = rfInstance.project({
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      });

      // Detect if dropped inside a sequence node
      let parentNodeId: string | undefined;
      let finalPos = flowPos;

      for (const n of rfInstance.getNodes()) {
        if (n.type !== 'sequenceNode') continue;
        const nW = (n.style?.width as number | undefined) ?? SEQUENCE_NODE_W;
        const nH = (n.style?.height as number | undefined) ?? SEQUENCE_NODE_H;
        if (
          flowPos.x >= n.position.x &&
          flowPos.x <= n.position.x + nW &&
          flowPos.y >= n.position.y &&
          flowPos.y <= n.position.y + nH
        ) {
          parentNodeId = n.id;
          finalPos = { x: flowPos.x - n.position.x, y: flowPos.y - n.position.y };
          break;
        }
      }

      addNode(activityId, finalPos, parentNodeId);
    },
    [rfInstance, addNode]
  );

  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      setSelectedNode(node.id);
    },
    [setSelectedNode]
  );

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
  }, [setSelectedNode]);

  const isCanvasEmpty = nodes.length === 0;

  return (
    <div className="canvas-wrapper" ref={reactFlowWrapper}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onInit={setRfInstance}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        fitView
        deleteKeyCode="Delete"
        defaultEdgeOptions={{
          style: { strokeWidth: 2, stroke: '#0078D4' },
        }}
      >
        <Background variant={BackgroundVariant.Dots} color="#D0D0D0" gap={24} size={1} />
        <Controls />
        <MiniMap
          nodeColor={(node) => node.data?.color ?? '#0078D4'}
          maskColor="rgba(240, 240, 240, 0.75)"
          style={{ background: 'white', border: '1px solid #D0D0D0', borderRadius: 4 }}
        />
      </ReactFlow>

      {isCanvasEmpty && (
        <div className="canvas-empty-hint" style={{ pointerEvents: 'none' }}>
          <div className="canvas-empty-hint__icon">⬇</div>
          <p>Drag activities from the left panel onto the canvas to build your workflow</p>
        </div>
      )}

    </div>
  );
}
