import type { Edge, Node } from 'reactflow';
import type { WorkflowArgument, WorkflowNodeData, WorkflowVariable } from '../types';
import { getActivity } from '../activities/registry';
import type { UiTarget } from '../shared/uiTargets';
import { hasWorkflowCall, validateArguments, validArgumentName } from '../shared/invokedWorkflows';
import { validateTransactionScope } from '../shared/transactionScope';
import { humanActivities, validateHumanActivity } from '../shared/humanTasks';
import { queueActivities, validateQueueActivity } from '../shared/queues';
import { assetRequirement, type AssetCatalog } from '../shared/assets';

export interface AnalysisSource { assets?: { profileId: string; catalog: AssetCatalog }; nodes: Node<WorkflowNodeData>[]; edges: Edge[]; variables: WorkflowVariable[]; arguments: WorkflowArgument[]; targets: UiTarget[]; projectName: string; filePath: string | null }
export type FindingSeverity = 'error' | 'warning' | 'info';
export interface AnalysisFinding { id: string; code: string; severity: FindingSeverity; nodeId?: string; activity: string; property: string; message: string; recommendation: string }
export interface AnalysisReport { signature: string; projectName: string; analyzedAt: number; findings: AnalysisFinding[]; truncated: boolean; dependencyState?: 'checking' | 'complete' | 'unavailable' }
const identifier = /^[A-Za-z_]\w*$/;
const blank = (value: unknown) => value === undefined || value === null || typeof value === 'string' && !value.trim();
const variableName = (value: unknown) => String(value ?? '').trim().replace(/^\{\{\s*|\s*\}\}$/g, '');
const outputField = (name: string) => ['output', 'to', 'usernameOutput', 'passwordOutput', 'hasItemOutput', 'exceptionOutput', 'resultOutput'].includes(name);

/** Includes semantic edits, excluding selection, folding, execution state and canvas layout. */
export function analysisSignature(source: AnalysisSource) {
  return JSON.stringify({ name: source.projectName, file: source.filePath, nodes: source.nodes.map(({ id, data }) => ({ id,
    activityId: data.activityId, label: data.label, properties: data.properties, targetBindings: data.targetBindings,
    parentId: data.parentId, branchId: data.branchId, childIds: data.childIds, branches: data.branches, loopVariable: data.loopVariable, isContainer: data.isContainer })),
    edges: source.edges.map(({ id, source, target }) => ({ id, source, target })), variables: source.variables, arguments: source.arguments,
    assets: source.assets ? { profileId: source.assets.profileId, profiles: source.assets.catalog.profiles, assets: source.assets.catalog.assets.map(({ name, type, revision, profileId }) => ({ name, type, revision, profileId })) } : undefined,
    targets: source.targets.map(({ id, name, selector, targetType, application }) => ({ id, name, selector, targetType, application })) });
}

