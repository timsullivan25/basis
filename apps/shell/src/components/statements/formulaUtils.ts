const OPERATORS = new Set(['+', '-', '*', '/', '^', '(', ')', ',']);

/** Functions a formula may call without them being flagged as unknown line references. */
const KNOWN_FUNCTIONS = new Set(['sum', 'min', 'max', 'avg', 'average', 'abs']);

/**
 * The identifier segment surrounding `cursorPos` — bounded by operators, not whitespace,
 * since line names can contain spaces (e.g. "Net Income").
 */
export function getFormulaSegment(value: string, cursorPos: number): { start: number; end: number; word: string } {
  let start = cursorPos;
  while (start > 0 && !OPERATORS.has(value[start - 1])) start--;
  let end = cursorPos;
  while (end < value.length && !OPERATORS.has(value[end])) end++;
  const raw = value.slice(start, end);
  const leadingSpace = raw.length - raw.trimStart().length;
  return { start: start + leadingSpace, end, word: raw.trim() };
}

/** All non-numeric, non-operator tokens in a formula — the identifiers it references. */
export function getFormulaTokens(formula: string): string[] {
  const tokens: string[] = [];
  let current = '';
  for (const char of formula) {
    if (OPERATORS.has(char)) {
      if (current.trim()) tokens.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim()) tokens.push(current.trim());
  return tokens;
}

/** Unknown-line errors for a formula, given the set of valid line names in the schema. */
export function validateFormula(formula: string, knownNames: string[]): string[] {
  if (!formula.trim()) return [];
  const knownLower = new Set(knownNames.map((n) => n.toLowerCase()));
  const errors: string[] = [];
  for (const token of getFormulaTokens(formula)) {
    if (!token) continue;
    if (/^-?\d+(\.\d+)?$/.test(token)) continue;
    if (KNOWN_FUNCTIONS.has(token.toLowerCase())) continue;
    if (!knownLower.has(token.toLowerCase())) errors.push(token);
  }
  if (errors.length === 0) return [];
  return [`Unknown line${errors.length > 1 ? 's' : ''}: ${errors.join(', ')}`];
}
