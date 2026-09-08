import { describe, expect, it } from 'vitest';
import { parseFormula, renameInFormula, tokenize, validateFormula, type FormulaAst } from './parse';

/** Pure-arithmetic evaluator for AST shape/precedence tests — the real evaluator (with null
 *  propagation and line lookups) lands in slice 2; these formulas never reference a line. */
function evalAst(ast: FormulaAst): number {
  switch (ast.kind) {
    case 'num':
      return ast.value;
    case 'neg':
      return -evalAst(ast.arg);
    case 'bin': {
      const l = evalAst(ast.left);
      const r = evalAst(ast.right);
      if (ast.op === '+') return l + r;
      if (ast.op === '-') return l - r;
      if (ast.op === '*') return l * r;
      if (ast.op === '/') return l / r;
      return Math.pow(l, r);
    }
    case 'call': {
      const vals = ast.args.map(evalAst);
      if (ast.fn === 'sum') return vals.reduce((a, b) => a + b, 0);
      if (ast.fn === 'min') return Math.min(...vals);
      if (ast.fn === 'max') return Math.max(...vals);
      if (ast.fn === 'avg') return vals.reduce((a, b) => a + b, 0) / vals.length;
      return Math.abs(vals[0]);
    }
    case 'ref':
      throw new Error('unexpected ref in a pure-arithmetic test formula');
  }
}

function ok(formula: string, knownNames: string[] = []): FormulaAst {
  const result = parseFormula(formula, knownNames);
  if (!result.ok) throw new Error(`expected parse to succeed, got: ${result.errors.join('; ')}`);
  return result.ast;
}

describe('tokenize', () => {
  it('treats a hyphenated line name as one token, not split on the hyphen', () => {
    const tokens = tokenize('Stock-Based Compensation + 5', ['Stock-Based Compensation']);
    expect(tokens[0]).toMatchObject({ kind: 'name', text: 'Stock-Based Compensation' });
    expect(tokens[1]).toMatchObject({ kind: 'op', text: '+' });
    expect(tokens[2]).toMatchObject({ kind: 'num', value: 5 });
  });

  it('treats a comma-containing line name as one token, not split on the comma', () => {
    const tokens = tokenize('Interest Expense, Net', ['Interest Expense, Net']);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ kind: 'name', text: 'Interest Expense, Net' });
  });

  it('does not match a known name that is only a prefix of a longer unrelated word', () => {
    const tokens = tokenize('Taxes + 1', ['Tax']);
    expect(tokens[0]).toMatchObject({ kind: 'unknown', text: 'Taxes' });
  });
});

describe('parseFormula — arithmetic', () => {
  it('respects operator precedence', () => {
    expect(evalAst(ok('2 + 3 * 4'))).toBe(14);
  });

  it('is right-associative for exponentiation', () => {
    expect(evalAst(ok('2 ^ 3 ^ 2'))).toBe(512); // 2 ^ (3 ^ 2), not (2 ^ 3) ^ 2 = 64
  });

  it('parses unary negation', () => {
    expect(evalAst(ok('-5 + 3'))).toBe(-2);
  });

  it('parses parenthesized groups', () => {
    expect(evalAst(ok('(2 + 3) * 4'))).toBe(20);
  });
});

describe('parseFormula — functions', () => {
  it('accepts multi-arg sum/min/max/avg', () => {
    expect(evalAst(ok('sum(1, 2, 3)'))).toBe(6);
    expect(evalAst(ok('min(4, 2, 9)'))).toBe(2);
    expect(evalAst(ok('max(4, 2, 9)'))).toBe(9);
    expect(evalAst(ok('avg(2, 4)'))).toBe(3);
  });

  it('treats "average" as an alias for avg', () => {
    expect(evalAst(ok('average(2, 4)'))).toBe(3);
  });

  it('accepts abs() with exactly one argument', () => {
    expect(evalAst(ok('abs(-5)'))).toBe(5);
  });

  it('rejects abs() with more than one argument', () => {
    expect(parseFormula('abs(1, 2)', [])).toEqual({ ok: false, errors: ['abs() takes exactly 1 argument'] });
  });

  it('rejects sum() with no arguments', () => {
    expect(parseFormula('sum()', [])).toEqual({ ok: false, errors: ['sum() takes at least 1 argument'] });
  });
});

describe('parseFormula — line references', () => {
  it('resolves known line names to ref nodes', () => {
    const ast = ok('Revenue - COGS', ['Revenue', 'COGS']);
    expect(ast).toEqual({
      kind: 'bin',
      op: '-',
      left: { kind: 'ref', name: 'Revenue' },
      right: { kind: 'ref', name: 'COGS' },
    });
  });

  it('flags a single unknown line name', () => {
    expect(parseFormula('Revenue - Bogus', ['Revenue'])).toEqual({ ok: false, errors: ['Unknown line: Bogus'] });
  });

  it('flags multiple unknown line names together', () => {
    expect(parseFormula('Foo + Bar', [])).toEqual({ ok: false, errors: ['Unknown lines: Foo, Bar'] });
  });
});

describe('parseFormula — syntax errors', () => {
  it('reports an unbalanced opening paren', () => {
    expect(parseFormula('(2 + 3', []).ok).toBe(false);
  });

  it('reports a trailing token', () => {
    expect(parseFormula('2 + 3)', []).ok).toBe(false);
  });
});

describe('validateFormula', () => {
  it('returns no errors for a valid formula', () => {
    expect(validateFormula('Revenue - COGS', ['Revenue', 'COGS'])).toEqual([]);
  });

  it('returns no errors for an empty formula', () => {
    expect(validateFormula('', ['Revenue'])).toEqual([]);
  });

  it('surfaces the unknown-line message', () => {
    expect(validateFormula('Revenue - Bogus', ['Revenue'])).toEqual(['Unknown line: Bogus']);
  });
});

describe('renameInFormula', () => {
  it('renames a plain reference', () => {
    expect(renameInFormula('Revenue - COGS', ['Revenue', 'COGS'], 'Revenue', 'Total Revenue')).toBe(
      'Total Revenue - COGS',
    );
  });

  it('renames a reference that itself contains a hyphen or comma', () => {
    const knownNames = ['Stock-Based Compensation', 'EBITDA'];
    expect(renameInFormula('EBITDA + Stock-Based Compensation', knownNames, 'Stock-Based Compensation', 'SBC')).toBe(
      'EBITDA + SBC',
    );
  });

  it('renames every occurrence when a name is referenced more than once', () => {
    expect(renameInFormula('Revenue + Revenue', ['Revenue'], 'Revenue', 'Sales')).toBe('Sales + Sales');
  });

  it('leaves a formula untouched when it does not reference the old name', () => {
    expect(renameInFormula('COGS * 2', ['Revenue', 'COGS'], 'Revenue', 'Total Revenue')).toBe('COGS * 2');
  });
});
