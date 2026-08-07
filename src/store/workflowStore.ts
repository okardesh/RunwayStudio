import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  type Node,
  type Edge,
  type Connection,
  type NodeChange,
  type EdgeChange,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  MarkerType,
} from 'reactflow';
import { v4 as uuidv4 } from 'uuid';
import type { WorkflowNodeData, WorkflowVariable, WorkflowStatus } from '../types';
import { getActivity } from '../activities/registry';

const createInitialNodes = (): Node<WorkflowNodeData>[] => [];

interface WorkflowState {
  nodes: Node<WorkflowNodeData>[];
  edges: Edge[];
  variables: WorkflowVariable[];
  selectedNodeId: string | null;
  executingNodeId: string | null;
  status: WorkflowStatus;
  projectName: string;
  filePath: string | null; // last path Save wrote to / Open read from — repeat Save overwrites this
  clipboard: { node: Node<WorkflowNodeData>; children: Node<WorkflowNodeData>[] } | null; // Ctrl+C target, not persisted

  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  addNode: (activityId: string, position: { x: number; y: number }, parentNodeId?: string) => void;
  addNodeAtIndex: (activityId: string, index: number) => void;
  addChildNodeAt: (parentId: string, activityId: string, index: number) => void;
  moveNode: (from: number, to: number) => void;
  moveChildNode: (parentId: string, from: number, to: number) => void;
  deleteNode: (nodeId: string) => void;
  updateNodeProperties: (nodeId: string, properties: Record<string, unknown>) => void;
  toggleBreakpoint: (nodeId: string) => void;
  setSelectedNode: (nodeId: string | null) => void;
  addVariable: (variable: Omit<WorkflowVariable, 'id'>) => void;
  removeVariable: (variableId: string) => void;
  updateVariable: (variableId: string, changes: Partial<Omit<WorkflowVariable, 'id'>>) => void;
  setStatus: (status: WorkflowStatus) => void;
  setProjectName: (name: string) => void;
  clearWorkflow: () => void;
  setExecutingNodeId: (id: string | null) => void;
  loadWorkflow: (data: { nodes: Node<WorkflowNodeData>[]; edges: Edge[]; variables: WorkflowVariable[]; projectName: string }, filePath?: string | null) => void;
  setFilePath: (filePath: string | null) => void;
  copySelectedNode: () => void;
  pasteNode: () => void;
}

