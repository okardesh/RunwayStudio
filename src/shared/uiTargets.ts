export interface UiTarget {
  id: string;
  name: string;
  application: string;
  selector: string;
  targetType: 'browser' | 'desktop';
  updatedAt: number;
}

export interface TargetBoundNode {
  id: string;
  data?: { label?: string; properties?: Record<string, unknown>; targetBindings?: Record<string, string> };
}

export function isUiTarget(value: unknown): value is UiTarget {
  if (!value || typeof value !== 'object') return false;
  const t = value as UiTarget;
  return typeof t.id === 'string' && !!t.id.trim() && typeof t.name === 'string' && !!t.name.trim()
    && typeof t.application === 'string' && typeof t.selector === 'string' && !!t.selector.trim()
    && t.selector.length <= 20000 && ['browser', 'desktop'].includes(t.targetType) && Number.isFinite(t.updatedAt);
}

/** Resolve a snapshot once per execution. Never silently execute a stale selector. */
export function resolveTargetBindings<T extends TargetBoundNode>(nodes: T[], targets: UiTarget[], strict = true): T[] {
  const byId = new Map(targets.map((target) => [target.id, target]));
  return nodes.map((node) => {
    const bindings = node.data?.targetBindings;
    if (!bindings || Object.keys(bindings).length === 0) return node;
    const properties = { ...node.data?.properties };
    for (const [property, id] of Object.entries(bindings)) {
      const target = byId.get(id);
      if (!target || !target.selector.trim()) {
        if (strict) throw new Error(`UI target missing for "${node.data?.label || node.id}" (${property}). Reconnect it in UI Targets before running.`);
        continue;
      }
      properties[property] = target.selector;
    }
    return { ...node, data: { ...node.data, properties } } as T;
  });
}

export function referencedTargets(nodes: TargetBoundNode[], targets: UiTarget[]): UiTarget[] {
  const ids = new Set(nodes.flatMap((node) => Object.values(node.data?.targetBindings ?? {})));
  return targets.filter((target) => ids.has(target.id)).map((target) => ({ ...target }));
}
