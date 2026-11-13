import { create } from 'zustand';
import type { DebugValue } from '../engine/watchExpressions';

export type DebugPhase = 'idle' | 'running' | 'paused' | 'completed' | 'stopped' | 'error';
export interface DebugLocal extends DebugValue { name: string; scope: string; declaredType?: string; changedBy?: string; changed: boolean }
export interface WatchResult { expression: string; value?: DebugValue; error?: string }
const KEY = 'runway.studio.watch-expressions.v1';
function readWatches(): string[] {
  try { const list = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(list) ? [...new Set(list.filter((v): v is string => typeof v === 'string' && !!v.trim() && v.length <= 200))].slice(0, 50) : []; }
  catch { return []; }
}
let evaluateLive: ((expression: string) => WatchResult) | undefined;
const unavailable = (expression: string): WatchResult => ({ expression, error: 'Start a Debug run to evaluate this expression.' });
interface DebugState {
  phase: DebugPhase;
  projectName: string;
  activityName: string | null;
  locals: DebugLocal[];
  watches: string[];
  results: WatchResult[];
  updatedAt: number | null;
  storageWarning: string | null;
  begin: (projectName: string) => void;
  capture: (locals: DebugLocal[], activityName: string | null, phase: 'running' | 'paused', evaluate: (expression: string) => WatchResult) => void;
  finish: (phase: 'completed' | 'stopped' | 'error') => void;
  clearSession: () => void;
  addWatch: (expression: string) => void;
  removeWatch: (expression: string) => void;
}
function saveWatches(watches: string[]) {
  try { localStorage.setItem(KEY, JSON.stringify(watches)); return null; }
  catch { return 'Watch expressions are available for this session; the preference could not be saved.'; }
}
const initialWatches = readWatches();
export const useDebugStore = create<DebugState>((set, get) => ({
  phase: 'idle', projectName: '', activityName: null, locals: [], watches: initialWatches,
  results: initialWatches.map(unavailable), updatedAt: null, storageWarning: null,
  begin: (projectName) => { evaluateLive = undefined; set({ phase: 'running', projectName, activityName: null, locals: [], updatedAt: null, results: get().watches.map(unavailable) }); },
  capture: (locals, activityName, phase, evaluate) => {
    evaluateLive = evaluate;
    set({ locals, activityName, phase, updatedAt: Date.now(), results: get().watches.map(evaluate) });
  },
  finish: (phase) => { evaluateLive = undefined; set({ phase }); },
  clearSession: () => { evaluateLive = undefined; set({ phase: 'idle', projectName: '', activityName: null, locals: [], updatedAt: null, results: get().watches.map(unavailable) }); },
  addWatch: (input) => {
    const expression = input.trim(), state = get();
    if (!expression || expression.length > 200) throw Error('Enter an expression of 1–200 characters.');
    if (state.watches.includes(expression)) return;
    if (state.watches.length >= 50) throw Error('You can watch up to 50 expressions.');
    const watches = [...state.watches, expression];
    set({ watches, results: [...state.results, (evaluateLive ?? unavailable)(expression)], storageWarning: saveWatches(watches) });
  },
  removeWatch: (expression) => {
    const state = get(), watches = state.watches.filter((w) => w !== expression);
    set({ watches, results: state.results.filter((r) => r.expression !== expression), storageWarning: saveWatches(watches) });
  },
}));