export const useWorkflowStore = create<WorkflowState>()(persist((set) => ({
  nodes: createInitialNodes(),
  edges: [],
  variables: [],
  selectedNodeId: null,
  executingNodeId: null,
  status: 'idle',
  projectName: 'New Workflow',
  filePath: null,
  clipboard: null,

  onNodesChange: (changes) =>
    set((state) => ({
      nodes: applyNodeChanges(changes, state.nodes) as Node<WorkflowNodeData>[],
    })),

  onEdgesChange: (changes) =>
    set((state) => ({ edges: applyEdgeChanges(changes, state.edges) })),

  onConnect: (connection) =>
    set((state) => ({
      edges: addEdge(
        {
          ...connection,
          style: { strokeWidth: 2, stroke: '#0078D4' },
          markerEnd: { type: MarkerType.ArrowClosed, color: '#0078D4' },
        },
        state.edges
      ),
    })),

  addNode: (activityId, position, parentNodeId?) => {
    const activity = getActivity(activityId);
    if (!activity) return;

    const defaultProperties: Record<string, unknown> = {};
    activity.properties.forEach((prop) => {
      defaultProperties[prop.name] = prop.defaultValue ?? '';
    });

    const nodeTypeMap: Record<string, string> = {
      decision: 'decisionNode',
      sequence: 'sequenceNode',
      end: 'endNode',
    };
    const rfType = nodeTypeMap[activity.nodeType] ?? 'activityNode';

    const newNode: Node<WorkflowNodeData> = {
      id: uuidv4(),
      type: rfType,
      position,
      ...(parentNodeId ? { parentNode: parentNodeId, extent: 'parent' as const } : {}),
      ...(rfType === 'sequenceNode' ? { style: { width: 260, height: 180 } } : {}),
      data: {
        activityId,
        label: activity.name,
        icon: activity.icon,
        color: activity.color,
        properties: defaultProperties,
      },
    };

    set((state) => ({ nodes: [...state.nodes, newNode] }));
  },

  addNodeAtIndex: (activityId, index) => {
    const activity = getActivity(activityId);
    if (!activity) return;
    const defaultProperties: Record<string, unknown> = {};
    activity.properties.forEach((prop) => { defaultProperties[prop.name] = prop.defaultValue ?? ''; });
    const newNode: Node<WorkflowNodeData> = {
      id: uuidv4(),
      type: 'activityNode',
      position: { x: 0, y: 0 },
      data: {
        activityId,
        label: activity.name,
        icon: activity.icon,
        color: activity.color,
        properties: defaultProperties,
        isContainer: activity.isContainer ?? false,
        childIds: activity.isContainer ? [] : undefined,
      },
    };
    set((state) => {
      const next = [...state.nodes];
      next.splice(index, 0, newNode);
      return { nodes: next, selectedNodeId: newNode.id };
    });
  },

  addChildNodeAt: (parentId, activityId, index) => {
    const activity = getActivity(activityId);
    if (!activity) return;
    const defaultProperties: Record<string, unknown> = {};
    activity.properties.forEach((prop) => { defaultProperties[prop.name] = prop.defaultValue ?? ''; });
    const childNode: Node<WorkflowNodeData> = {
      id: uuidv4(),
      type: 'activityNode',
      position: { x: 0, y: 0 },
      data: {
        activityId,
        label: activity.name,
        icon: activity.icon,
        color: activity.color,
        properties: defaultProperties,
        parentId,
      },
    };
    set((state) => {
      const parent = state.nodes.find((n) => n.id === parentId);
      if (!parent) return state;
      const childIds = [...(parent.data.childIds ?? [])];
      childIds.splice(index, 0, childNode.id);
      return {
        nodes: [
          ...state.nodes.map((n) =>
            n.id === parentId ? { ...n, data: { ...n.data, childIds } } : n
          ),
          childNode,
        ],
        selectedNodeId: childNode.id,
      };
    });
  },

  moveNode: (from, to) =>
    set((state) => {
      const topLevel = state.nodes.filter((n) => !n.data.parentId);
      const [moved] = topLevel.splice(from, 1);
      topLevel.splice(to, 0, moved);
      const children = state.nodes.filter((n) => n.data.parentId);
      return { nodes: [...topLevel, ...children] };
    }),

  moveChildNode: (parentId, from, to) =>
    set((state) => {
      const parent = state.nodes.find((n) => n.id === parentId);
      if (!parent) return state;
      const childIds = [...(parent.data.childIds ?? [])];
      const [item] = childIds.splice(from, 1);
      childIds.splice(to, 0, item);
      return {
        nodes: state.nodes.map((n) =>
          n.id === parentId ? { ...n, data: { ...n.data, childIds } } : n
        ),
      };
    }),

  deleteNode: (nodeId) =>
    set((state) => {
      const target = state.nodes.find((n) => n.id === nodeId);
      // Collect IDs to remove: the node itself plus any children if it's a container
      const toRemove = new Set([nodeId, ...(target?.data.childIds ?? [])]);
      // If it's a child, remove its ID from the parent's childIds
      const parentId = target?.data.parentId;
      return {
        nodes: state.nodes
          .filter((n) => !toRemove.has(n.id))
          .map((n) =>
            n.id === parentId
              ? { ...n, data: { ...n.data, childIds: (n.data.childIds ?? []).filter((id) => id !== nodeId) } }
              : n
          ),
        selectedNodeId: state.selectedNodeId && toRemove.has(state.selectedNodeId) ? null : state.selectedNodeId,
      };
    }),

  updateNodeProperties: (nodeId, properties) =>
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, properties } } : n
      ),
    })),

  toggleBreakpoint: (nodeId) =>
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, breakpoint: !n.data.breakpoint } } : n
      ),
    })),

  setSelectedNode: (nodeId) => set({ selectedNodeId: nodeId }),

  addVariable: (variable) =>
    set((state) => ({
      variables: [...state.variables, { ...variable, id: uuidv4() }],
    })),

  removeVariable: (variableId) =>
    set((state) => ({
      variables: state.variables.filter((v) => v.id !== variableId),
    })),

  updateVariable: (variableId, changes) =>
    set((state) => ({
      variables: state.variables.map((v) => v.id === variableId ? { ...v, ...changes } : v),
    })),

  setStatus: (status) => set({ status }),

  setProjectName: (name) => set({ projectName: name }),

  clearWorkflow: () =>
    set({
      nodes: createInitialNodes(),
      edges: [],
      variables: [],
      selectedNodeId: null,
      executingNodeId: null,
      status: 'idle',
      filePath: null,
    }),

  setExecutingNodeId: (id) => set({ executingNodeId: id }),

  loadWorkflow: (data, filePath = null) =>
    set({
      nodes: data.nodes,
      edges: data.edges,
      variables: data.variables,
      projectName: data.projectName,
      selectedNodeId: null,
      executingNodeId: null,
      status: 'idle',
      filePath,
    }),

  setFilePath: (filePath) => set({ filePath }),

  copySelectedNode: () =>
    set((state) => {
      const node = state.nodes.find((n) => n.id === state.selectedNodeId);
      if (!node) return state;
      const children = (node.data.childIds ?? [])
        .map((id) => state.nodes.find((n) => n.id === id))
        .filter(Boolean) as Node<WorkflowNodeData>[];
      return { clipboard: { node, children } };
    }),

  pasteNode: () =>
    set((state) => {
      if (!state.clipboard) return state;
      const { node: srcNode, children: srcChildren } = state.clipboard;
      // The copied node (or its container, if a child was copied) might have been deleted since.
      const parentId = srcNode.data.parentId;
      if (parentId && !state.nodes.some((n) => n.id === parentId)) return state;

      const newId = uuidv4();
      const idMap = new Map<string, string>();
      srcChildren.forEach((c) => idMap.set(c.id, uuidv4()));

      const newNode: Node<WorkflowNodeData> = {
        ...srcNode,
        id: newId,
        position: { x: srcNode.position.x + 24, y: srcNode.position.y + 24 },
        data: {
          ...srcNode.data,
          properties: { ...srcNode.data.properties },
          childIds: srcNode.data.isContainer ? srcChildren.map((c) => idMap.get(c.id)!) : undefined,
        },
      };
      const newChildren: Node<WorkflowNodeData>[] = srcChildren.map((c) => ({
        ...c,
        id: idMap.get(c.id)!,
        data: { ...c.data, properties: { ...c.data.properties }, parentId: newId },
      }));

      let nodes: Node<WorkflowNodeData>[];
      if (parentId) {
        // Copied node was a child — paste as a new sibling right after the original.
        const parent = state.nodes.find((n) => n.id === parentId)!;
        const childIds = [...(parent.data.childIds ?? [])];
        const origIdx = childIds.indexOf(srcNode.id);
        childIds.splice(origIdx === -1 ? childIds.length : origIdx + 1, 0, newId);
        nodes = state.nodes.map((n) => (n.id === parentId ? { ...n, data: { ...n.data, childIds } } : n));
        nodes = [...nodes, newNode, ...newChildren];
      } else {
        // Top-level node — paste right after the original.
        nodes = [...state.nodes];
        const origIdx = nodes.findIndex((n) => n.id === srcNode.id);
        nodes.splice(origIdx === -1 ? nodes.length : origIdx + 1, 0, newNode);
        nodes = [...nodes, ...newChildren];
      }

      return { nodes, selectedNodeId: newId };
    }),
}), {
  name: 'rpa-studio-workflow',
  partialize: (state) => ({
    nodes: state.nodes,
    edges: state.edges,
    variables: state.variables,
    projectName: state.projectName,
    filePath: state.filePath,
  }),
}));
