import type { Node } from 'reactflow';
import type { WorkflowNodeData, WorkflowVariable } from '../types';
import { useDebugStore, type DebugLocal, type WatchResult } from '../store/debugStore';
import { debugValue, evaluateWatchExpression, sensitiveName } from './watchExpressions';

export function createLiveDebugger(projectName: string, nodes: Node<WorkflowNodeData>[], variables: WorkflowVariable[]) {
  useDebugStore.getState().begin(projectName);
  const previous = new Map<string, string>(), changedBy = new Map<string, string>();
  let changed = new Set<string>(), initialized = false;
  const variableInfo = new Map(variables.map((v) => [v.name, { scope: v.scope || 'Main', declaredType: v.type }]));
  return {
    capture(values: Record<string, unknown>, nodeId: string | null, phase: 'running' | 'paused' = 'running', afterActivity = false) {
      const label = nodes.find((n) => n.id === nodeId)?.data.label ?? null;
      const scopeInfo = new Map(variableInfo);
      let context = nodes.find((n) => n.id === nodeId);
      const seen = new Set<string>();
      while (context?.data.parentId && !seen.has(context.data.parentId)) {
        seen.add(context.data.parentId);
        context = nodes.find((n) => n.id === context?.data.parentId);
        if (context?.data.loopVariable) scopeInfo.set(context.data.loopVariable.name, { scope: context.data.label, declaredType: context.data.loopVariable.type });
      }
      const secrets = Object.entries(values).filter(([key, value]) => sensitiveName.test(key) && typeof value === 'string' && !!value).map(([, value]) => String(value));
      const updates = new Set<string>();
      const locals: DebugLocal[] = Object.entries(values).map(([name, raw]) => {
        const value = debugValue(raw, secrets, sensitiveName.test(name));
        const fingerprint = JSON.stringify([value.type, value.detail]);
        if (initialized && previous.get(name) !== fingerprint) { updates.add(name); if (label) changedBy.set(name, label); }
        previous.set(name, fingerprint);
        return { name, ...value, scope: scopeInfo.get(name)?.scope ?? 'Main', declaredType: scopeInfo.get(name)?.declaredType,
          changedBy: changedBy.get(name), changed: false };
      });
      for (const name of previous.keys()) if (!Object.prototype.hasOwnProperty.call(values, name)) previous.delete(name);
      if (afterActivity || updates.size) changed = updates;
      for (const local of locals) local.changed = changed.has(local.name);
      initialized = true;
      const evaluate = (expression: string): WatchResult => {
        // Sensitive roots and member names are masked before any member evaluation.
        if (sensitiveName.test(expression)) return { expression, value: debugValue(undefined, [], true) };
        const result = evaluateWatchExpression(expression, values);
        return result.error ? { expression, error: result.error } : { expression, value: debugValue(result.value, secrets) };
      };
      useDebugStore.getState().capture(locals, label, phase, evaluate);
    },
    finish(phase: 'completed' | 'stopped' | 'error') { useDebugStore.getState().finish(phase); },
  };
}
