import { create } from 'zustand';
import { validateTest, type WorkflowTest } from '../shared/workflowTests';

const KEY = 'runway.studio.workflow-tests.v1';
function load(): WorkflowTest[] {
  try { const parsed = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(parsed) ? parsed.slice(0, 50).filter((test) => { try { validateTest(test); return true; } catch { return false; } }) : []; }
  catch { return []; }
}
interface TestExplorerState {
  tests: WorkflowTest[];
  active: boolean;
  progress: string;
  completed: number;
  total: number;
  stopRequested: boolean;
  save: (test: WorkflowTest) => void;
  remove: (id: string) => void;
}
function persist(tests: WorkflowTest[]) {
  const json = JSON.stringify(tests);
  if (tests.length > 50 || json.length > 500000) throw Error('Test library limit reached (50 tests / 500 KB).');
  try { localStorage.setItem(KEY, json); } catch { throw Error('Test changes could not be saved to local storage.'); }
}
export const useTestExplorerStore = create<TestExplorerState>((set, get) => ({
  tests: load(), active: false, progress: '', completed: 0, total: 0, stopRequested: false,
  save: (test) => { const copy = JSON.parse(JSON.stringify(test)); validateTest(copy); const tests = [...get().tests.filter((t) => t.id !== test.id), copy]; persist(tests); set({ tests }); },
  remove: (id) => { const tests = get().tests.filter((t) => t.id !== id); persist(tests); set({ tests }); },
}));
