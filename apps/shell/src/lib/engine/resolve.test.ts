import { describe, expect, it } from 'vitest';
import {
  buildDaysFormula,
  buildFlatFormula,
  buildGrowthFormula,
  buildNameIndex,
  buildRatioFormula,
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
    role: formula === null ? 'required' : 'calculated',
    rowFormat: 'normal',
    numberFormat: 'number',
    sign: 'natural',
    aggregation: 'sum',
    formula,
    projection: null,
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
    updatedAt: '',
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
    drivers: [],
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
  const byLine = (suggestions: ReturnType<ReturnType<typeof buildNameIndex>['suggestions']>, lineId: string) =>
    suggestions.find((x) => x.lineId === lineId)!;

  it('inserts the bare name for a name no other line shares', () => {
    const index = buildNameIndex(fixtureSchema());
    const revenue = byLine(index.suggestions('op-income'), 'revenue');
    expect(revenue.insertText).toBe('Revenue');
    expect(revenue.qualified).toBe(false);
  });

  it('inserts the qualified name, for every line, when the name is shared anywhere', () => {
    const index = buildNameIndex(fixtureSchema());
    const suggestions = index.suggestions('op-income');
    expect(byLine(suggestions, 'da-is').insertText).toBe('Income Statement.Depreciation & Amortization');
    expect(byLine(suggestions, 'da-cf').insertText).toBe('Cash Flow Statement.Depreciation & Amortization');
  });

  it('qualifies a duplicated name even when suggesting from one of the duplicates (matches what reopening shows)', () => {
    const index = buildNameIndex(fixtureSchema());
    // From da-cf's own formula the bare name would resolve to da-is once self is excluded — but
    // formatFormula shows it qualified (the name IS shared), so autocomplete must insert that form.
    const fromCf = byLine(index.suggestions('da-cf'), 'da-is');
    expect(fromCf.insertText).toBe('Income Statement.Depreciation & Amortization');
    const compiled = compileFormula(fromCf.insertText, index, 'da-cf');
    expect(compiled.ok && formatFormula(compiled.formula, index)).toBe(fromCf.insertText);
  });

  it('carries the section name for every entry so it can be searched and shown', () => {
    const index = buildNameIndex(fixtureSchema());
    expect(byLine(index.suggestions('op-income'), 'revenue').sectionName).toBe('Income Statement');
  });

  it('never suggests the line itself', () => {
    const index = buildNameIndex(fixtureSchema());
    // A bare self-reference wouldn't resolve, and it would self-cycle anyway.
    expect(index.suggestions('revenue').some((x) => x.lineId === 'revenue')).toBe(false);
  });
});

