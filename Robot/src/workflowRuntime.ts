import { argumentValue, cloneArgument, initializeArguments, parseWorkflowDefinition, resolveArgumentInput, validArgumentName, validateInvocation, type WorkflowDefinition } from '../../src/shared/invokedWorkflows';
import { PACKAGE_PREFIX, validatePortablePackage, validateRobotWorkflow, type PortableWorkflowPackage } from '../../src/shared/portableWorkflowPackage';
import { resolveTargetBindings } from '../../src/shared/uiTargets';
import { resolveLogMessage } from '../../src/shared/logMessageExpression';
import { executeAssetActivity, protectDerivedValues, type AssetResolver } from '../../src/shared/assets';
import { executeQueueActivity, queueActivities, type QueueRunSession } from '../../src/shared/queues';
import { evaluateBreakpointCondition } from '../../src/engine/breakpointCondition';

export type RobotActivity = (id: string, props: Record<string, unknown>) => Promise<{ success: boolean; log: string; outputs?: Record<string, unknown> }>;
export interface RobotWorkflowResult { outputs: Record<string, unknown>; package?: { id: string; version: string }; calls: Array<{ name: string; depth: number; status: 'completed' | 'error' }> }
type Flow = 'normal' | 'break' | 'continue';
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
function legacyDefinition(input: any): WorkflowDefinition {
  return parseWorkflowDefinition(JSON.stringify({ projectName: input.projectName ?? 'Workflow', nodes: (input.nodes ?? []).map((node: any) => ({ ...node, data: { ...node.data, label: node.data?.label ?? node.id, properties: node.data?.properties ?? {}, isContainer: node.data?.isContainer ?? !!node.data?.childIds?.length } })), edges: input.edges ?? [], variables: (input.variables ?? []).map((v: any) => ({ id: v.id ?? v.name, type: v.type ?? 'Object', scope: v.scope ?? 'Main', ...v })), arguments: input.arguments ?? [], uiTargets: input.uiTargets ?? [] }));
}
export class RobotJobStoppedError extends Error { constructor() { super('Job stopped at an activity boundary.'); this.name = 'RobotJobStoppedError'; } }
export interface RobotRunOptions { signal?: AbortSignal; live?: boolean; onSecret?: (value: string) => void; resolveAsset?: AssetResolver; queueSession?: QueueRunSession }
/** Resolves calls solely from the submitted package, never the Robot filesystem. */
export async function executeRobotWorkflow(input: unknown, inputs: Record<string, unknown>, native: RobotActivity, onLog: (level: 'info' | 'error', message: string) => void, options: RobotRunOptions = {}): Promise<RobotWorkflowResult> {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !inputs || typeof inputs !== 'object' || Array.isArray(inputs)) throw Error('Invalid workflow or job inputs.');
  let manifest: PortableWorkflowPackage | undefined;
  let loader: Awaited<ReturnType<typeof validatePortablePackage>>['loader'] | undefined;
  let definition: WorkflowDefinition;
  if ('portablePackage' in input) { const checked = await validatePortablePackage(input); manifest = checked.manifest; loader = checked.loader; definition = checked.definition; }
  else {
    definition = legacyDefinition(input); validateRobotWorkflow(definition); resolveTargetBindings(definition.nodes, definition.uiTargets ?? []);
    if (definition.nodes.some((n) => n.data.activityId === 'invoke-workflow')) throw Error('Invoke Workflow requires a portable package. Republish from Studio.');
  }
  const checkStop = () => { if (options.signal?.aborted) throw new RobotJobStoppedError(); };
  const definitions = manifest ? manifest.workflows.map(w => w.definition) : [definition];
  if (!options.queueSession && definitions.some(d => d.nodes.some(n => queueActivities.includes(n.data.activityId)))) throw Error('This workflow requires a Maestro queue context. Run it from Robot Jobs.');
  if (!options.resolveAsset && definitions.some(d => d.nodes.some(n => ['get-asset', 'get-credential'].includes(n.data.activityId)))) throw Error('This workflow requires a Maestro asset context. Select an environment and start it from Robot Jobs.');
  checkStop();
  const secrets = new Set<string>(), events: Array<{ level: 'info' | 'error'; message: string }> = [];
  const calls: RobotWorkflowResult['calls'] = [];
  let steps = 0;
  const collect = (value: unknown, properties = false) => {
    const pending = [{ value, depth: 0 }], seen = new Set<object>(); let count = 0;
    while (pending.length && count++ < 20000) { const item = pending.pop()!; if (!item.value || typeof item.value !== 'object' || item.depth > 20 || seen.has(item.value)) continue; seen.add(item.value);
      for (const [key, next] of Object.entries(item.value)) { if (properties && ['usernameOutput', 'passwordOutput'].includes(key)) continue; if (/password|secret|token|api.?key|credential|authorization/i.test(key) && typeof next === 'string' && next) { secrets.add(next); options.onSecret?.(next); } if (next && typeof next === 'object') pending.push({ value: next, depth: item.depth + 1 }); }
    }
  };
  const clean = (message: string) => { let text = message; for (const secret of [...secrets].sort((a, b) => b.length - a.length)) text = text.split(secret).join('[REDACTED]'); return text.slice(0, 4000); };
  let logSize = 0;
  const emit = (level: 'info' | 'error', message: string) => { if (events.length < 2000 && logSize + message.length <= 2_000_000) { events.push({ level, message }); if (options.live) onLog(level, clean(message)); logSize += message.length; } };
  const wait = (ms: number) => new Promise<void>((resolve, reject) => {
    checkStop();
    const abort = () => { clearTimeout(timer); reject(new RobotJobStoppedError()); };
    const timer = setTimeout(() => { options.signal?.removeEventListener('abort', abort); resolve(); }, ms);
    options.signal?.addEventListener('abort', abort, { once: true });
  });
  const run = async (workflow: WorkflowDefinition, provided: Record<string, unknown>, depth: number, path: string, chain: string[]): Promise<Record<string, unknown>> => {
    checkStop();
    if (depth > 16 || chain.includes(path)) throw Error('Workflow call depth or recursion limit reached.');
    const nodes = resolveTargetBindings(workflow.nodes, manifest?.uiTargets ?? workflow.uiTargets ?? []), byId = new Map(nodes.map((n) => [n.id, n]));
    const values: Record<string, unknown> = Object.create(null);
    for (const variable of workflow.variables) Object.defineProperty(values, variable.name, { value: variable.defaultValue === undefined ? null : cloneArgument(variable.defaultValue), writable: true, enumerable: true, configurable: true });
    for (const [name, value] of Object.entries(provided)) {
      if (!validArgumentName(name)) throw Error('Invalid input variable name.');
      if (depth === 0 && (!manifest || own(values, name))) values[name] = cloneArgument(value);
      else if (manifest && depth === 0 && !workflow.arguments.some((a) => a.direction === 'In' && a.name === name)) throw Error(`Unknown root input: ${name}`);
    }
    Object.assign(values, initializeArguments(workflow.arguments, workflow.variables, provided)); collect(values);
    const name = workflow.projectName; emit('info', `${depth ? 'Calling' : 'Starting'} workflow: ${name} (depth ${depth})`);
    const call = { name, depth, status: 'error' as 'error' | 'completed' }; calls.push(call);
    const children = (ids: string[]) => ids.map((id) => { const node = byId.get(id); if (!node) throw Error('Missing child activity.'); return node; });
    const sequence = async (list: typeof nodes): Promise<Flow> => { for (const node of list) { const flow = await runNode(node); if (flow !== 'normal') return flow; } return 'normal'; };
    const condition = (expression: string) => { const result = evaluateBreakpointCondition(expression, values); if (result.error) throw Error(`Invalid branch condition: ${result.error}`); return !!result.value; };
    const runNode = async (node: typeof nodes[number]): Promise<Flow> => {
      checkStop();
      options.queueSession?.assertHealthy();
      if (++steps > 10000) throw Error('Robot activity execution limit reached (10,000).');
      const d = node.data, p = d.properties, id = d.activityId;
      collect(p, true); emit('info', `Starting ${name} / ${d.label}`);
      if (queueActivities.includes(id)) {
        const outputs = await executeQueueActivity(id, p, values, options.queueSession, [...secrets]);
        checkStop(); Object.assign(values, outputs); emit('info', 'Central queue operation completed.'); return 'normal';
      }
      if (id === 'get-asset' || id === 'get-credential') {
        const outputs = await executeAssetActivity(id, p, options.resolveAsset, value => { secrets.add(value); options.onSecret?.(value); });
        checkStop(); Object.assign(values, outputs);
        emit('info', 'Read central ' + (id === 'get-credential' ? 'credential' : 'asset') + ' from the selected environment.');
        return 'normal';
      }
      if (id === 'break' || id === 'continue') return id;
      if (id === 'invoke-workflow') {
        if (!loader) throw Error('Invoked workflow is not packaged.');
        const loaded = await loader(String(p.workflowFile), path); validateInvocation(node, loaded.definition);
        const supplied: Record<string, unknown> = Object.create(null);
        for (const arg of loaded.definition.arguments.filter((a) => a.direction === 'In')) if (own((p.inArguments ?? {}) as object, arg.name)) {
          try { const resolved = resolveArgumentInput((p.inArguments as Record<string, unknown>)[arg.name], values); supplied[arg.name] = argumentValue(resolved.value, arg.type, resolved.authoredText); } catch { throw Error(`Input argument "${arg.name}" does not match ${arg.type}.`); }
        }
        const returned = await run(loaded.definition, supplied, depth + 1, loaded.path, [...chain, path]);
        checkStop();
        const outputs: Record<string, unknown> = Object.create(null);
        for (const arg of loaded.definition.arguments.filter((a) => a.direction === 'Out')) { const target = (p.outArguments as Record<string, string> | undefined)?.[arg.name]; if (target) outputs[target] = cloneArgument(returned[arg.name]); }
        Object.assign(values, outputs); collect(values); return 'normal';
      }
      if (id === 'if') {
        const branch = (d.branches ?? []).find((b) => b.kind === 'else' || condition(b.condition));
        return branch ? sequence(children(branch.childIds)) : 'normal';
      }
      if (id === 'for-each') {
        const item = d.loopVariable!.name;
        let collection: unknown = p.collection;
        if (typeof collection === 'string' && collection.includes('{{')) collection = resolveArgumentInput(collection, values).value;
        else if (typeof collection === 'string') { const text = collection; try { collection = JSON.parse(text); } catch { collection = text.trim() ? text.split(',').map((v) => v.trim()) : []; } }
        if (!Array.isArray(collection)) throw Error('For Each requires a collection.');
        const had = own(values, item), previous = values[item];
        try { for (const value of collection) { if (++steps > 10000) throw Error('Robot activity execution limit reached (10,000).'); values[item] = value; const flow = await sequence(children(d.childIds ?? [])); if (flow === 'break') break; } }
        finally { if (had) values[item] = previous; else delete values[item]; }
        return 'normal';
      }
      if (id === 'retry-scope') {
        const retries = Number(resolveArgumentInput(p.maxRetries ?? 3, values).value), delay = Number(resolveArgumentInput(p.retryDelay ?? 1000, values).value);
        if (!Number.isSafeInteger(retries) || retries < 0 || retries > 1000 || !Number.isFinite(delay) || delay < 0 || delay > 120000) throw Error('Invalid retry count or delay.');
        for (let attempt = 0; ; attempt++) { try { return await sequence(children(d.childIds ?? [])); } catch (error) { checkStop(); if (attempt >= retries) throw error; emit('info', `Retry ${attempt + 1} in ${name}`); if (delay) await wait(delay); } }
      }
      if (id === 'try-catch') {
        const branches = d.branches ?? [], tried = branches.find((b) => b.kind === 'try')!, final = branches.find((b) => b.kind === 'finally');
        let flow: Flow = 'normal', failure: unknown;
        try { flow = await sequence(children(tried.childIds)); } catch (error) {
          checkStop(); failure = error;
          for (const branch of branches.filter((b) => b.kind === 'catch')) { try { flow = await sequence(children(branch.childIds)); failure = undefined; break; } catch (caught) { failure = caught; } }
        } finally { if (final && !options.signal?.aborted) { const finalFlow = await sequence(children(final.childIds)); if (finalFlow !== 'normal') flow = finalFlow; } }
        if (failure) throw failure; return flow;
      }
      if (id === 'sequence') return sequence(children(d.childIds ?? []));
      if (id === 'assign') {
        const target = String(p.to ?? ''); if (!validArgumentName(target)) throw Error('Assign needs a variable name.');
        const resolved = resolveArgumentInput(p.value, values).value;
        protectDerivedValues(p, { value: resolved }, values, [...secrets], value => { secrets.add(value); options.onSecret?.(value); });
        values[target] = cloneArgument(resolved); collect(values);
      } else if (id === 'create-list') {
        const target = String(p.output ?? 'items'); if (!validArgumentName(target)) throw Error('Create List needs an output variable.'); values[target] = [];
      } else if (['add-to-collection','remove-from-collection','clear-collection'].includes(id)) {
        const target = String(p.collection ?? '').trim().replace(/^\{\{\s*|\s*\}\}$/g, ''); const list = values[target];
        if (!Array.isArray(list)) throw Error('Collection variable is not an array.');
        if (id === 'clear-collection') list.length = 0;
        else { const value = resolveArgumentInput(p.value, values).value; if (id === 'add-to-collection') list.push(value); else { const index = list.findIndex((item) => String(item) === String(value)); if (index >= 0) list.splice(index, 1); } }
      } else {
        const resolved = Object.fromEntries(Object.entries(p).map(([key, value]) => [key, ['output','to'].includes(key) || id === 'log-message' && key === 'message' ? value : typeof value === 'string' && value.includes('{{') ? resolveArgumentInput(value, values).value : value]));
        if (id === 'log-message') resolved.message = resolveLogMessage(p.message, values);
        protectDerivedValues(p, resolved, values, [...secrets], value => { secrets.add(value); options.onSecret?.(value); });
        const result = await native(id, resolved); checkStop(); options.queueSession?.assertHealthy(); collect(result.outputs); emit(result.success ? 'info' : 'error', result.log);
        if (!result.success) throw Error(result.log || `Activity failed: ${id}`);
        Object.assign(values, result.outputs ?? {}); collect(values);
      }
      return d.isContainer ? sequence(children(d.childIds ?? [])) : 'normal';
    };
    await sequence(nodes.filter((n) => !n.data.parentId));
    checkStop();
    const outputs: Record<string, unknown> = Object.create(null);
    for (const arg of workflow.arguments.filter((a) => a.direction === 'Out')) {
      try { outputs[arg.name] = argumentValue(values[arg.name], arg.type); } catch { throw Error(`Output argument "${arg.name}" does not match ${arg.type}.`); }
    }
    collect(outputs); if (JSON.stringify(outputs).length > 2_000_000) throw Error('Combined workflow outputs exceed 2 MB.');
    call.status = 'completed'; emit('info', `Completed workflow: ${name} (depth ${depth})`); return outputs;
  };
  try {
    if (manifest) emit('info', `Package ${manifest.id} · version ${manifest.version}`);
    const outputs = await run(definition, inputs, 0, manifest ? PACKAGE_PREFIX + manifest.entryWorkflowId : '<legacy>', []);
    return { outputs, calls, ...(manifest ? { package: { id: manifest.id, version: manifest.version } } : {}) };
  } catch (error) { checkStop(); throw Error(clean(error instanceof Error ? error.message : 'Workflow execution failed.')); }
  finally { if (!options.live) for (const event of events) onLog(event.level, clean(event.message)); }
}
