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
import type { WorkflowBranch, WorkflowNodeData, WorkflowVariable, WorkflowStatus } from '../types';
import { getActivity } from '../activities/registry';

const createInitialNodes = (): Node<WorkflowNodeData>[] => [];

const isCollectionType = (type: string) =>
  /^(?:List|IEnumerable|ICollection|IList|Array)<.+>$/.test(type) || /\[\]$/.test(type) || type === 'Array';

const getCollectionElementType = (type: string) => {
  const generic = type.match(/^(?:List|IEnumerable|ICollection|IList|Array)<(.+)>$/);
  if (generic) return generic[1].trim();
  if (type.endsWith('[]')) return type.slice(0, -2).trim();
  return 'Object';
};

interface WorkflowState {
  nodes: Node<WorkflowNodeData>[];
  edges: Edge[];
  variables: WorkflowVariable[];
  selectedNodeId: string | null;
  executingNodeId: string | null;
  status: WorkflowStatus;
  isDirty: boolean;
  projectName: string;
  filePath: string | null; // last path Save wrote to / Open read from — repeat Save overwrites this
  clipboard: { node: Node<WorkflowNodeData>; children: Node<WorkflowNodeData>[] } | null; // Ctrl+C target, not persisted

  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  addNode: (activityId: string, position: { x: number; y: number }, parentNodeId?: string) => void;
  addNodeAtIndex: (activityId: string, index: number) => void;
  addChildNodeAt: (parentId: string, activityId: string, index: number) => void;
  addIfBranch: (parentId: string) => void;
  addTryCatchBranch: (parentId: string) => void;
  removeTryCatchBranch: (parentId: string, branchId: string) => void;
  updateIfBranch: (parentId: string, branchId: string, changes: Partial<Pick<WorkflowBranch, 'condition' | 'exceptionType'>>) => void;
  addIfBranchChildAt: (parentId: string, branchId: string, activityId: string, index: number) => void;
  addTryCatchBranchChildAt: (parentId: string, branchId: string, activityId: string, index: number) => void;
  moveIfBranchChild: (parentId: string, sourceBranchId: string, targetBranchId: string, childId: string, index: number) => void;
  moveNode: (from: number, to: number) => void;
  moveChildNode: (parentId: string, from: number, to: number) => void;
  deleteNode: (nodeId: string) => void;
  updateNodeProperties: (nodeId: string, properties: Record<string, unknown>) => void;
  configureForEach: (nodeId: string, collection: string) => void;
  renameForEachVariable: (nodeId: string, name: string) => void;
  toggleBreakpoint: (nodeId: string) => void;
  toggleNodeCollapsed: (nodeId: string) => void;
  setAllNodesCollapsed: (collapsed: boolean) => void;
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
  cutSelectedNode: () => void;
  pasteNode: () => void;
  markSaved: () => void;
}