/** Pure, offline analysis. Never invokes activities, evaluates code, saves files or contacts applications. */
export function analyzeWorkflow(source: AnalysisSource): AnalysisReport {
  const findings: AnalysisFinding[] = [];
  let truncated = false;
  const add = (code: string, severity: FindingSeverity, node: Node<WorkflowNodeData> | undefined, property: string, message: string, recommendation: string) => {
    if (findings.length >= 500) { truncated = true; return; }
    findings.push({ id: `${code}:${node?.id ?? 'workflow'}:${property}:${findings.length}`, code, severity, nodeId: node?.id,
      activity: node?.data.label || node?.data.activityId || 'Workflow', property, message, recommendation });
  };
  const nodes = source.nodes.slice(0, 2000), byId = new Map(nodes.map((n) => [n.id, n]));
  const withinScope = (node: Node<WorkflowNodeData>) => { const seen = new Set<string>(); let parent = node.data.parentId; while (parent && !seen.has(parent)) { seen.add(parent); const ancestor = byId.get(parent); if (ancestor?.data.activityId === 'transaction-scope') return true; parent = ancestor?.data.parentId; } return false; };
  if (source.nodes.length > nodes.length) { truncated = true; add('WA001', 'warning', undefined, 'Workflow', 'Only the first 2,000 activities were analyzed.', 'Split the workflow into smaller files before relying on the analysis.'); }
  if (!nodes.length) add('WA002', 'warning', undefined, 'Workflow', 'The workflow has no activities.', 'Add activities before running or testing this workflow.');
  const targets = new Map(source.targets.map((t) => [t.id, t]));
  const value = (node: Node<WorkflowNodeData>, field: string) => {
    const binding = node.data.targetBindings?.[field];
    return binding ? targets.get(binding)?.selector : node.data.properties?.[field] !== undefined ? node.data.properties[field] : getActivity(node.data.activityId)?.properties.find((p) => p.name === field)?.defaultValue;
  };
  const writes = (node: Node<WorkflowNodeData>) => [...(getActivity(node.data.activityId)?.properties ?? []).filter((p) => p.type === 'variable' && outputField(p.name)).map((p) => String(value(node, p.name) ?? '').trim()), ...(node.data.activityId === 'invoke-workflow' && node.data.properties.outArguments && typeof node.data.properties.outArguments === 'object' ? Object.values(node.data.properties.outArguments).filter((v): v is string => typeof v === 'string') : [])].filter((name) => identifier.test(name));
  const possible = new Set(nodes.flatMap(writes));
  const globals = new Set([...source.variables.map((v) => v.name), ...source.arguments.map((a) => a.name)]);
  const loopNames = new Set(nodes.map((n) => n.data.loopVariable?.name).filter(Boolean));
  const used = new Set<string>();
  const ids = new Set<string>();
  const ownership = new Map<string, string[]>();
  for (const node of nodes) {
    if (!node.id || ids.has(node.id)) add('WA101', 'error', node, 'Structure', 'Activity IDs must be nonempty and unique.', 'Repair the duplicate or missing ID in the workflow definition.');
    ids.add(node.id);
    const activity = getActivity(node.data.activityId);
    if (humanActivities.includes(node.data.activityId)) {
      try { validateHumanActivity(node.data.activityId, node.data.properties); } catch (error) { add('WA430', 'error', node, 'Human task', error instanceof Error ? error.message : 'Invalid task.', 'Set the assignee, form and output variable.'); }
      if (node.data.parentId) add('WA431', 'error', node, 'Placement', 'Durable human tasks must be top-level activities in the main workflow.', 'Place approval before queue processing; invoke processing workflows after the wait.');
      add('WA432', 'info', node, 'Execution', 'Run publishes durable approval work through Robot Jobs. Local Debug uses mock decisions.', 'Do not keep credentials or open transaction claims across a wait.');
    }
    if (queueActivities.includes(node.data.activityId)) {
      try { validateQueueActivity(node.data.activityId, node.data.properties); } catch (e) { add('WA410', 'error', node, 'Queue / outputs', e instanceof Error ? e.message : 'Invalid queue activity.', 'Use a static queue name and valid transaction/output variables.'); }
      if (node.data.activityId === 'get-transaction-item' && !nodes.some(n => ['set-transaction-status', 'transaction-scope', 'invoke-workflow'].includes(n.data.activityId))) add('WA411', 'warning', node, 'Transaction result', 'This workflow claims work but has no Set Transaction Status activity.', 'Commit each claimed item. Uncommitted work is released with an Application failure at the end of the run.');
    }
    if (['get-asset', 'get-credential'].includes(node.data.activityId)) {
      try {
        const ref = assetRequirement(node.data.activityId, node.data.properties);
        if (!source.assets?.catalog.profiles.length) add('WA400', 'warning', node, 'Asset name', 'Central assets could not be checked.', 'Connect to Maestro, refresh Assets and analyze again. No protected values are read by Analyzer.');
        else {
          const context = source.assets, profile = context.catalog.profiles.find(p => p.id === context.profileId);
          const asset = context.catalog.assets.find(a => a.profileId === context.profileId && a.name === ref.name);
          if (!profile?.enabled) add('WA401', 'error', node, 'Environment', 'Selected environment is missing or disabled.', 'Choose an enabled environment in Assets.');
          else if (!asset || asset.type !== ref.type) add('WA402', 'error', node, 'Asset name', 'Asset is missing or its type differs in the selected environment.', 'Create the matching asset or correct the activity reference.');
        }
        if (node.data.activityId === 'get-credential' && node.data.properties.usernameOutput === node.data.properties.passwordOutput) add('WA403', 'error', node, 'Outputs', 'Username and password require different output variables.', 'Choose distinct variable names.');
      } catch { add('WA404', 'error', node, 'Asset name', 'Asset reference or type is invalid.', 'Use a static central asset name and a supported type.'); }
    }
    if (!activity) add('WA102', 'error', node, 'Activity', 'This activity is not in the Studio activity registry.', 'Replace it with a supported activity from the Activities panel.');
    if (activity?.isContainer && !node.data.isContainer) add('WA119', 'error', node, 'Structure', 'This control activity is not marked as a container and will not execute its block normally.', 'Restore the activity container flag or recreate the block from Activities.');
    if (['while', 'end'].includes(node.data.activityId) || node.data.activityId.startsWith('outlook-desktop-')) add('WA103', 'warning', node, 'Activity', 'This activity currently falls back to simulated execution in Studio.', 'Do not rely on this activity for real automation until its runtime implementation is available.');
    if (hasWorkflowCall(node)) {
      add('WA300', 'warning', node, 'Workflow File', 'Invoked file and argument declarations need a dependency check.', 'Use Analyze in the desktop app to read and validate this workflow dependency.');
      add('WA305', 'info', node, 'Publishing', 'Publishing includes called workflows and UI targets in a versioned portable package.', 'Prepare the package in Publish and run it with a Robot version that supports portable packages.');
      const outputs = node.data.properties.outArguments;
      if (outputs && typeof outputs === 'object') for (const target of Object.values(outputs)) if (target && (typeof target !== 'string' || !validArgumentName(target))) add('WA302', 'error', node, 'Out arguments', 'An output mapping is not a valid caller variable name.', 'Use a bare variable name without template braces.');
    }
    if (node.data.parentId && !byId.has(node.data.parentId)) add('WA110', 'error', node, 'Parent', 'The parent activity does not exist.', 'Reconnect the activity to an existing container or move it to the root.');
    const seen = new Set([node.id]); let parent = node.data.parentId;
    while (parent && byId.has(parent)) {
      if (seen.has(parent)) { add('WA111', 'error', node, 'Parent', 'The parent hierarchy contains a cycle.', 'Remove the cyclic parent link.'); break; }
      seen.add(parent); parent = byId.get(parent)?.data.parentId;
    }
    const scopeAncestor = [...seen].some(id => id !== node.id && byId.get(id)?.data.activityId === 'transaction-scope');
    if (node.data.activityId === 'transaction-scope') {
      try { validateTransactionScope(node.data.properties); } catch (error) { add('WA420', 'error', node, 'Transaction Scope', error instanceof Error ? error.message : 'Invalid scope.', 'Choose a claimed transaction and distinct output variables.'); }
      if (scopeAncestor) add('WA421', 'error', node, 'Scope nesting', 'Transaction Scopes cannot be nested.', 'Finish the current transaction before starting another scope.');
      if (node.data.branches?.length) add('WA422', 'error', node, 'Structure', 'Transaction Scope uses one processing body.', 'Put activities in its Do block and select an optional recovery workflow in Properties.');
    }
    if (scopeAncestor && ['get-transaction-item', 'set-transaction-status'].includes(node.data.activityId)) add('WA423', 'error', node, 'Transaction ownership', 'Transaction Scope owns the current item and its status.', 'Claim before the scope and let the scope commit its result automatically.');
    if (node.data.isContainer && node.data.parentId && !scopeAncestor && node.data.activityId !== 'transaction-scope') add('WA112', 'error', node, 'Structure', 'Nested containers are not recursively executed by the current Studio engine.', 'Move this block to the root or flatten its activities.');
    const references = [...(node.data.childIds ?? []).map((id) => ({ id, branchId: undefined as string | undefined })), ...(node.data.branches ?? []).flatMap((b) => b.childIds.map((id) => ({ id, branchId: b.id })))];
    const children = new Set<string>();
    for (const ref of references) {
      if (children.has(ref.id)) add('WA113', 'error', node, 'Children', 'A child activity is referenced more than once in this container.', 'Keep the child in only one location.');
      children.add(ref.id);
      const child = byId.get(ref.id);
      if (!child) add('WA114', 'error', node, 'Children', 'A referenced child activity does not exist.', 'Remove the broken child reference or restore the activity.');
      else {
        ownership.set(ref.id, [...(ownership.get(ref.id) ?? []), node.id]);
        if (child.data.parentId !== node.id || (child.data.branchId || undefined) !== ref.branchId) add('WA115', 'error', child, 'Parent / branch', 'The child and its container disagree about ownership.', 'Repair the parent and branch links so both sides identify the same location.');
      }
    }
    if (references.length && !node.data.isContainer) add('WA116', 'error', node, 'Children', 'This activity has children but is not marked as a container.', 'Repair the container definition; these child activities will not be executed normally.');
    const branches = node.data.branches ?? [];
    if (node.data.activityId === 'if') {
      if (branches.filter((b) => b.kind === 'if').length !== 1 || branches[0]?.kind !== 'if' || branches.filter((b) => b.kind === 'else').length > 1 || branches.some((b, i) => b.kind === 'else' && i !== branches.length - 1) || branches.some((b) => !['if', 'elseIf', 'else'].includes(b.kind))) add('WA120', 'error', node, 'Branches', 'IF branches must start with one IF and end with at most one ELSE.', 'Place ELSE IF branches between IF and the optional final ELSE.');
      for (const branch of branches) if (branch.kind !== 'else' && !branch.condition.trim()) add('WA121', 'error', node, 'Condition', 'An IF or ELSE IF branch has no condition.', 'Enter a condition for every conditional branch.');
    }
    if (node.data.activityId === 'try-catch' && (branches.filter((b) => b.kind === 'try').length !== 1 || branches.filter((b) => b.kind === 'finally').length > 1 || branches.some((b) => !['try', 'catch', 'finally'].includes(b.kind)))) add('WA122', 'error', node, 'Branches', 'Try Catch needs one TRY and at most one FINALLY branch.', 'Repair the TRY / CATCH / FINALLY branch structure.');
    if (new Set(branches.map((b) => b.id)).size !== branches.length) add('WA123', 'error', node, 'Branches', 'Branch IDs must be unique within an activity.', 'Assign each branch a unique ID.');
    if (node.data.isContainer && !references.length) add('WA124', 'warning', node, 'Children', 'This container has no child activities.', 'Add the intended activities or remove the unused block.');
    if (node.data.activityId === 'for-each' && !identifier.test(node.data.loopVariable?.name ?? '')) add('WA125', 'error', node, 'Loop variable', 'For Each needs a valid loop variable.', 'Select a collection and give the loop item a valid variable name.');
    if (['break', 'continue'].includes(node.data.activityId) && byId.get(node.data.parentId ?? '')?.data.activityId !== 'for-each') add('WA126', 'error', node, 'Parent', 'Break and Continue must be direct children of For Each in this engine.', 'Move the activity into a For Each body.');
    if (node.data.activityId === 'use-app-browser') {
      if (node.data.properties?.targetType === 'desktop' && blank(value(node, 'windowTitle'))) add('WA130', 'error', node, 'Window Title', 'No desktop application window has been indicated.', 'Indicate an application or set its window title.');
      else if (blank(value(node, 'url')) && blank(value(node, 'windowTitle'))) add('WA131', 'warning', node, 'Application target', 'No application URL or window title is configured.', 'Indicate the intended application or provide its URL.');
    }
    for (const [field, id] of Object.entries(node.data.targetBindings ?? {})) if (!targets.has(id) || blank(targets.get(id)?.selector)) add('WA140', 'error', node, field, 'The bound UI target is missing or has an empty selector.', 'Reconnect this property to an existing entry in UI Targets.');
    for (const prop of activity?.properties ?? []) {
      const current = value(node, prop.name);
      const desktopUrl = prop.name === 'url' && node.data.properties?.targetType === 'desktop' && ['use-app-browser', 'open-browser'].includes(node.data.activityId);
      if (prop.required && !desktopUrl && blank(current) && !node.data.targetBindings?.[prop.name]) add('WA150', 'error', node, prop.label, 'A required property is empty.', `Configure ${prop.label} in Properties.`);
      if (blank(current)) continue;
      const dynamic = typeof current === 'string' && current.includes('{{');
      if (prop.type === 'number' && !dynamic && (!['string', 'number'].includes(typeof current) || !Number.isFinite(Number(current)) || Number(current) < 0)) add('WA151', 'error', node, prop.label, 'This numeric property must be a finite nonnegative number.', 'Enter a valid number or a variable template.');
      if (prop.name === 'maxRetries' && !dynamic && !Number.isSafeInteger(Number(current))) add('WA152', 'error', node, prop.label, 'Retry count must be a whole number.', 'Use a nonnegative whole number.');
      if (prop.type === 'select' && !dynamic && prop.options && !prop.options.some((o) => o.value === current)) add('WA153', 'error', node, prop.label, 'The selected option is not supported.', 'Choose one of the options offered in Properties.');
      if (prop.type === 'variable' && (typeof current !== 'string' || !identifier.test(outputField(prop.name) ? current.trim() : variableName(current)))) add('WA154', 'error', node, prop.label, 'This property needs a variable name, not an expression or literal.', 'Use letters, digits and underscores, starting with a letter or underscore. Output names must not use template braces.');
    }
  }
  for (const node of nodes) {
    if (node.data.parentId && byId.has(node.data.parentId) && !ownership.has(node.id)) add('WA117', 'error', node, 'Parent', 'The parent does not list this child, so it will be skipped.', 'Reconnect the activity to its parent child list.');
    if ((ownership.get(node.id)?.length ?? 0) > 1) add('WA118', 'error', node, 'Parent', 'Multiple containers reference this activity.', 'Keep one owning container and remove the other references.');
  }
  for (const edge of source.edges) if (!byId.has(edge.source) || !byId.has(edge.target)) add('WA160', 'error', byId.get(edge.source) ?? byId.get(edge.target), 'Connection', 'A connection points to a missing activity.', 'Remove the broken connection or restore its endpoint.');
  if (source.edges.length) add('WA161', 'info', undefined, 'Connections', 'Studio executes root activities in canvas list order; graph connections do not change that order.', 'Arrange activities in the intended sequence on the canvas.');
  const names = new Map<string, Set<string>>();
  for (const variable of source.variables) {
    if (!identifier.test(variable.name)) add('WA200', 'error', undefined, 'Variables', `Variable "${variable.name}" has an invalid name.`, 'Rename it in Data Manager using letters, digits and underscores.');
    const scopes = names.get(variable.name) ?? new Set();
    if (scopes.size) add('WA201', scopes.has(variable.scope) ? 'error' : 'warning', undefined, 'Variables', `Variable "${variable.name}" is declared more than once.`, 'Use distinct names; the local executor stores declared variables by name.');
    scopes.add(variable.scope); names.set(variable.name, scopes);
  }
  const argumentNames = new Set<string>();
  for (const argument of source.arguments) {
    if (!identifier.test(argument.name) || argumentNames.has(argument.name)) add('WA202', 'error', undefined, 'Arguments', `Argument "${argument.name}" has an invalid or duplicate name.`, 'Rename conflicting or invalid arguments in Data Manager.');
    if (source.variables.some((v) => v.name === argument.name)) add('WA203', 'error', undefined, 'Arguments', `A variable and an argument share the name "${argument.name}".`, 'Use distinct names to avoid ambiguous references.');
    argumentNames.add(argument.name);
  }
  try { validateArguments(source.arguments, source.variables); } catch (error) { add('WA204', 'error', undefined, 'Arguments', error instanceof Error ? error.message : 'Invalid argument declaration.', 'Use supported JSON-compatible argument types and distinct names.'); }
  const reference = (name: string, node: Node<WorkflowNodeData>, field: string, available: Set<string>, local: Set<string>, uncertain = false) => {
    used.add(name);
    if (available.has(name) || local.has(name)) return;
    if (possible.has(name)) add('WA205', 'warning', node, field, `Output "${name}" may be read before it is produced or on a path that does not assign it.`, 'Initialize it in Data Manager or assign it on every path before this activity.');
    else if (loopNames.has(name)) add('WA206', 'error', node, field, `Loop variable "${name}" is referenced outside its loop body.`, 'Move the activity into the loop or copy the item to a declared variable.');
    else add('WA207', uncertain ? 'warning' : 'error', node, field, `No declared variable or known output produces "${name}".`, uncertain ? 'Check the variable spelling. Quote the message if it is intended as literal text.' : 'Declare the variable or correct its name; otherwise the template will remain unresolved.');
  };
  const visited = new Set<string>();
  const check = (node: Node<WorkflowNodeData>, available: Set<string>, local: Set<string>) => {
    const props = getActivity(node.data.activityId)?.properties ?? [];
    if (hasWorkflowCall(node) && node.data.properties.inArguments && typeof node.data.properties.inArguments === 'object') {
      const callValues = node.data.activityId === 'transaction-scope' ? new Set([...available, ...writes(node)]) : available;
      for (const item of Object.values(node.data.properties.inArguments)) if (typeof item === 'string') for (const name of new Set([...item.matchAll(/\{\{\s*([A-Za-z_]\w*)[^{}]*\}\}/g)].map((match) => match[1]))) reference(name, node, 'In arguments', callValues, local);
    }
    for (const prop of props) {
      const current = value(node, prop.name);
      if (prop.type === 'variable') {
        if (!outputField(prop.name) && prop.name !== 'exception' && !blank(current) && identifier.test(variableName(current))) reference(variableName(current), node, prop.label, available, local);
        continue;
      }
      if (typeof current !== 'string') continue;
      if (node.data.activityId === 'log-message' && prop.name === 'message' && /^(?:"[\s\S]*"|'[\s\S]*')$/.test(current.trim())) continue;
      const templates = [...current.matchAll(/\{\{\s*([A-Za-z_]\w*)(?:\.[A-Za-z_]\w*(?:\(\))?)?\s*\}\}/g)];
      for (const name of new Set(templates.map((match) => match[1]))) reference(name, node, prop.label, available, local);
      if (prop.type !== 'code' && current.replace(/\{\{\s*([A-Za-z_]\w*)(?:\.[A-Za-z_]\w*(?:\(\))?)?\s*\}\}/g, '').includes('{{')) add('WA209', 'warning', node, prop.label, 'A variable template uses unrecognized syntax.', 'Use {{variable}} or a supported member such as {{variable.Length}}. Other expression syntax is not validated.');
      if (node.data.activityId === 'log-message' && prop.name === 'message') {
        const bare = current.trim().match(/^([A-Za-z_]\w*)(?:\.[A-Za-z_]\w*(?:\(\))?)?$/);
        if (bare) reference(bare[1], node, prop.label, available, local, true);
      }
    }
    for (const branch of node.data.branches ?? []) for (const name of new Set([...branch.condition.matchAll(/\{\{\s*([A-Za-z_]\w*)(?:\.[A-Za-z_]\w*(?:\(\))?)?\s*\}\}/g)].map((match) => match[1]))) reference(name, node, 'Branch condition', available, local);
  };
  const walk = (items: Node<WorkflowNodeData>[], initial: Set<string>, local = new Set<string>()): Set<string> => {
    const available = new Set(initial);
    for (const node of items) {
      if (visited.has(node.id)) continue;
      visited.add(node.id); check(node, available, local);
      for (const name of writes(node)) available.add(name);
      const children = (ids: string[]) => ids.map((id) => byId.get(id)).filter((n): n is Node<WorkflowNodeData> => !!n);
      if (!node.data.isContainer || node.data.parentId && !withinScope(node) && node.data.activityId !== 'transaction-scope') continue;
      const branches = node.data.branches ?? [];
      if (node.data.activityId === 'transaction-scope') {
        // A handled failure can skip any later body output; only the scope's own outputs are guaranteed.
        walk(children(node.data.childIds ?? []), available, local);
      } else if (node.data.activityId === 'for-each') {
        const scoped = new Set(local); if (node.data.loopVariable) scoped.add(node.data.loopVariable.name);
        walk(children(node.data.childIds ?? []), available, scoped);
      } else if (node.data.activityId === 'if' || node.data.activityId === 'try-catch') {
        const paths = branches.filter((b) => b.kind !== 'finally').map((b) => walk(children(b.childIds), available, local));
        if (node.data.activityId === 'if' && !branches.some((b) => b.kind === 'else')) paths.push(new Set(available));
        if (paths.length) for (const name of paths[0]) if (paths.every((path) => path.has(name))) available.add(name);
        for (const branch of branches.filter((b) => b.kind === 'finally')) for (const name of walk(children(branch.childIds), available, local)) available.add(name);
      } else for (const name of walk(children(node.data.childIds ?? []), available, local)) available.add(name);
    }
    return available;
  };
  walk(nodes.filter((n) => !n.data.parentId), new Set(globals));
  for (const node of nodes) if (!visited.has(node.id)) check(node, new Set(globals), new Set());
  for (const variable of source.variables) if (identifier.test(variable.name) && !used.has(variable.name)) add('WA208', 'info', undefined, 'Variables', `Variable "${variable.name}" has no detected read reference.`, 'Review unused variables. Script code and external consumers are not analyzed for reads.');
  const order = { error: 0, warning: 1, info: 2 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  return { signature: analysisSignature(source), projectName: source.projectName, analyzedAt: Date.now(), findings, truncated };
}
