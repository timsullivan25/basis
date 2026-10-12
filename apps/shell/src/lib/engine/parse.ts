const OPERATORS = new Set(['+', '-', '*', '/', '^', '(', ')', ',']);

/** Functions a formula may call without them being flagged as unknown line references. */
const KNOWN_FUNCTIONS = new Set(['sum', 'min', 'max', 'avg', 'average', 'abs', 'priorperiod', 'prioryear']);

/** Canonical fn name for each recognized (lowercased) function keyword — handles the
 *  'average' -> 'avg' alias and normalizes 'priorperiod'/'prioryear' to their camelCase form. */
const FUNCTION_ALIASES: Record<string, 'sum' | 'min' | 'max' | 'avg' | 'abs' | 'priorPeriod' | 'priorYear'> = {
  sum: 'sum',
  min: 'min',
  max: 'max',
  avg: 'avg',
  average: 'avg',
  abs: 'abs',
  priorperiod: 'priorPeriod',
  prioryear: 'priorYear',
};

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /[a-zA-Z0-9_]/.test(ch);
}

function tokenText(t: Token): string {
  return t.kind === 'num' ? String(t.value) : t.text;
}

export type Token =
  | { kind: 'num'; value: number; start: number; end: number }
  | { kind: 'name'; text: string; start: number; end: number }
  | { kind: 'func'; text: string; start: number; end: number }
  | { kind: 'op'; text: '+' | '-' | '*' | '/' | '^' | '(' | ')' | ','; start: number; end: number }
  | { kind: 'unknown'; text: string; start: number; end: number };

/**
 * Tokenizes a formula against the schema's known line names. Unlike a context-free tokenizer,
 * this must know valid names *before* scanning, since names can contain operator characters
 * (e.g. "Stock-Based Compensation", "Interest Expense, Net") — at every position it first tries
 * the longest known name (maximal munch), only falling back to single-char operators, numeric
 * literals, or a bareword scan when nothing matches there.
 */
export function tokenize(formula: string, knownNames: string[]): Token[] {
  const candidates = knownNames
    .map((n) => n.trim())
    .filter(Boolean)
    .map((raw) => ({ raw, lower: raw.toLowerCase(), length: raw.length }))
    .sort((a, b) => b.length - a.length);

  const tokens: Token[] = [];
  let i = 0;
  const n = formula.length;
  while (i < n) {
    if (/\s/.test(formula[i])) {
      i++;
      continue;
    }

    // A name match must end at a word boundary — otherwise a known name that's a prefix of a
    // longer unrelated word (e.g. known name "Tax" inside typo'd "Taxes") would wrongly match.
    const match = candidates.find(
      (c) =>
        i + c.length <= n &&
        formula.slice(i, i + c.length).toLowerCase() === c.lower &&
        !isWordChar(formula[i + c.length]),
    );
    if (match) {
      tokens.push({ kind: 'name', text: match.raw, start: i, end: i + match.length });
      i += match.length;
      continue;
    }

    const ch = formula[i];
    if (OPERATORS.has(ch)) {
      tokens.push({ kind: 'op', text: ch as '+' | '-' | '*' | '/' | '^' | '(' | ')' | ',', start: i, end: i + 1 });
      i++;
      continue;
    }

    const numMatch = /^\d+(\.\d+)?/.exec(formula.slice(i));
    if (numMatch) {
      tokens.push({ kind: 'num', value: Number(numMatch[0]), start: i, end: i + numMatch[0].length });
      i += numMatch[0].length;
      continue;
    }

    // Bareword: bounded by operators only (not whitespace), so an unmatched multi-word phrase
    // (e.g. a typo'd line name) still surfaces as one token, not several.
    let j = i;
    while (j < n && !OPERATORS.has(formula[j])) j++;
    const raw = formula.slice(i, j);
    const word = raw.trim();
    if (word) {
      const leadingSpace = raw.length - raw.trimStart().length;
      const kind = KNOWN_FUNCTIONS.has(word.toLowerCase()) ? 'func' : 'unknown';
      tokens.push({ kind, text: word, start: i + leadingSpace, end: i + leadingSpace + word.length });
    }
    i = j;
  }
  return tokens;
}

export type FormulaAst =
  | { kind: 'num'; value: number }
  | { kind: 'ref'; name: string }
  | { kind: 'neg'; arg: FormulaAst }
  | { kind: 'bin'; op: '+' | '-' | '*' | '/' | '^'; left: FormulaAst; right: FormulaAst }
  | { kind: 'call'; fn: 'sum' | 'min' | 'max' | 'avg' | 'abs' | 'priorPeriod' | 'priorYear'; args: FormulaAst[] };

