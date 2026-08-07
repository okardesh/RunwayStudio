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
  setSelectedNode: (nodeId: string | null) => void;
  addVariable: (variable: Omit<WorkflowVariable, 'id'>) => void;
  removeVariable: (variableId: string) => void;
  updateVariable: (variableId: string, changes: Partial<Omit<WorkflowVariable, 'id'>>) => void;
  setStatus: (status: WorkflowStatus) => void;
  setProjectName: (name: string) => void;
  clearWorkflow: () => void;
  setExecutingNodeId: (id: string | null) => void;
  loadWorkflow: (data: { nodes: Node<WorkflowNodeData>[]; edges: Edge[]; variables: WorkflowVariable[]; projectName: string }) => void;
}

export const useWorkflowStore = create<WorkflowState>()(persist((set) => ({
  nodes: createInitialNodes(),
  edges: [],
  variables: [],
  selectedNodeId: null,
  executingNodeId: null,
  status: 'idle',
  projectName: 'New Workflow',

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
    }),

  setExecutingNodeId: (id) => set({ executingNodeId: id }),

  loadWorkflow: (data) =>
    set({
      nodes: data.nodes,
      edges: data.edges,
      variables: data.variables,
      projectName: data.projectName,
      selectedNodeId: null,
      executingNodeId: null,
      status: 'idle',
    }),
}), {
  name: 'rpa-studio-workflow',
  partialize: (state) => ({
    nodes: state.nodes,
    edges: state.edges,
    variables: state.variables,
    projectName: state.projectName,
  }),
}));
