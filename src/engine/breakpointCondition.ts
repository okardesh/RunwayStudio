import { evaluateWatchExpression } from './watchExpressions';

/** A single comparison or Boolean watch expression, with no eval or coercion. */
export function evaluateBreakpointCondition(expression: string, values: Record<string, unknown>): { value?: boolean; error?: string } {
  try {
    const text = expression.trim();
    if (!text || text.length > 200) throw Error('Use a condition of 1–200 characters.');
    let quote = '', escaped = false, brackets = 0, comparison: { index: number; operator: string } | undefined;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (quote) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === quote) quote = ''; continue; }
      if (char === '"' || char === "'") { quote = char; continue; }
      if (char === '[') brackets++;
      if (char === ']') brackets--;
      if (!brackets) {
        const operator = text.slice(i).match(/^(===|!==|==|!=|>=|<=|>|<)/)?.[0];
        if (operator) { if (comparison) throw Error('Use one comparison per condition.'); comparison = { index: i, operator }; i += operator.length - 1; }
      }
    }
    const read = (source: string) => { const result = evaluateWatchExpression(source, values); if (result.error) throw Error(result.error); return result.value; };
    if (!comparison) { const value = read(text); if (typeof value !== 'boolean') throw Error('The condition must return a Boolean.'); return { value }; }
    const { index, operator } = comparison;
    const left = read(text.slice(0, index)), right = read(text.slice(index + operator.length));
    if (left !== null && !['string', 'number', 'boolean', 'undefined'].includes(typeof left) || right !== null && !['string', 'number', 'boolean', 'undefined'].includes(typeof right)) throw Error('Compare primitive values only.');
    if (operator === '==' || operator === '===') return { value: left === right };
    if (operator === '!=' || operator === '!==') return { value: left !== right };
    if (typeof left !== typeof right || !['number', 'string'].includes(typeof left) || typeof left === 'number' && (!Number.isFinite(left) || !Number.isFinite(right))) throw Error('Ordering requires two finite numbers or two strings of the same type.');
    const a = left as number, b = right as number;
    return { value: operator === '>' ? a > b : operator === '<' ? a < b : operator === '>=' ? a >= b : a <= b };
  } catch (reason) { return { error: reason instanceof Error ? reason.message : 'Cannot evaluate breakpoint condition.' }; }
}