export const useWorkflowStore = create<WorkflowState>()(persist((set) => ({
  nodes: createInitialNodes(),
  edges: [],
  variables: [],
  selectedNodeId: null,
  executingNodeId: null,
  status: 'idle',
  isDirty: false,
  projectName: 'New Workflow',
  filePath: null,
  clipboard: null,

  onNodesChange: (changes) =>
    set((state) => ({
      nodes: applyNodeChanges(changes, state.nodes) as Node<WorkflowNodeData>[],
      isDirty: true,
    })),

  onEdgesChange: (changes) =>
    set((state) => ({ edges: applyEdgeChanges(changes, state.edges), isDirty: true })),

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
      isDirty: true,
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
        isContainer: activity.isContainer ?? false,
        childIds: activity.isContainer ? [] : undefined,
        branches: activityId === 'if' ? [
          { id: uuidv4(), kind: 'if', condition: '', childIds: [] },
          { id: uuidv4(), kind: 'else', condition: '', childIds: [] },
        ] : activityId === 'try-catch' ? [
          { id: uuidv4(), kind: 'try', condition: '', childIds: [] },
          { id: uuidv4(), kind: 'catch', condition: '', exceptionType: 'System.Exception', childIds: [] },
          { id: uuidv4(), kind: 'finally', condition: '', childIds: [] },
        ] : undefined,
      },
    };

    set((state) => ({ nodes: [...state.nodes, newNode], isDirty: true }));
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
        branches: activityId === 'if' ? [
          { id: uuidv4(), kind: 'if', condition: '', childIds: [] },
          { id: uuidv4(), kind: 'else', condition: '', childIds: [] },
        ] : activityId === 'try-catch' ? [
          { id: uuidv4(), kind: 'try', condition: '', childIds: [] },
          { id: uuidv4(), kind: 'catch', condition: '', exceptionType: 'System.Exception', childIds: [] },
          { id: uuidv4(), kind: 'finally', condition: '', childIds: [] },
        ] : undefined,
      },
    };
    set((state) => {
      const next = [...state.nodes];
      next.splice(index, 0, newNode);
      return { nodes: next, selectedNodeId: newNode.id, isDirty: true };
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
        isDirty: true,
      };
    });
  },

  addIfBranch: (parentId) =>
    set((state) => {
      const parent = state.nodes.find((node) => node.id === parentId);
      if (!parent || parent.data.activityId !== 'if') return state;
      const branches = [...(parent.data.branches ?? [])];
      const elseIndex = branches.findIndex((branch) => branch.kind === 'else');
      branches.splice(elseIndex === -1 ? branches.length : elseIndex, 0, {
        id: uuidv4(), kind: 'elseIf', condition: '', childIds: [],
      });
      return {
        nodes: state.nodes.map((node) => node.id === parentId
          ? { ...node, data: { ...node.data, branches } }
          : node),
        isDirty: true,
      };
    }),

  addTryCatchBranch: (parentId) =>
    set((state) => {
      const parent = state.nodes.find((node) => node.id === parentId);
      if (!parent || parent.data.activityId !== 'try-catch') return state;
      const branches = [...(parent.data.branches ?? [])];
      const finallyIndex = branches.findIndex((branch) => branch.kind === 'finally');
      branches.splice(finallyIndex === -1 ? branches.length : finallyIndex, 0, {
        id: uuidv4(), kind: 'catch', condition: '', exceptionType: 'System.Exception', childIds: [],
      });
      return {
        nodes: state.nodes.map((node) => node.id === parentId
          ? { ...node, data: { ...node.data, branches } }
          : node),
        isDirty: true,
      };
    }),

  removeTryCatchBranch: (parentId, branchId) =>
    set((state) => {
      const parent = state.nodes.find((node) => node.id === parentId);
      const branch = parent?.data.branches?.find((item) => item.id === branchId);
      const catchCount = parent?.data.branches?.filter((item) => item.kind === 'catch').length ?? 0;
      if (!parent || !branch || branch.kind !== 'catch' || catchCount <= 1) return state;
      const removedChildIds = new Set(branch.childIds);
      return {
        nodes: state.nodes
          .filter((node) => !removedChildIds.has(node.id))
          .map((node) => node.id === parentId
            ? { ...node, data: { ...node.data, branches: (node.data.branches ?? []).filter((item) => item.id !== branchId) } }
            : node),
        selectedNodeId: state.selectedNodeId && removedChildIds.has(state.selectedNodeId) ? null : state.selectedNodeId,
        isDirty: true,
      };
    }),

  updateIfBranch: (parentId, branchId, changes) =>
    set((state) => ({
      nodes: state.nodes.map((node) => node.id === parentId
        ? { ...node, data: { ...node.data, branches: (node.data.branches ?? []).map((branch) =>
          branch.id === branchId ? { ...branch, ...changes } : branch
        ) } }
        : node),
      isDirty: true,
    })),

  addIfBranchChildAt: (parentId, branchId, activityId, index) => {
    const activity = getActivity(activityId);
    if (!activity) return;
    const properties: Record<string, unknown> = {};
    activity.properties.forEach((property) => { properties[property.name] = property.defaultValue ?? ''; });
    const childNode: Node<WorkflowNodeData> = {
      id: uuidv4(), type: 'activityNode', position: { x: 0, y: 0 },
      data: { activityId, label: activity.name, icon: activity.icon, color: activity.color, properties, parentId, branchId },
    };
    set((state) => ({
      nodes: [
        ...state.nodes.map((node) => node.id === parentId ? {
          ...node,
          data: {
            ...node.data,
            branches: (node.data.branches ?? []).map((branch) => branch.id === branchId ? {
              ...branch, childIds: [...branch.childIds.slice(0, index), childNode.id, ...branch.childIds.slice(index)],
            } : branch),
          },
        } : node),
        childNode,
      ],
      selectedNodeId: childNode.id,
      isDirty: true,
    }));
  },

  addTryCatchBranchChildAt: (parentId, branchId, activityId, index) => {
    const activity = getActivity(activityId);
    if (!activity) return;
    const properties: Record<string, unknown> = {};
    activity.properties.forEach((property) => { properties[property.name] = property.defaultValue ?? ''; });
    const childNode: Node<WorkflowNodeData> = {
      id: uuidv4(), type: 'activityNode', position: { x: 0, y: 0 },
      data: { activityId, label: activity.name, icon: activity.icon, color: activity.color, properties, parentId, branchId },
    };
    set((state) => ({
      nodes: [
        ...state.nodes.map((node) => node.id === parentId ? {
          ...node,
          data: {
            ...node.data,
            branches: (node.data.branches ?? []).map((branch) => branch.id === branchId ? {
              ...branch, childIds: [...branch.childIds.slice(0, index), childNode.id, ...branch.childIds.slice(index)],
            } : branch),
          },
        } : node),
        childNode,
      ],
      selectedNodeId: childNode.id,
      isDirty: true,
    }));
  },

  moveIfBranchChild: (parentId, sourceBranchId, targetBranchId, childId, index) =>
    set((state) => {
      const parent = state.nodes.find((node) => node.id === parentId);
      if (!parent) return state;
      const source = parent.data.branches?.find((branch) => branch.id === sourceBranchId);
      const target = parent.data.branches?.find((branch) => branch.id === targetBranchId);
      if (!source || !target || !source.childIds.includes(childId)) return state;

      const branches = (parent.data.branches ?? []).map((branch) => {
        if (branch.id === sourceBranchId && branch.id === targetBranchId) {
          const childIds = branch.childIds.filter((id) => id !== childId);
          childIds.splice(Math.min(index, childIds.length), 0, childId);
          return { ...branch, childIds };
        }
        if (branch.id === sourceBranchId) return { ...branch, childIds: branch.childIds.filter((id) => id !== childId) };
        if (branch.id === targetBranchId) {
          const childIds = [...branch.childIds];
          childIds.splice(Math.min(index, childIds.length), 0, childId);
          return { ...branch, childIds };
        }
        return branch;
      });
      return {
        nodes: state.nodes.map((node) => node.id === parentId
          ? { ...node, data: { ...node.data, branches } }
          : node),
        isDirty: true,
      };
    }),

  moveNode: (from, to) =>
    set((state) => {
      const topLevel = state.nodes.filter((n) => !n.data.parentId);
      const [moved] = topLevel.splice(from, 1);
      topLevel.splice(to, 0, moved);
      const children = state.nodes.filter((n) => n.data.parentId);
      return { nodes: [...topLevel, ...children], isDirty: true };
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
        isDirty: true,
      };
    }),

  deleteNode: (nodeId) =>
    set((state) => {
      const target = state.nodes.find((n) => n.id === nodeId);
      // Collect IDs to remove: the node itself plus any children if it's a container
      const toRemove = new Set([
        nodeId,
        ...(target?.data.childIds ?? []),
        ...(target?.data.branches ?? []).flatMap((branch) => branch.childIds),
      ]);
      // If it's a child, remove its ID from the parent's childIds
      const parentId = target?.data.parentId;
      return {
        nodes: state.nodes
          .filter((n) => !toRemove.has(n.id))
          .map((n) =>
            n.id === parentId
              ? {
                ...n,
                data: {
                  ...n.data,
                  childIds: (n.data.childIds ?? []).filter((id) => id !== nodeId),
                  branches: (n.data.branches ?? []).map((branch) => ({
                    ...branch,
                    childIds: branch.childIds.filter((id) => id !== nodeId),
                  })),
                },
              }
              : n
          ),
        selectedNodeId: state.selectedNodeId && toRemove.has(state.selectedNodeId) ? null : state.selectedNodeId,
          isDirty: true,
      };
    }),

  updateNodeProperties: (nodeId, properties) =>
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, properties } } : n
      ),
      isDirty: true,
    })),

  configureForEach: (nodeId, collection) =>
    set((state) => {
      const collectionName = collection.replace(/^\{\{\s*|\s*\}\}$/g, '');
      const source = state.variables.find((variable) => variable.name === collectionName);
      if (!source || !isCollectionType(source.type)) return state;
      const elementType = getCollectionElementType(source.type);
      return {
        nodes: state.nodes.map((node) => node.id === nodeId
          ? {
            ...node,
            data: {
              ...node.data,
              properties: { ...node.data.properties, collection: `{{${source.name}}}` },
              loopVariable: { name: node.data.loopVariable?.name || 'Item', type: elementType },
            },
          }
          : node),
        isDirty: true,
      };
    }),

  renameForEachVariable: (nodeId, name) =>
    set((state) => {
      const normalized = name.trim();
      if (!normalized) return state;
      return {
        nodes: state.nodes.map((node) => node.id === nodeId && node.data.loopVariable
          ? { ...node, data: { ...node.data, loopVariable: { ...node.data.loopVariable, name: normalized } } }
          : node),
        isDirty: true,
      };
    }),

  toggleBreakpoint: (nodeId) =>
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, breakpoint: !n.data.breakpoint } } : n
      ),
      isDirty: true,
    })),

  toggleNodeCollapsed: (nodeId) =>
    set((state) => ({
      nodes: state.nodes.map((node) =>
        node.id === nodeId ? { ...node, data: { ...node.data, collapsed: !node.data.collapsed } } : node
      ),
      isDirty: true,
    })),

  setAllNodesCollapsed: (collapsed) =>
    set((state) => ({
      nodes: state.nodes.map((node) => ({ ...node, data: { ...node.data, collapsed } })),
      isDirty: true,
    })),

  setSelectedNode: (nodeId) => set({ selectedNodeId: nodeId }),

  addVariable: (variable) =>
    set((state) => ({
      variables: [...state.variables, { ...variable, id: uuidv4() }],
      isDirty: true,
    })),

  removeVariable: (variableId) =>
    set((state) => ({
      variables: state.variables.filter((v) => v.id !== variableId),
      isDirty: true,
    })),

  updateVariable: (variableId, changes) =>
    set((state) => ({
      variables: state.variables.map((v) => v.id === variableId ? { ...v, ...changes } : v),
      isDirty: true,
    })),

  setStatus: (status) => set({ status }),

  setProjectName: (name) => set({ projectName: name, isDirty: true }),

  clearWorkflow: () =>
    set({
      nodes: createInitialNodes(),
      edges: [],
      variables: [],
      selectedNodeId: null,
      executingNodeId: null,
      status: 'idle',
      filePath: null,
      isDirty: false,
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
      isDirty: false,
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
  cutSelectedNode: () =>
    set((state) => {
      const node = state.nodes.find((item) => item.id === state.selectedNodeId);
      if (!node) return state;
      const children = (node.data.childIds ?? [])
        .map((id) => state.nodes.find((item) => item.id === id))
        .filter(Boolean) as Node<WorkflowNodeData>[];
      const toRemove = new Set([node.id, ...children.map((child) => child.id)]);
      return {
        clipboard: { node, children },
        nodes: state.nodes
          .filter((item) => !toRemove.has(item.id))
          .map((item) => item.id === node.data.parentId
            ? {
              ...item,
              data: {
                ...item.data,
                childIds: (item.data.childIds ?? []).filter((id) => id !== node.id),
                branches: (item.data.branches ?? []).map((branch) => branch.id === node.data.branchId
                  ? { ...branch, childIds: branch.childIds.filter((id) => id !== node.id) }
                  : branch),
              },
            }
            : item),
        selectedNodeId: null,
        isDirty: true,
      };
    }),
  markSaved: () => set({ isDirty: false }),

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
        // Copied node was a child — paste as a new sibling in its container or IF branch.
        const parent = state.nodes.find((n) => n.id === parentId)!;
        if (srcNode.data.branchId) {
          const branches = (parent.data.branches ?? []).map((branch) => {
            if (branch.id !== srcNode.data.branchId) return branch;
            const childIds = [...branch.childIds];
            const originalIndex = childIds.indexOf(srcNode.id);
            childIds.splice(originalIndex === -1 ? childIds.length : originalIndex + 1, 0, newId);
            return { ...branch, childIds };
          });
          nodes = state.nodes.map((item) => item.id === parentId ? { ...item, data: { ...item.data, branches } } : item);
        } else {
          const childIds = [...(parent.data.childIds ?? [])];
          const originalIndex = childIds.indexOf(srcNode.id);
          childIds.splice(originalIndex === -1 ? childIds.length : originalIndex + 1, 0, newId);
          nodes = state.nodes.map((item) => item.id === parentId ? { ...item, data: { ...item.data, childIds } } : item);
        }
        nodes = [...nodes, newNode, ...newChildren];
      } else {
        // Top-level node — paste right after the original.
        nodes = [...state.nodes];
        const origIdx = nodes.findIndex((n) => n.id === srcNode.id);
        nodes.splice(origIdx === -1 ? nodes.length : origIdx + 1, 0, newNode);
        nodes = [...nodes, ...newChildren];
      }

      return { nodes, selectedNodeId: newId, isDirty: true };
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
