const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
const own = (value: unknown, key: string) => value != null && Object.prototype.hasOwnProperty.call(value, key);

/** Read-only watch grammar. No eval, function calls from objects, or assignments. */
export function evaluateWatchExpression(expression: string, values: Record<string, unknown>): { value?: unknown; error?: string } {
  try {
    let text = expression.trim().replace(/^\{\{\s*([^{}]+?)\s*\}\}/, '$1');
    if (!text || text.length > 200) throw Error('Enter an expression of 1–200 characters.');
    if (/^(?:true|false|null|-?\d+(?:\.\d+)?)$/.test(text) || /^"(?:[^"\\]|\\.)*"$/.test(text)) return { value: JSON.parse(text) };
    const root = text.match(/^([A-Za-z_]\w*)/);
    if (!root) throw Error('Use a variable, property, index, or supported string method.');
    if (!own(values, root[1])) throw Error(`Not in scope: ${root[1]}`);
    const rootDescriptor = Object.getOwnPropertyDescriptor(values, root[1]);
    if (!rootDescriptor || !('value' in rootDescriptor)) throw Error('Accessor properties are not evaluated.');
    let value = rootDescriptor.value;
    text = text.slice(root[0].length);
    while (text.trim()) {
      text = text.trimStart();
      const member = text.match(/^\.\s*([A-Za-z_]\w*)(\(\s*\))?/);
      const index = text.match(/^\[\s*(\d+|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*\]/);
      if (!member && !index) throw Error('Unsupported expression. Calls with arguments and operators are not supported.');
      const key = member ? member[1] : index![1].startsWith('"') ? JSON.parse(index![1]) : index![1].startsWith("'") ? index![1].slice(1, -1).replace(/\\'/g, "'") : index![1];
      if (forbidden.has(key)) throw Error('This property cannot be inspected.');
      if (value == null) throw Error(`Cannot read ${key} from ${value === null ? 'null' : 'undefined'}.`);
      if (member?.[2]) {
        if (key === 'ToString' && ['string', 'number', 'boolean', 'bigint'].includes(typeof value)) value = String(value);
        else if (key === 'ToString') throw Error('ToString() supports primitive values only.');
        else if (typeof value !== 'string') throw Error(`${key}() requires a String.`);
        else if (key === 'Trim') value = value.trim();
        else if (key === 'ToLower') value = value.toLowerCase();
        else if (key === 'ToUpper') value = value.toUpperCase();
        else throw Error(`Unsupported method: ${key}()`);
      } else if ((key === 'Length' || key === 'length') && (typeof value === 'string' || Array.isArray(value))) value = value.length;
      else if (key === 'Count' && Array.isArray(value)) value = value.length;
      else if (own(value, key)) {
        const descriptor = Object.getOwnPropertyDescriptor(Object(value), key);
        if (!descriptor || !('value' in descriptor)) throw Error('Accessor properties are not evaluated.');
        value = descriptor.value;
      } else throw Error(`Property or index not found: ${key}`);
      text = text.slice((member ?? index)![0].length);
    }
    return { value };
  } catch (reason) { return { error: reason instanceof Error ? reason.message : 'Cannot evaluate this expression.' }; }
}

export interface DebugValue { type: string; preview: string; detail: string; truncated: boolean; redacted: boolean }
export const sensitiveName = /password|secret|token|api.?key|credential|authorization/i;
export function debugValue(value: unknown, secrets: string[] = [], redact = false): DebugValue {
  const type = value === null ? 'Null' : value === undefined ? 'Undefined' : Array.isArray(value) ? `Array (${value.length})` : typeof value === 'string' ? 'String' : typeof value === 'number' ? 'Number' : typeof value === 'boolean' ? 'Boolean' : value instanceof Date ? 'DateTime' : typeof value === 'object' ? 'Object' : typeof value;
  if (redact) return { type, preview: '[REDACTED]', detail: '[REDACTED]', truncated: false, redacted: true };
  let budget = 8000, truncated = false;
  const copy = (raw: unknown, depth = 0): unknown => {
    if (depth > 4 || budget <= 0) { truncated = true; return '[Preview limit]'; }
    if (typeof raw === 'string') {
      let text = raw; for (const secret of secrets) if (secret) text = text.split(secret).join('[REDACTED]');
      const limit = Math.min(4000, budget); budget -= Math.min(text.length, limit);
      if (text.length > limit) { truncated = true; return text.slice(0, limit) + '…'; } return text;
    }
    if (raw == null || typeof raw === 'number' || typeof raw === 'boolean') { budget -= 8; return raw; }
    if (typeof raw === 'bigint') return String(raw);
    if (raw instanceof Date) return Number.isNaN(Date.prototype.getTime.call(raw)) ? 'Invalid Date' : Date.prototype.toISOString.call(raw);
    if (typeof raw !== 'object') return `[${typeof raw}]`;
    const keys = Object.keys(raw); if (keys.length > 30) truncated = true;
    const result: Record<string, unknown> | unknown[] = Array.isArray(raw) ? [] : {};
    for (const key of keys.slice(0, 30)) {
      if (budget <= 0) { truncated = true; break; }
      budget -= key.length + 4;
      const descriptor = Object.getOwnPropertyDescriptor(raw, key);
      const next = sensitiveName.test(key) ? '[REDACTED]' : descriptor && 'value' in descriptor ? copy(descriptor.value, depth + 1) : '[Accessor not evaluated]';
      Object.defineProperty(result, key, { value: next, enumerable: true, configurable: true, writable: true });
    }
    return result;
  };
  const copied = copy(value);
  const detail = typeof copied === 'string' ? copied : JSON.stringify(copied, null, 2) ?? 'undefined';
  return { type, preview: detail.length > 140 ? detail.slice(0, 140).replace(/\s+/g, ' ') + '…' : detail, detail, truncated, redacted: false };
}
