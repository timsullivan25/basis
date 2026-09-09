import { describe, expect, it } from 'vitest';
import {
  buildNameIndex,
  collectRefIds,
  compileFormula,
  formatFormula,
  isCalculated,
  remapFormulaIds,
  type ResolvedFormula,
} from './resolve';

import type { StatementLine, StatementSchema } from '../../data';

function line(id: string, name: string, formula: ResolvedFormula | null = null): StatementLine {
  return {
    id,
    name,
    required: formula === null,
    rowFormat: 'normal',
    numberFormat: 'number',
    sign: 'natural',
    aggregation: 'sum',
    formula,
    aliases: [],
  };
}

/** A small schema mirroring the real one's tricky shape: "Depreciation & Amortization" exists
 *  on both Income Statement (raw) and Cash Flow (pull-through, self-referencing); "Operating
 *  Income" reads the ambiguous name from neither of those two lines. */
function fixtureSchema(): StatementSchema {
  return {
    id: 's1',
    name: 'Test',
    createdAt: '',
    sections: [
      {
        id: 'income-statement',
        name: 'Income Statement',
        lines: [
          line('revenue', 'Revenue'),
          line('da-is', 'Depreciation & Amortization'),
          line('op-income', 'Operating Income'),
        ],
      },
      {
        id: 'cash-flow',
        name: 'Cash Flow Statement',
        lines: [line('da-cf', 'Depreciation & Amortization'), line('net-income', 'Net Income')],
      },
    ],
  };
}

function compile(text: string, schema: StatementSchema, ownLineId: string) {
  return compileFormula(text, buildNameIndex(schema), ownLineId);
}

describe('buildNameIndex — resolve', () => {
  it('resolves an unambiguous plain name', () => {
    const schema = fixtureSchema();
    const result = compile('Revenue', schema, 'op-income');
    expect(result).toEqual({ ok: true, formula: { kind: 'ref', lineId: 'revenue' } });
  });

  it('self-excludes so a pull-through line resolves to the OTHER same-named line, not itself', () => {
    const schema = fixtureSchema();
    // Cash Flow's "Depreciation & Amortization" (da-cf) references "Depreciation & Amortization"
    // meaning the Income Statement's raw line — excluding itself leaves exactly one candidate.
    const result = compile('Depreciation & Amortization', schema, 'da-cf');
    expect(result).toEqual({ ok: true, formula: { kind: 'ref', lineId: 'da-is' } });
  });

  it('errors on a genuine ambiguity, naming the qualified alternatives', () => {
    const schema = fixtureSchema();
    // "Operating Income" is neither of the two "Depreciation & Amortization" lines, so
    // self-exclusion doesn't narrow it — this must be a compile error, not a silent guess.
    const result = compile('Depreciation & Amortization', schema, 'op-income');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toContain('ambiguous');
      expect(result.errors[0]).toContain('Income Statement.Depreciation & Amortization');
      expect(result.errors[0]).toContain('Cash Flow Statement.Depreciation & Amortization');
    }
  });

  it('resolves a qualified reference directly, unambiguously', () => {
    const schema = fixtureSchema();
    const result = compile('Income Statement.Depreciation & Amortization', schema, 'op-income');
    expect(result).toEqual({ ok: true, formula: { kind: 'ref', lineId: 'da-is' } });
  });

  it('the other qualified form resolves to the other line', () => {
    const schema = fixtureSchema();
    const result = compile('Cash Flow Statement.Depreciation & Amortization', schema, 'op-income');
    expect(result).toEqual({ ok: true, formula: { kind: 'ref', lineId: 'da-cf' } });
  });

  it('compiles empty text to a null formula, not an error', () => {
    const schema = fixtureSchema();
    expect(compile('', schema, 'revenue')).toEqual({ ok: true, formula: null });
    expect(compile('   ', schema, 'revenue')).toEqual({ ok: true, formula: null });
  });

  it('flags a name matching nothing but itself as unknown, not as zero remaining candidates crashing', () => {
    const schema = fixtureSchema();
    const result = compile('Revenue', schema, 'revenue'); // a line referencing its own name, no pull-through target
    expect(result.ok).toBe(false);
  });
});

