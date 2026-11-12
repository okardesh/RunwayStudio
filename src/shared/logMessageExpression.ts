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
  // One pass prevents braces contained in extracted text from being evaluated again.
  return message.replace(/\{\{\s*([A-Za-z_]\w*)(?:\.([A-Za-z_]\w*(?:\(\))?))?\s*\}\}(?:\.([A-Za-z_]\w*(?:\(\))?))?/g,
    (match, name: string, insideMember?: string, outsideMember?: string) => {
      if (!hasValue(name)) return match;
      const value = memberValue(values[name], outsideMember ?? insideMember);
      return value === undefined && (insideMember || outsideMember) ? match : String(value ?? '');
    });
}
