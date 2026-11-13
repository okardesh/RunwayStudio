import { evaluateWatchExpression, debugValue, sensitiveName } from '../engine/watchExpressions';

export interface TestRow { id: string; name: string; inputs: Record<string, unknown>; expected: Record<string, unknown> }
export interface WorkflowTest { id: string; workflowKey: string; name: string; rows: TestRow[] }
export interface TestAssertion { expression: string; passed: boolean; expected: string; actual: string; error?: string }
export interface TestRunResult { testId: string; testName: string; rowName: string; batchId: string; status: 'running' | 'passed' | 'failed' | 'error' | 'stopped'; assertions: TestAssertion[] }
export interface TestExecution { testId: string; testName: string; rowName: string; batchId: string; expected: Record<string, unknown> }
export const testWorkflowKey = (filePath: string | null, projectName: string) => filePath ? `file:${filePath.replace(/\\/g, '/').toLowerCase()}` : `draft:${projectName}`;

export function parseTestObject(text: string): Record<string, unknown> {
  if (text.length > 12000) throw Error('Each JSON field is limited to 12,000 characters.');
  const value = JSON.parse(text);
  if (!value || Array.isArray(value) || typeof value !== 'object') throw Error('Enter a JSON object.');
  const pending = [{ value, depth: 0 }]; let count = 0;
  while (pending.length) {
    const item = pending.pop()!;
    if (++count > 1200 || item.depth > 12) throw Error('Test data is too large or too deeply nested.');
    if (typeof item.value === 'number' && !Number.isFinite(item.value)) throw Error('Use finite JSON numbers.');
    if (item.value && typeof item.value === 'object') for (const next of Object.values(item.value)) pending.push({ value: next, depth: item.depth + 1 });
  }
  return value;
}
export function validateTest(test: WorkflowTest) {
  if (!test.id || !test.workflowKey || !test.name.trim() || test.name.length > 100) throw Error('Give the test a name of 1–100 characters.');
  if (!test.rows.length || test.rows.length > 20) throw Error('A test needs 1–20 data rows.');
  const ids = new Set<string>();
  for (const row of test.rows) {
    if (!row.id || ids.has(row.id) || !row.name.trim() || row.name.length > 100) throw Error('Each data row needs a unique ID and a name of 1–100 characters.');
    ids.add(row.id);
    parseTestObject(JSON.stringify(row.inputs)); parseTestObject(JSON.stringify(row.expected));
    const expressions = Object.keys(row.expected);
    if (!expressions.length || expressions.length > 30 || expressions.some((e) => !e.trim() || e.length > 200)) throw Error('Define 1–30 expected values using variable names or Watch expressions.');
  }
}
function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) { if (a.length !== (b as unknown[]).length) return false; }
  else if (Object.getPrototypeOf(b) !== Object.prototype && Object.getPrototypeOf(b) !== null) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => {
    const left = Object.getOwnPropertyDescriptor(a, key), right = Object.getOwnPropertyDescriptor(b, key);
    return left && right && 'value' in left && 'value' in right && equal(left.value, right.value);
  });
}
export function assertTestValues(expected: Record<string, unknown>, values: Record<string, unknown>, secrets: string[]): TestAssertion[] {
  return Object.entries(expected).map(([expression, wanted]) => {
    const result = evaluateWatchExpression(expression, values);
    const masked = sensitiveName.test(expression);
    let passed = false, error = result.error;
    try { passed = !error && equal(wanted, result.value); } catch { error = 'Value could not be compared.'; }
    return { expression, passed, expected: debugValue(wanted, secrets, masked).detail, actual: error ? 'Unavailable' : debugValue(result.value, secrets, masked).detail, ...(error ? { error } : {}) };
  });
}
