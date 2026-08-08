import { useWorkflowStore } from '../store/workflowStore';

const isElectron = () =>
  typeof window !== 'undefined' && 'electronAPI' in window && typeof (window as any).electronAPI?.saveWorkflow === 'function';

// Overwrites the remembered file path once one exists (from a prior Save or Open);
// otherwise prompts once via a native Save dialog and remembers the choice.
export async function saveWorkflow(): Promise<boolean> {
  const { nodes, edges, variables, projectName: name, filePath } = useWorkflowStore.getState();
  const content = JSON.stringify({ nodes, edges, variables, projectName: name }, null, 2);
  const defaultName = `${name.replace(/\s+/g, '_')}.rpa.json`;

  if (isElectron()) {
    const result = await (window as any).electronAPI.saveWorkflow(content, filePath, defaultName);
    if ('cancelled' in result) return false;
    useWorkflowStore.getState().setFilePath(result.path);
    useWorkflowStore.getState().markSaved();
    return true;
  }

  // Browser-preview fallback — no filesystem access, so this is always a fresh download.
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = defaultName;
  a.click();
  URL.revokeObjectURL(url);
  useWorkflowStore.getState().markSaved();
  return true;
}

// Returns true once the open has been fully handled (including "cancelled" and "not
// in Electron" — the latter only when running the plain browser dev preview, where the
// caller should fall back to its own <input type="file">).
export async function openWorkflow(): Promise<boolean> {
  if (!isElectron()) return false;
  const result = await (window as any).electronAPI.openWorkflow();
  if ('cancelled' in result) return true;
  try {
    useWorkflowStore.getState().loadWorkflow(JSON.parse(result.content), result.path);
  } catch {
    alert('Invalid workflow file.');
  }
  return true;
}