export type ParseResult = { ok: true; ast: FormulaAst } | { ok: false; errors: string[] };

class ParseError extends Error {}

/**
 * Recursive-descent parser over the token stream:
 *   expr    := term (('+'|'-') term)*
 *   term    := power (('*'|'/') power)*
 *   power   := unary ('^' power)?        // right-associative
 *   unary   := '-' unary | primary
 *   primary := NUMBER | NAME | FUNC '(' argList ')' | '(' expr ')'
 *   argList := expr (',' expr)*
 *
 * Unknown-name errors take priority over syntax errors, matching the old validator's UX —
 * "Unknown line: X" is more actionable than a parenthesis-balance complaint.
 */
export function parseFormula(formula: string, knownNames: string[]): ParseResult {
  if (!formula.trim()) return { ok: false, errors: [] };

  const tokens = tokenize(formula, knownNames);

  const unknownTokens = tokens.filter((t) => t.kind === 'unknown');
  if (unknownTokens.length > 0) {
    const names = [...new Set(unknownTokens.map((t) => t.text))];
    return { ok: false, errors: [`Unknown line${names.length > 1 ? 's' : ''}: ${names.join(', ')}`] };
  }

  let pos = 0;
  const peek = () => tokens[pos];
  const advance = () => tokens[pos++];
  const atOp = (text: string) => {
    const t = peek();
    return Boolean(t && t.kind === 'op' && t.text === text);
  };

  function parseExpr(): FormulaAst {
    let left = parseTerm();
    while (atOp('+') || atOp('-')) {
      const op = advance() as Token & { kind: 'op' };
      left = { kind: 'bin', op: op.text as '+' | '-', left, right: parseTerm() };
    }
    return left;
  }

  function parseTerm(): FormulaAst {
    let left = parsePower();
    while (atOp('*') || atOp('/')) {
      const op = advance() as Token & { kind: 'op' };
      left = { kind: 'bin', op: op.text as '*' | '/', left, right: parsePower() };
    }
    return left;
  }

  function parsePower(): FormulaAst {
    const base = parseUnary();
    if (atOp('^')) {
      advance();
      return { kind: 'bin', op: '^', left: base, right: parsePower() };
    }
    return base;
  }

  function parseUnary(): FormulaAst {
    if (atOp('-')) {
      advance();
      return { kind: 'neg', arg: parseUnary() };
    }
    return parsePrimary();
  }

  function parsePrimary(): FormulaAst {
    const t = peek();
    if (!t) throw new ParseError('Unexpected end of formula');

    if (t.kind === 'num') {
      advance();
      return { kind: 'num', value: t.value };
    }
    if (t.kind === 'name') {
      advance();
      return { kind: 'ref', name: t.text };
    }
    if (t.kind === 'func') {
      advance();
      if (!atOp('(')) throw new ParseError(`Expected "(" after ${t.text}`);
      advance();
      const args: FormulaAst[] = [];
      if (!atOp(')')) {
        args.push(parseExpr());
        while (atOp(',')) {
          advance();
          args.push(parseExpr());
        }
      }
      if (!atOp(')')) throw new ParseError(`Expected ")" to close ${t.text}(...)`);
      advance();
      const fn = FUNCTION_ALIASES[t.text.toLowerCase()];
      const singleArgFns = fn === 'abs' || fn === 'priorPeriod' || fn === 'priorYear';
      if (singleArgFns && args.length !== 1) throw new ParseError(`${t.text}() takes exactly 1 argument`);
      if (!singleArgFns && args.length < 1) throw new ParseError(`${t.text}() takes at least 1 argument`);
      return { kind: 'call', fn, args };
    }
    if (t.kind === 'op' && t.text === '(') {
      advance();
      const inner = parseExpr();
      if (!atOp(')')) throw new ParseError('Missing closing ")"');
      advance();
      return inner;
    }
    throw new ParseError(`Unexpected token "${t.text}"`);
  }

  try {
    const ast = parseExpr();
    if (pos < tokens.length) throw new ParseError(`Unexpected token "${tokenText(tokens[pos])}"`);
    return { ok: true, ast };
  } catch (err) {
    if (err instanceof ParseError) return { ok: false, errors: [err.message] };
    throw err;
  }
}
