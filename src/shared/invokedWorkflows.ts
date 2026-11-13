import type { Node, Edge } from 'reactflow';
import type { WorkflowArgument, WorkflowNodeData, WorkflowVariable } from '../types';
import type { UiTarget } from './uiTargets';
import { evaluateWatchExpression } from '../engine/watchExpressions';

export interface WorkflowDefinition { projectName: string; nodes: Node<WorkflowNodeData>[]; edges: Edge[]; variables: WorkflowVariable[]; arguments: WorkflowArgument[]; uiTargets?: UiTarget[] }
export interface LoadedWorkflow { path: string; definition: WorkflowDefinition }
export type WorkflowLoader = (requestedPath: string, callerPath: string | null) => Promise<LoadedWorkflow>;
export const workflowPathKey = (path: string) => path.replace(/\\/g, '/').toLowerCase();
export const validArgumentName = (name: string) => /^[A-Za-z_]\w*$/.test(name) && !['__proto__', 'constructor', 'prototype'].includes(name);
export function supportedArgumentType(type: string, depth = 0): boolean {
  if (depth > 10 || type.length > 200) return false;
  if (['String', 'Boolean', 'DateTime', 'Object', 'Array', 'List', 'Byte', 'SByte', 'Int16', 'Int32', 'Int64', 'UInt16', 'UInt32', 'UInt64', 'Single', 'Double', 'Decimal'].includes(type)) return true;
  const element = type.match(/^List<(.+)>$/)?.[1] ?? (type.endsWith('[]') ? type.slice(0, -2) : undefined);
  return !!element && supportedArgumentType(element, depth + 1);
}
export function parseWorkflowDefinition(content: string): WorkflowDefinition {
  if (content.length > 5_000_000) throw Error('Workflow file exceeds 5 MB.');
  const d = JSON.parse(content);
  if (!d || !Array.isArray(d.nodes) || !Array.isArray(d.edges) || !Array.isArray(d.variables) || d.arguments !== undefined && !Array.isArray(d.arguments)) throw Error('Not a valid Studio .rpa.json workflow.');
  if (!d.nodes.length || d.nodes.length > 2000) throw Error('An invoked workflow needs 1–2,000 activities.');
  const ids = new Set<string>();
  for (const n of d.nodes) { if (!n || typeof n.id !== 'string' || ids.has(n.id) || !n.data || typeof n.data.activityId !== 'string' || !n.data.properties || typeof n.data.properties !== 'object') throw Error('Invalid or duplicate activity definition.'); ids.add(n.id); }
  for (const v of d.variables) if (!v || !validArgumentName(v.name) || typeof v.type !== 'string') throw Error('Invalid workflow variable.');
  return { ...d, projectName: typeof d.projectName === 'string' ? d.projectName : 'Workflow', arguments: d.arguments ?? [] };
}
export function validateArguments(args: WorkflowArgument[], variables: WorkflowVariable[]) {
  const names = new Set(variables.map((v) => v.name));
  for (const arg of args) {
    if (!arg || typeof arg.name !== 'string' || !validArgumentName(arg.name) || names.has(arg.name)) throw Error('Argument names must be valid, unique and distinct from local variables.');
    if (!['In', 'Out'].includes(arg.direction) || typeof arg.type !== 'string') throw Error(`Invalid argument declaration: ${arg.name}`);
    names.add(arg.name); argumentValue(defaultForType(arg.type), arg.type);
    if (arg.defaultValue !== undefined && arg.defaultValue !== '') {
      try { argumentValue(arg.defaultValue, arg.type, true); } catch { throw Error(`Invalid default value for argument: ${arg.name} (${arg.type}).`); }
    }
  }
}
function defaultForType(type: string): unknown {
  if (type === 'String' || type === 'DateTime') return type === 'DateTime' ? '1970-01-01T00:00:00.000Z' : '';
  if (type === 'Boolean') return false;
  if (/^(?:List(?:<.*>)?|Array|.*\[\])$/.test(type)) return [];
  if (type === 'Object') return null;
  return 0;
}
export function cloneArgument(value: unknown): unknown {
  if (value === undefined) throw Error('Argument value is undefined.');
  const inspect = [{ value, depth: 0 }]; let inspected = 0;
  while (inspect.length) {
    const item = inspect.pop()!;
    if (++inspected > 20000 || item.depth > 20) throw Error('Argument data is too large, cyclic or deeply nested.');
    const raw = item.value;
    if (raw === undefined || ['function', 'symbol', 'bigint'].includes(typeof raw) || typeof raw === 'number' && !Number.isFinite(raw)) throw Error('Arguments must contain finite JSON data.');
    if (raw && typeof raw === 'object') {
      if (!Array.isArray(raw) && ![Object.prototype, null].includes(Object.getPrototypeOf(raw))) throw Error('Arguments must contain plain JSON objects or arrays.');
      if (Array.isArray(raw) && (Object.keys(raw).length !== raw.length || Object.keys(raw).some((k) => !/^(0|[1-9]\d*)$/.test(k) || Number(k) >= raw.length))) throw Error('Sparse or extended argument arrays are not supported.');
      for (const key of Object.keys(raw)) { const descriptor = Object.getOwnPropertyDescriptor(raw, key); if (!descriptor || !('value' in descriptor)) throw Error('Argument accessors are not evaluated.'); inspect.push({ value: descriptor.value, depth: item.depth + 1 }); }
    }
  }
  const text = JSON.stringify(value);
  if (!text || text.length > 500000) throw Error('Argument data exceeds the JSON value limit (500 KB).');
  const copy = JSON.parse(text), pending = [{ value: copy, depth: 0 }]; let count = 0;
  while (pending.length) { const item = pending.pop()!; if (++count > 20000 || item.depth > 20) throw Error('Argument data is too large or deeply nested.'); if (item.value && typeof item.value === 'object') for (const next of Object.values(item.value)) pending.push({ value: next, depth: item.depth + 1 }); }
  return copy;
}
export function argumentValue(raw: unknown, type: string, authoredText = false): unknown {
  if (!supportedArgumentType(type)) throw Error(`Unsupported argument type: ${type}`);
  let value = raw;
  if (authoredText && typeof value === 'string' && type !== 'String' && type !== 'DateTime') {
    try { value = JSON.parse(value); } catch { throw Error(`Enter a JSON value for ${type}.`); }
  }
  if (type === 'String') { if (typeof value !== 'string') throw Error('Expected String argument.'); }
  else if (type === 'Boolean') { if (typeof value !== 'boolean') throw Error('Expected Boolean argument.'); }
  else if (type === 'DateTime') { if (typeof value !== 'string' || !value.trim() || !Number.isFinite(Date.parse(value))) throw Error('Expected an ISO DateTime string.'); }
  else if (type === 'Object') { /* Any JSON value is supported. */ }
  else if (/^(?:List(?:<.*>)?|Array|.*\[\])$/.test(type)) {
    if (!Array.isArray(value)) throw Error('Expected an Array/List argument.');
    const element = type.match(/^List<(.+)>$/)?.[1] ?? (type.endsWith('[]') ? type.slice(0, -2) : undefined);
    if (element) for (const item of value) argumentValue(item, element);
  }
  else if (['Byte', 'SByte', 'Int16', 'Int32', 'Int64', 'UInt16', 'UInt32', 'UInt64', 'Single', 'Double', 'Decimal'].includes(type)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw Error(`Expected a finite ${type} argument.`);
    if (!['Single', 'Double', 'Decimal'].includes(type) && !Number.isSafeInteger(value)) throw Error(`Expected a safe whole number for ${type}.`);
    const ranges: Record<string, [number, number]> = { Byte: [0, 255], SByte: [-128, 127], Int16: [-32768, 32767], UInt16: [0, 65535], Int32: [-2147483648, 2147483647], UInt32: [0, 4294967295], UInt64: [0, Number.MAX_SAFE_INTEGER] };
    if (ranges[type] && (value < ranges[type][0] || value > ranges[type][1])) throw Error(`Argument is outside the ${type} range.`);
  } else throw Error(`Unsupported argument type: ${type}`);
  return cloneArgument(value);
}
export function resolveArgumentInput(raw: unknown, values: Record<string, unknown>): { value: unknown; authoredText: boolean } {
  if (typeof raw !== 'string') return { value: cloneArgument(raw), authoredText: false };
  const exact = raw.trim().match(/^\{\{\s*([^{}]+?)\s*\}\}$/);
  if (exact) { const result = evaluateWatchExpression(exact[1], values); if (result.error) throw Error(result.error); return { value: cloneArgument(result.value), authoredText: false }; }
  if (raw.includes('{{')) {
    const value = raw.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_match, expression) => { const result = evaluateWatchExpression(expression, values); if (result.error) throw Error(result.error); if (result.value && typeof result.value === 'object') throw Error('Use a whole-variable template for structured arguments.'); return String(result.value ?? ''); });
    if (value.includes('{{')) throw Error('Invalid argument template.');
    return { value, authoredText: true };
  }
  return { value: raw, authoredText: true };
}
export function initializeArguments(args: WorkflowArgument[], variables: WorkflowVariable[], provided: Record<string, unknown> = {}) {
  validateArguments(args, variables);
  const result: Record<string, unknown> = Object.create(null);
  for (const arg of args) {
    const supplied = arg.direction === 'In' && Object.prototype.hasOwnProperty.call(provided, arg.name);
    if (!supplied && arg.direction === 'In' && arg.required && (arg.defaultValue === undefined || arg.defaultValue === '')) throw Error(`Required input argument is missing: ${arg.name}`);
    const hasDefault = arg.defaultValue !== undefined && arg.defaultValue !== '';
    result[arg.name] = supplied ? argumentValue(provided[arg.name], arg.type) : hasDefault ? argumentValue(arg.defaultValue, arg.type, true) : defaultForType(arg.type);
  }
  return result;
}
function mappings(value: unknown, field: string): Record<string, unknown> {
  if (value === undefined) return {};
  if (!value || Array.isArray(value) || typeof value !== 'object') throw Error(`${field} must be an argument mapping object.`);
  return value as Record<string, unknown>;
}
export function validateInvocation(node: Node<WorkflowNodeData>, child: WorkflowDefinition) {
  validateArguments(child.arguments, child.variables);
  const inputs = mappings(node.data.properties.inArguments, 'Inputs'), outputs = mappings(node.data.properties.outArguments, 'Outputs');
  for (const name of Object.keys(inputs)) if (!child.arguments.some((a) => a.name === name && a.direction === 'In')) throw Error(`Unknown input argument: ${name}`);
  for (const [name, target] of Object.entries(outputs)) if (!child.arguments.some((a) => a.name === name && a.direction === 'Out') || typeof target !== 'string' || target && !validArgumentName(target)) throw Error(`Invalid output argument mapping: ${name}`);
  const destinations = Object.values(outputs).filter(Boolean); if (new Set(destinations).size !== destinations.length) throw Error('Map each output to a distinct caller variable.');
  for (const arg of child.arguments.filter((a) => a.direction === 'In')) {
    if (!Object.prototype.hasOwnProperty.call(inputs, arg.name)) {
      if (arg.required && (arg.defaultValue === undefined || arg.defaultValue === '')) throw Error(`Required input argument is not mapped: ${arg.name}`);
    } else if (typeof inputs[arg.name] !== 'string' || !(inputs[arg.name] as string).includes('{{')) {
      try { argumentValue(inputs[arg.name], arg.type, typeof inputs[arg.name] === 'string'); } catch { throw Error(`Invalid input mapping for argument: ${arg.name} (${arg.type}).`); }
    }
  }
}
export interface WorkflowGraph { files: LoadedWorkflow[]; resolve: (callerPath: string | null, nodeId: string) => LoadedWorkflow }
export async function loadWorkflowGraph(root: WorkflowDefinition, rootPath: string | null, loader: WorkflowLoader): Promise<WorkflowGraph> {
  const calls = new Map<string, LoadedWorkflow>(), files = new Map<string, LoadedWorkflow>(); let count = 0;
  const callKey = (caller: string | null, id: string) => JSON.stringify([caller ? workflowPathKey(caller) : '<root>', id]);
  const visit = async (definition: WorkflowDefinition, caller: string | null, chain: string[]) => {
    for (const node of definition.nodes.filter((n) => n.data.activityId === 'invoke-workflow')) {
      const requested = node.data.properties.workflowFile;
      if (typeof requested !== 'string' || !requested.trim() || requested.includes('{{')) throw Error(`Invoke "${node.data.label}": choose a static .rpa.json path.`);
      if (++count > 100 || chain.length >= 16) throw Error('Workflow dependency limit reached (100 calls / 16 levels).');
      let loaded: LoadedWorkflow;
      try { loaded = await loader(requested, caller); } catch { throw Error(`Invoke "${node.data.label}": workflow file could not be read. Check its path and JSON definition.`); }
      const key = workflowPathKey(loaded.path);
      if (chain.includes(key)) throw Error(`Invoke "${node.data.label}": recursive workflow calls are not supported.`);
      loaded = files.get(key) ?? loaded; files.set(key, loaded);
      validateInvocation(node, loaded.definition); calls.set(callKey(caller, node.id), loaded);
      await visit(loaded.definition, loaded.path, [...chain, key]);
    }
  };
  await visit(root, rootPath, rootPath ? [workflowPathKey(rootPath)] : []);
  return { files: [...files.values()], resolve: (caller, id) => { const loaded = calls.get(callKey(caller, id)); if (!loaded) throw Error('Invoked workflow was not prepared.'); return loaded; } };
}
