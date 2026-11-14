import { cloneArgument, resolveArgumentInput, validArgumentName } from './invokedWorkflows';
export const humanActivities = ['create-human-task', 'wait-for-human-task'];
export interface HumanTaskEvent { taskId: string; phase: string; at: number; decision?: string; actor?: string }
export interface HumanCheckpoint { id: string; taskId: string; nodeId: string; cursor: number; output: string; values: Record<string, unknown>; packageId: string }
export interface HumanResume { checkpointId: string; cursor: number; output: string; values: Record<string, unknown>; result: Record<string, unknown>; packageId: string }
export class HumanTaskSuspended extends Error { calls?: Array<{name: string; depth: number; status: string}>; constructor(public checkpoint: HumanCheckpoint) { super('Waiting for human response.'); this.name = 'HumanTaskSuspended'; } }
export function safeHumanData(value: unknown, secrets: string[] = []) {
  const copy = cloneArgument(value);
  const inspect = (v: unknown, key = '') => {
    if (v !== null && v !== '' && /password|secret|token|credential|authorization|api.?key/i.test(key)) throw Error('Protected fields cannot be persisted for a human task. Clear them before waiting and read credentials after approval.');
    if (typeof v === 'string' && secrets.some(s => s && v.includes(s))) throw Error('Protected values cannot be persisted for a human task.');
    if (v && typeof v === 'object') for (const [k, next] of Object.entries(v)) inspect(next, k);
  }; inspect(copy); return copy;
}
export function taskSchema(raw: unknown): Array<{name: string; label: string; type: string; required: boolean}> {
  const schema = typeof raw === 'string' ? JSON.parse(raw || '[]') : raw ?? [];
  if (!Array.isArray(schema) || schema.length > 20) throw Error('Form schema must be an array of at most 20 fields.');
  const names = new Set<string>();
  for (const f of schema) { if (!f || !validArgumentName(f.name) || names.has(f.name) || !['String','Number','Boolean'].includes(f.type) || typeof f.label !== 'string' || f.label.length > 120 || typeof f.required !== 'boolean') throw Error('Form fields need a unique name, label, String/Number/Boolean type and required flag.'); names.add(f.name); }
  safeHumanData(schema); return schema;
}
export function validateHumanActivity(id: string, p: Record<string, unknown>) {
  if (!validArgumentName(String(p.output ?? ''))) throw Error('Choose a valid human task output variable.');
  if (id === 'create-human-task') {
    if (typeof p.title !== 'string' || !p.title.trim()) throw Error('Human task title is required.');
    if (!/^(user|role):[A-Za-z_][A-Za-z0-9_.-]{0,79}$/.test(String(p.assignee))) throw Error('Choose a static assignee such as user:onur or role:finance.');
    const timeout = Number(p.timeoutMinutes ?? 1440); if (!Number.isInteger(timeout) || timeout < 1 || timeout > 10080) throw Error('Task timeout must be 1–10,080 minutes.');
    taskSchema(p.formSchema);
  } else if (typeof p.task !== 'string' || !p.task.trim()) throw Error('Wait requires a task from Create Human Task.');
}
export function validateHumanPlacement(definitions: Array<{nodes: Array<{data: {activityId: string; parentId?: string}}> }>) {
  definitions.forEach((d, index) => { for (const n of d.nodes) if (humanActivities.includes(n.data.activityId) && (index !== 0 || n.data.parentId)) throw Error('Human tasks and durable waits must be top-level activities in the main workflow. Call processing workflows after the wait.'); });
}
const resolve = (raw: unknown, values: Record<string, unknown>) => typeof raw === 'string' && Object.prototype.hasOwnProperty.call(values, raw.trim()) ? values[raw.trim()] : resolveArgumentInput(raw, values).value;
export async function createHumanTask(nodeId: string, p: Record<string, unknown>, values: Record<string, unknown>, secrets: string[], send?: (data: Record<string, unknown>) => Promise<any>) {
  validateHumanActivity('create-human-task', p);
  let context = resolve(p.context ?? '{}', values); if (typeof context === 'string') context = JSON.parse(context);
  const data = safeHumanData({ nodeId, title: String(resolve(p.title, values)), assignee: p.assignee, timeoutMinutes: Number(p.timeoutMinutes ?? 1440), formSchema: taskSchema(p.formSchema), context }, secrets) as Record<string, unknown>;
  const task = send ? await send(data) : { id: 'mock_' + nodeId, title: data.title, status: 'Pending', formSchema: data.formSchema };
  values[String(p.output)] = cloneArgument(task); return task;
}
export function mockHumanResponse(p: Record<string, unknown>, values: Record<string, unknown>) {
  validateHumanActivity('wait-for-human-task', p);
  const task = resolve(p.task, values) as {id?: string; formSchema?: unknown}; if (!task?.id?.startsWith('mock_')) throw Error('Debug waits require a mocked Create Human Task output.');
  const decision = String(p.debugDecision ?? 'Approved'); if (!['Approved','Rejected','TimedOut'].includes(decision)) throw Error('Choose a valid mock decision.');
  const fields = typeof p.debugFields === 'string' ? JSON.parse(p.debugFields || '{}') : p.debugFields ?? {};
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) throw Error('Debug form fields must be a JSON object.');
  const schema = taskSchema(task.formSchema);
  if (Object.keys(fields).some(k => !schema.some(f => f.name === k))) throw Error('Unknown Debug form field.');
  for (const f of schema) {
    const v = (fields as Record<string, unknown>)[f.name];
    if (v === undefined || v === null || v === '') { if (decision === 'Approved' && f.required) throw Error('Required Debug form field: ' + f.label); }
    else if (typeof v !== (f.type === 'Number' ? 'number' : f.type === 'Boolean' ? 'boolean' : 'string')) throw Error('Incorrect Debug form field type: ' + f.label);
  }
  safeHumanData(fields);
  values[String(p.output)] = { taskId: task.id, decision, fields, actor: 'Debug mock', completedAt: Date.now() };
  return task.id;
}
export function humanCheckpoint(nodeId: string, cursor: number, p: Record<string, unknown>, values: Record<string, unknown>, secrets: string[], packageId: string): HumanCheckpoint {
  validateHumanActivity('wait-for-human-task', p);
  const task = resolve(p.task, values) as {id?: string}; if (!task || typeof task.id !== 'string') throw Error('Wait requires a task from this job.');
  return { id: crypto.randomUUID(), taskId: task.id, nodeId, cursor, output: String(p.output), values: safeHumanData(values, secrets) as Record<string, unknown>, packageId };
}