describe('buildNameIndex — qualifierLength', () => {
  it('is the length of the leading "Section." for a qualified reference, case-insensitively', () => {
    const index = buildNameIndex(fixtureSchema());
    expect(index.qualifierLength('Income Statement.Depreciation & Amortization')).toBe('Income Statement.'.length);
    expect(index.qualifierLength('income statement.depreciation & amortization')).toBe('Income Statement.'.length);
  });

  it('is 0 for a bare name and for text that is not a reference', () => {
    const index = buildNameIndex(fixtureSchema());
    expect(index.qualifierLength('Revenue')).toBe(0);
    expect(index.qualifierLength('Nothing.Here')).toBe(0);
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

describe('driverRef', () => {
  function schemaWithDriver(driverName: string) {
    const schema = fixtureSchema();
    schema.drivers = [{ id: 'd1', name: driverName, unit: '%', targetLineId: 'revenue', method: 'growth' }];
    return schema;
  }

  it('describeDriver looks up a driver by id', () => {
    const index = buildNameIndex(schemaWithDriver('Revenue Growth Rate'));
    expect(index.describeDriver('d1')).toEqual({ name: 'Revenue Growth Rate' });
    expect(index.describeDriver('unknown')).toBeUndefined();
  });

  it('formatFormula renders a driverRef by the driver\'s current name', () => {
    const index = buildNameIndex(schemaWithDriver('Revenue Growth Rate'));
    const formula: ResolvedFormula = { kind: 'driverRef', driverId: 'd1' };
    expect(formatFormula(formula, index)).toBe('Revenue Growth Rate');
  });

  it('formatFormula reflects a driver rename immediately, same as it does for lines', () => {
    const renamed = buildNameIndex(schemaWithDriver('Revenue Growth Rate 2026'));
    const formula: ResolvedFormula = { kind: 'driverRef', driverId: 'd1' };
    expect(formatFormula(formula, renamed)).toBe('Revenue Growth Rate 2026');
  });

  it('formatFormula renders a full driver-generated growth formula readably', () => {
    const index = buildNameIndex(schemaWithDriver('Revenue Growth Rate'));
    const formula = buildGrowthFormula('revenue', 'd1');
    expect(formatFormula(formula, index)).toBe('priorPeriod(Revenue) * (1 + Revenue Growth Rate)');
  });

  it('collectRefIds does not collect a driverRef (line ids only, by contract)', () => {
    const formula: ResolvedFormula = { kind: 'driverRef', driverId: 'd1' };
    expect(collectRefIds(formula)).toEqual([]);
  });

  it('remapFormulaIds rewrites a driverRef through the id map, same as it does for a ref', () => {
    const formula: ResolvedFormula = {
      kind: 'bin',
      op: '*',
      left: { kind: 'ref', lineId: 'old-revenue' },
      right: { kind: 'driverRef', driverId: 'old-driver' },
    };
    const idMap = new Map([
      ['old-revenue', 'new-revenue'],
      ['old-driver', 'new-driver'],
    ]);
    expect(remapFormulaIds(formula, idMap)).toEqual({
      kind: 'bin',
      op: '*',
      left: { kind: 'ref', lineId: 'new-revenue' },
      right: { kind: 'driverRef', driverId: 'new-driver' },
    });
  });
});

describe('projection-method formula builders', () => {
  it('buildFlatFormula is a pure self-referencing carry-forward, no driver involved', () => {
    expect(buildFlatFormula('revenue')).toEqual({
      kind: 'call',
      fn: 'priorPeriod',
      args: [{ kind: 'ref', lineId: 'revenue' }],
    });
  });

  it('buildGrowthFormula compounds the prior period by (1 + driver)', () => {
    expect(buildGrowthFormula('revenue', 'd1')).toEqual({
      kind: 'bin',
      op: '*',
      left: { kind: 'call', fn: 'priorPeriod', args: [{ kind: 'ref', lineId: 'revenue' }] },
      right: { kind: 'bin', op: '+', left: { kind: 'num', value: 1 }, right: { kind: 'driverRef', driverId: 'd1' } },
    });
  });

  it('buildRatioFormula is basis * driver — percent-of', () => {
    expect(buildRatioFormula('revenue', 'd1')).toEqual({
      kind: 'bin',
      op: '*',
      left: { kind: 'ref', lineId: 'revenue' },
      right: { kind: 'driverRef', driverId: 'd1' },
    });
  });

  it('buildDaysFormula is (driver / 365) * basis', () => {
    expect(buildDaysFormula('revenue', 'd1')).toEqual({
      kind: 'bin',
      op: '*',
      left: { kind: 'bin', op: '/', left: { kind: 'driverRef', driverId: 'd1' }, right: { kind: 'num', value: 365 } },
      right: { kind: 'ref', lineId: 'revenue' },
    });
  });

  it('every builder round-trips through formatFormula/compileFormula-free rendering without error', () => {
    const schema = fixtureSchema();
    schema.drivers = [{ id: 'd1', name: 'Test Driver', unit: '%', targetLineId: 'revenue', method: 'growth' }];
    const index = buildNameIndex(schema);
    expect(formatFormula(buildFlatFormula('revenue'), index)).toBe('priorPeriod(Revenue)');
    expect(formatFormula(buildRatioFormula('revenue', 'd1'), index)).toBe('Revenue * Test Driver');
    expect(formatFormula(buildDaysFormula('revenue', 'd1'), index)).toBe('Test Driver / 365 * Revenue');
  });
});