describe('formatFormula', () => {
  it('renders a bare name when unambiguous', () => {
    const schema = fixtureSchema();
    const index = buildNameIndex(schema);
    const formula: ResolvedFormula = { kind: 'ref', lineId: 'revenue' };
    expect(formatFormula(formula, index)).toBe('Revenue');
  });

  it('qualifies a ref whose name is currently ambiguous', () => {
    const schema = fixtureSchema();
    const index = buildNameIndex(schema);
    const formula: ResolvedFormula = { kind: 'ref', lineId: 'da-is' };
    expect(formatFormula(formula, index)).toBe('Income Statement.Depreciation & Amortization');
  });

  it('renders null as an empty string', () => {
    const schema = fixtureSchema();
    expect(formatFormula(null, buildNameIndex(schema))).toBe('');
  });

  it('reflects a rename immediately, with no stored text to update', () => {
    const schema = fixtureSchema();
    schema.sections[0].lines[0].name = 'Total Revenue'; // rename "Revenue" in place
    const index = buildNameIndex(schema);
    const formula: ResolvedFormula = { kind: 'ref', lineId: 'revenue' };
    expect(formatFormula(formula, index)).toBe('Total Revenue');
  });

  it('starts qualifying a ref once a rename introduces a fresh collision', () => {
    const schema = fixtureSchema();
    schema.sections[1].lines[1].name = 'Revenue'; // rename Cash Flow's "Net Income" to collide with "Revenue"
    const index = buildNameIndex(schema);
    const formula: ResolvedFormula = { kind: 'ref', lineId: 'revenue' };
    expect(formatFormula(formula, index)).toBe('Income Statement.Revenue');
  });

  it('round-trips every precedence/associativity case through compile -> format -> compile', () => {
    const schema = fixtureSchema();
    const index = buildNameIndex(schema);
    const cases = [
      '2 + 3 * 4',
      '(2 + 3) * 4',
      '2 ^ 3 ^ 2',
      '(2 ^ 3) ^ 2',
      '-(Revenue + 1)',
      'Revenue - (Revenue - 1)',
      'Revenue - Revenue - 1',
      'sum(Revenue, 1, 2)',
    ];
    for (const text of cases) {
      const first = compileFormula(text, index, 'op-income');
      if (!first.ok || !first.formula) throw new Error(`fixture case failed to compile: ${text}`);
      const printed = formatFormula(first.formula, index);
      const second = compileFormula(printed, index, 'op-income');
      expect(second).toEqual(first);
    }
  });
});

describe('collectRefIds', () => {
  it('collects every referenced line id, including inside a function call', () => {
    const formula: ResolvedFormula = {
      kind: 'call',
      fn: 'sum',
      args: [
        { kind: 'ref', lineId: 'a' },
        { kind: 'bin', op: '+', left: { kind: 'ref', lineId: 'b' }, right: { kind: 'num', value: 1 } },
      ],
    };
    expect(collectRefIds(formula).sort()).toEqual(['a', 'b']);
  });
});

describe('remapFormulaIds', () => {
  it('rewrites every ref through the id map', () => {
    const formula: ResolvedFormula = {
      kind: 'bin',
      op: '-',
      left: { kind: 'ref', lineId: 'old-revenue' },
      right: { kind: 'ref', lineId: 'old-cogs' },
    };
    const idMap = new Map([
      ['old-revenue', 'new-revenue'],
      ['old-cogs', 'new-cogs'],
    ]);
    expect(remapFormulaIds(formula, idMap)).toEqual({
      kind: 'bin',
      op: '-',
      left: { kind: 'ref', lineId: 'new-revenue' },
      right: { kind: 'ref', lineId: 'new-cogs' },
    });
  });

  it('leaves numeric literals untouched', () => {
    const formula: ResolvedFormula = { kind: 'num', value: 42 };
    expect(remapFormulaIds(formula, new Map())).toEqual(formula);
  });
});

describe('buildNameIndex — suggestions', () => {
  it('offers a bare suggestion for a name unambiguous from this line', () => {
    const index = buildNameIndex(fixtureSchema());
    expect(index.suggestions('op-income')).toContain('Revenue');
  });

  it('never offers a bare suggestion for a name ambiguous from this line', () => {
    const index = buildNameIndex(fixtureSchema());
    const suggestions = index.suggestions('op-income');
    expect(suggestions).not.toContain('Depreciation & Amortization');
    expect(suggestions).toContain('Income Statement.Depreciation & Amortization');
    expect(suggestions).toContain('Cash Flow Statement.Depreciation & Amortization');
  });

  it('offers a bare suggestion for a pull-through line reading its own name elsewhere', () => {
    const index = buildNameIndex(fixtureSchema());
    // From da-cf's own formula, "Depreciation & Amortization" resolves unambiguously to da-is
    // once self is excluded — so the bare form is fine to suggest here, unlike from op-income.
    const suggestions = index.suggestions('da-cf');
    expect(suggestions).toContain('Depreciation & Amortization');
    expect(suggestions).not.toContain('Income Statement.Depreciation & Amortization');
  });

  it('never suggests a name only this line itself has', () => {
    const index = buildNameIndex(fixtureSchema());
    // "Revenue" belongs to no one else — referencing it from its own formula would self-cycle.
    expect(index.suggestions('revenue')).not.toContain('Revenue');
  });
});

describe('isCalculated', () => {
  it('is false for a null formula', () => {
    expect(isCalculated({ formula: null })).toBe(false);
  });

  it('is true for a resolved formula', () => {
    expect(isCalculated({ formula: { kind: 'num', value: 1 } })).toBe(true);
  });
});
