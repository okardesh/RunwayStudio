import { create } from 'zustand';
import { isUiTarget, type TargetBoundNode, type UiTarget } from '../shared/uiTargets';

const KEY = 'runway.studio.ui-targets.v1';
export interface TargetUsage { targetId: string; nodeId: string; label: string; property: string }
export interface IndexedWorkflow { key: string; name: string; filePath: string | null; usages: TargetUsage[] }
type LibraryData = { targets: UiTarget[]; workflows: IndexedWorkflow[]; deletedIds: string[] };
function readLibrary(): LibraryData {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { targets: Array.isArray(data.targets) ? data.targets.filter(isUiTarget) : [], deletedIds: Array.isArray(data.deletedIds) ? data.deletedIds.filter((id: unknown) => typeof id === 'string') : [],
      workflows: Array.isArray(data.workflows) ? data.workflows.filter((w: IndexedWorkflow) => typeof w.key === 'string' && Array.isArray(w.usages)) : [] };
  } catch { return { targets: [], workflows: [], deletedIds: [] }; }
}
function persist(data: LibraryData) {
  try { localStorage.setItem(KEY, JSON.stringify(data)); }
  catch { throw new Error('UI target library could not be saved on this device. Free local storage and try again.'); }
}

interface TargetState extends LibraryData {
  add: (draft: Omit<UiTarget, 'id' | 'updatedAt'>) => string;
  update: (id: string, draft: Omit<UiTarget, 'id' | 'updatedAt'>) => void;
  remove: (id: string) => void;
  importMissing: (targets: UiTarget[]) => void;
  indexWorkflow: (nodes: TargetBoundNode[], name: string, filePath: string | null) => void;
}

function validated(draft: Omit<UiTarget, 'id' | 'updatedAt'>, id: string, targets: UiTarget[]): UiTarget {
  const target = { ...draft, name: draft.name.trim(), application: draft.application.trim(), selector: draft.selector.trim(), id, updatedAt: Date.now() };
  if (!isUiTarget(target)) throw new Error('Enter a target name and a selector (up to 20,000 characters).');
  if (targets.some((t) => t.id !== id && t.name.toLowerCase() === target.name.toLowerCase() && t.application.toLowerCase() === target.application.toLowerCase())) {
    throw new Error('This application already has a target with that name.');
  }
  return target;
}

export const useUiTargetStore = create<TargetState>((set, get) => ({
  ...readLibrary(),
  add: (draft) => {
    const state = get(), id = crypto.randomUUID();
    const targets = [...state.targets, validated(draft, id, state.targets)];
    persist({ targets, workflows: state.workflows, deletedIds: state.deletedIds }); set({ targets }); return id;
  },
  update: (id, draft) => {
    const state = get();
    if (!state.targets.some((t) => t.id === id)) throw new Error('This UI target no longer exists.');
    if (state.targets.find((t) => t.id === id)?.targetType !== draft.targetType && state.workflows.some((w) => w.usages.some((u) => u.targetId === id))) {
      throw new Error('Unlink this target before changing its target type.');
    }
    const target = validated(draft, id, state.targets);
    const targets = state.targets.map((t) => t.id === id ? target : t);
    persist({ targets, workflows: state.workflows, deletedIds: state.deletedIds }); set({ targets });
  },
  remove: (id) => {
    const state = get();
    if (state.workflows.some((w) => w.usages.some((u) => u.targetId === id))) throw new Error('Unlink this target from its known workflows before deleting it.');
    const targets = state.targets.filter((t) => t.id !== id);
    const deletedIds = [...new Set([...state.deletedIds, id])];
    persist({ targets, workflows: state.workflows, deletedIds }); set({ targets, deletedIds });
  },
  importMissing: (incoming) => {
    if (!Array.isArray(incoming)) throw new Error('Invalid UI target bundle.');
    const state = get(), targets = [...state.targets];
    for (const candidate of incoming) {
      if (!isUiTarget(candidate)) throw new Error('Invalid UI target in workflow file.');
      if (state.deletedIds.includes(candidate.id)) continue; // Portable snapshots cannot resurrect deleted targets.
      if (targets.some((t) => t.id === candidate.id)) continue; // Local edits are authoritative.
      let name = candidate.name, suffix = 1;
      while (targets.some((t) => t.application.toLowerCase() === candidate.application.toLowerCase() && t.name.toLowerCase() === name.toLowerCase())) name = `${candidate.name} (imported ${suffix++})`;
      targets.push({ ...candidate, name });
    }
    if (targets.length === state.targets.length) return;
    persist({ targets, workflows: state.workflows, deletedIds: state.deletedIds }); set({ targets });
  },
  indexWorkflow: (nodes, name, filePath) => {
    const state = get();
    const key = filePath ? filePath.replace(/\\/g, '/').toLowerCase() : 'unsaved';
    const entry: IndexedWorkflow = { key, name, filePath, usages: nodes.flatMap((n) => Object.entries(n.data?.targetBindings ?? {}).map(([property, targetId]) => ({ targetId, nodeId: n.id, label: n.data?.label || n.id, property }))) };
    const workflows = [...state.workflows.filter((w) => w.key !== key && w.key !== 'unsaved'), entry];
    if (JSON.stringify(workflows) === JSON.stringify(state.workflows)) return;
    persist({ targets: state.targets, workflows, deletedIds: state.deletedIds }); set({ workflows });
  },
}));

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (event) => {
    if (event.key === KEY) useUiTargetStore.setState(readLibrary());
  });
}
