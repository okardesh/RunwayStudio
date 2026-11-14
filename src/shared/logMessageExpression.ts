import { evaluateWatchExpression } from '../engine/watchExpressions';

function memberValue(value: unknown, member?: string): unknown {
  if (!member) return value;
  const text = String(value ?? '');
  switch (member) {
    case 'Length': return text.length;
    case 'ToLower()': return text.toLowerCase();
    case 'ToUpper()': return text.toUpperCase();
    case 'Trim()': return text.trim();
    case 'ToString()': return text;
    default: return undefined;
  }
}

/** Resolve message expressions without evaluating code or changing output variable names. */
export function resolveLogMessage(message: unknown, values: Record<string, unknown>): string {
  if (typeof message !== 'string') return String(message ?? '');
  const expression = message.trim();
  // Quoting explicitly requests literal text, even if it matches a variable name.
  if (expression.startsWith('"') && expression.endsWith('"')) {
    try { const literal = JSON.parse(expression); if (typeof literal === 'string') return literal; } catch { /* Preserve malformed literals. */ }
  }
  if (expression.length >= 2 && expression.startsWith("'") && expression.endsWith("'")) {
    return expression.slice(1, -1).replace(/\\(['\\])/g, '$1');
  }
  const hasValue = (name: string) => Object.prototype.hasOwnProperty.call(values, name);
  const reference = expression.match(/^([A-Za-z_]\w*)(?:\.([A-Za-z_]\w*(?:\(\))?))?$/);
  if (reference && hasValue(reference[1])) {
    const value = memberValue(values[reference[1]], reference[2]);
    if (value !== undefined || !reference[2]) return String(value ?? '');
  }
  if (/^[A-Za-z_]\w*(?:\.|\[)/.test(expression)) {
    const result = evaluateWatchExpression(expression, values);
    if (!result.error) return typeof result.value === 'object' && result.value !== null ? JSON.stringify(result.value) : String(result.value ?? '');
  }
  // One pass prevents braces contained in extracted text from being evaluated again.
  return message.replace(/\{\{\s*([^{}]+?)\s*\}\}(?:\.([A-Za-z_]\w*(?:\(\))?))?/g,
    (match, expression: string, outsideMember?: string) => {
      const legacy = expression.match(/^([A-Za-z_]\w*)(?:\.([A-Za-z_]\w*(?:\(\))?))?$/);
      if (!legacy) { const result = evaluateWatchExpression(expression, values); return result.error ? match : typeof result.value === 'object' && result.value !== null ? JSON.stringify(result.value) : String(result.value ?? ''); }
      const [, name, insideMember] = legacy;
      if (!hasValue(name)) return match;
      const value = memberValue(values[name], outsideMember ?? insideMember);
      if (value !== undefined || !insideMember && !outsideMember) return String(value ?? '');
      const result = evaluateWatchExpression(expression, values);
      return result.error || outsideMember ? match : typeof result.value === 'object' && result.value !== null ? JSON.stringify(result.value) : String(result.value ?? '');
    });
}
