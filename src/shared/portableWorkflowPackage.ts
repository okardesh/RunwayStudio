import { loadWorkflowGraph, parseWorkflowDefinition, validateArguments, type WorkflowDefinition, type WorkflowLoader } from './invokedWorkflows';
import { isUiTarget, resolveTargetBindings, type UiTarget } from './uiTargets';
import { robotActivities } from './robotCapabilities';
import { assetRequirement } from './assets';

export const PACKAGE_PREFIX = 'package://';
export const MAX_DEFINITION_BYTES = 8_000_000;
export interface PackageWorkflow { id: string; definition: WorkflowDefinition }
export interface PortableWorkflowPackage { format: 'runway.portable-workflow'; schemaVersion: 1; id: string; version: string; entryWorkflowId: string; workflows: PackageWorkflow[]; uiTargets: UiTarget[] }
export type PortableDefinition = WorkflowDefinition & { portablePackage: PortableWorkflowPackage };
function canonical(value: unknown, depth = 0): string {
  if (depth > 80) throw Error('Package nesting limit exceeded.');
  if (Array.isArray(value)) return `[${value.map((v) => canonical(v, depth + 1)).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k], depth + 1)}`).join(',')}}`;
  const json = JSON.stringify(value); if (json === undefined) throw Error('Package must contain JSON data.'); return json;
}
async function digest(manifest: Omit<PortableWorkflowPackage, 'id'>) {
  const bytes = new TextEncoder().encode(canonical(manifest));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return `sha256:${Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('')}`;
}
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
function fields(def: WorkflowDefinition): WorkflowDefinition { return copy({ projectName: def.projectName, nodes: def.nodes, edges: def.edges, variables: def.variables, arguments: def.arguments ?? [], uiTargets: def.uiTargets ?? [] }); }
export function validateRobotWorkflow(def: WorkflowDefinition) {
  validateArguments(def.arguments, def.variables);
  const byId = new Map(def.nodes.map((n) => [n.id, n]));
  const owners = new Map<string, string>();
  if (!def.nodes.some((n) => !n.data.parentId)) throw Error('Workflow has no root activities.');
  for (const node of def.nodes) {
    const d = node.data;
    if (['get-asset', 'get-credential'].includes(d.activityId)) assetRequirement(d.activityId, d.properties);
    if (!robotActivities.has(d.activityId)) throw Error(`Robot does not support activity: ${d.activityId}`);
    if (['if', 'for-each', 'try-catch', 'retry-scope'].includes(d.activityId) && !d.isContainer) throw Error(`Control activity must be a container: ${d.label}`);
    if (d.parentId && !byId.has(d.parentId)) throw Error(`Missing parent for activity: ${d.label}`);
    const seen = new Set([node.id]); let parent = d.parentId;
    while (parent) { if (seen.has(parent)) throw Error('Workflow hierarchy contains a cycle.'); seen.add(parent); parent = byId.get(parent)?.data.parentId; }
    const branches = d.branches ?? [];
    if (new Set(branches.map((b) => b.id)).size !== branches.length) throw Error('Branch IDs must be unique.');
    if (d.activityId === 'if' && (branches[0]?.kind !== 'if' || branches.filter((b) => b.kind === 'if').length !== 1 || branches.filter((b) => b.kind === 'else').length > 1 || branches.some((b, i) => !['if','elseIf','else'].includes(b.kind) || b.kind === 'else' && i !== branches.length - 1 || b.kind !== 'else' && !b.condition.trim()))) throw Error('Invalid IF branch structure or condition.');
    if (d.activityId === 'try-catch' && (branches.filter((b) => b.kind === 'try').length !== 1 || branches.filter((b) => b.kind === 'finally').length > 1 || branches.some((b) => !['try','catch','finally'].includes(b.kind)))) throw Error('Invalid Try Catch branch structure.');
    if (d.activityId === 'for-each' && !d.loopVariable?.name) throw Error('For Each needs a loop variable.');
    if (['break','continue'].includes(d.activityId) && byId.get(d.parentId ?? '')?.data.activityId !== 'for-each') throw Error('Break/Continue must be direct children of For Each.');
    const refs = [...(d.childIds ?? []).map((id) => ({ id, branch: undefined as string | undefined })), ...branches.flatMap((b) => b.childIds.map((id) => ({ id, branch: b.id })))];
    if (refs.length && !d.isContainer && d.activityId !== 'sequence') throw Error('An activity with children must be a container.');
    for (const ref of refs) {
      const child = byId.get(ref.id);
      if (!child || child.data.parentId !== node.id || child.data.branchId !== ref.branch || owners.has(ref.id)) throw Error('Missing, duplicated or inconsistently owned child activity.');
      owners.set(ref.id, node.id);
    }
  }
  for (const node of def.nodes) if (node.data.parentId && !owners.has(node.id)) throw Error('An activity is not listed in its parent block.');
  for (const edge of def.edges) if (!byId.has(edge.source) || !byId.has(edge.target)) throw Error('A workflow connection has a missing endpoint.');
}
/** Only invoked workflows and referenced targets are collected; no directory archive or file copying. */
export async function buildPortablePackage(root: WorkflowDefinition, rootPath: string | null, targets: UiTarget[], version: string, loader: WorkflowLoader, deletedTargetIds: string[] = []): Promise<PortableDefinition> {
  if (!version.trim() || version.length > 80) throw Error('Enter a package version of 1–80 characters.');
  const source = fields(root), current = copy(targets);
  const graph = await loadWorkflowGraph(source, rootPath, loader);
  const entries = [{ id: 'wf-0', path: rootPath, definition: source }, ...graph.files.map((file, index) => ({ id: `wf-${index + 1}`, path: file.path, definition: fields(file.definition) }))];
  const key = (path: string) => path.replace(/\\/g, '/').toLowerCase();
  const ids = new Map(entries.filter((e) => e.path).map((e) => [key(e.path!), e.id]));
  const authoritative = new Map(current.map((t) => [t.id, t]));
  const catalog = new Map<string, UiTarget>();
  for (const entry of entries) for (const node of entry.definition.nodes) for (const targetId of Object.values(node.data.targetBindings ?? {})) {
    if (deletedTargetIds.includes(targetId)) throw Error('A referenced UI target was deleted from the shared library. Reconnect it before publishing.');
    const target = authoritative.get(targetId) ?? entry.definition.uiTargets?.find((t) => t.id === targetId);
    if (!target || !isUiTarget(target)) throw Error(`UI target is missing or invalid in ${entry.definition.projectName}.`);
    const previous = catalog.get(targetId);
    if (previous && (previous.selector !== target.selector || previous.targetType !== target.targetType || previous.application !== target.application)) throw Error('Conflicting snapshots for the same UI target. Update the shared target library before publishing.');
    catalog.set(targetId, copy(target));
  }
  const uiTargets = [...catalog.values()];
  const workflows = entries.map((entry) => {
    const definition = fields(entry.definition);
    definition.nodes = resolveTargetBindings(definition.nodes, uiTargets).map((node) => node.data.activityId === 'invoke-workflow' ? { ...node, data: { ...node.data, properties: { ...node.data.properties, workflowFile: PACKAGE_PREFIX + ids.get(key(graph.resolve(entry.path, node.id).path))! } } } : node);
    const used = new Set(definition.nodes.flatMap((n) => Object.values(n.data.targetBindings ?? {})));
    definition.uiTargets = uiTargets.filter((t) => used.has(t.id));
    validateRobotWorkflow(definition);
    return { id: entry.id, definition };
  });
  const manifest: Omit<PortableWorkflowPackage, 'id'> = { format: 'runway.portable-workflow', schemaVersion: 1, version: version.trim(), entryWorkflowId: 'wf-0', workflows, uiTargets };
  const portablePackage = { ...manifest, id: await digest(manifest) };
  const definition = { ...copy(workflows[0].definition), portablePackage };
  await validatePortablePackage(definition);
  return definition;
}
export async function validatePortablePackage(input: unknown): Promise<{ definition: PortableDefinition; manifest: PortableWorkflowPackage; loader: WorkflowLoader }> {
  const json = JSON.stringify(input);
  if (!json || new TextEncoder().encode(json).length > MAX_DEFINITION_BYTES) throw Error('Portable definition exceeds the 8 MB limit.');
  const definition = JSON.parse(json) as PortableDefinition;
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) throw Error('Invalid portable workflow definition.');
  const manifest = definition.portablePackage;
  if (!manifest || manifest.format !== 'runway.portable-workflow' || manifest.schemaVersion !== 1 || typeof manifest.version !== 'string' || !manifest.version.trim() || manifest.version.length > 80 || !Array.isArray(manifest.workflows) || !manifest.workflows.length || manifest.workflows.length > 101 || !Array.isArray(manifest.uiTargets)) throw Error('Invalid or unsupported portable workflow package.');
  const { id, ...content } = manifest;
  if (id !== await digest(content)) throw Error('Portable package integrity check failed.');
  const files = new Map<string, WorkflowDefinition>();
  const targetIds = new Set<string>();
  for (const target of manifest.uiTargets) { if (!isUiTarget(target) || targetIds.has(target.id)) throw Error('Invalid or duplicate packaged UI target.'); targetIds.add(target.id); }
  for (const file of manifest.workflows) {
    if (!/^wf-\d+$/.test(file.id) || files.has(file.id)) throw Error('Invalid or duplicate packaged workflow ID.');
    const parsed = parseWorkflowDefinition(JSON.stringify(file.definition));
    if ('portablePackage' in parsed) throw Error('Nested package envelopes are not supported.');
    validateRobotWorkflow(parsed); resolveTargetBindings(parsed.nodes, manifest.uiTargets);
    for (const node of parsed.nodes) if (node.data.activityId === 'invoke-workflow' && (typeof node.data.properties.workflowFile !== 'string' || !/^package:\/\/wf-\d+$/.test(node.data.properties.workflowFile))) throw Error('Packaged calls must use package references, not filesystem paths.');
    files.set(file.id, parsed);
  }
  const entry = files.get(manifest.entryWorkflowId);
  if (!entry || canonical(fields(definition)) !== canonical(fields(entry))) throw Error('Entry workflow does not match the portable package.');
  const loader: WorkflowLoader = async (requested) => {
    if (!/^package:\/\/wf-\d+$/.test(requested)) throw Error('Robot cannot resolve a local workflow path.');
    const file = files.get(requested.slice(PACKAGE_PREFIX.length)); if (!file) throw Error('Missing workflow dependency in package.');
    return { path: requested, definition: file };
  };
  const graph = await loadWorkflowGraph(entry, PACKAGE_PREFIX + manifest.entryWorkflowId, loader);
  if (graph.files.length + 1 !== files.size) throw Error('Package contains unreachable workflow definitions.');
  return { definition, manifest, loader };
}
