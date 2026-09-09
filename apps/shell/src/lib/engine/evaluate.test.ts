import { describe, expect, it } from 'vitest';
import { evaluateModel } from './evaluate';
import type { Model, ResolvedFormula, StatementLine, StatementSchema, TimelinePeriod } from '../../data';

function line(id: string, formula: ResolvedFormula | null = null): StatementLine {
  return {
    id,
    name: id,
    required: formula === null,
    rowFormat: 'normal',
    numberFormat: 'number',
    sign: 'natural',
    aggregation: 'sum',
    formula,
    aliases: [],
  };
}

function ref(lineId: string): ResolvedFormula {
  return { kind: 'ref', lineId };
}
function num(value: number): ResolvedFormula {
  return { kind: 'num', value };
}
function bin(op: '+' | '-' | '*' | '/' | '^', left: ResolvedFormula, right: ResolvedFormula): ResolvedFormula {
  return { kind: 'bin', op, left, right };
}
function call(fn: 'sum' | 'min' | 'max' | 'avg' | 'abs', args: ResolvedFormula[]): ResolvedFormula {
  return { kind: 'call', fn, args };
}

function schema(lines: StatementLine[]): StatementSchema {
  return { id: 's1', name: 'Test', createdAt: '', sections: [{ id: 'sec', name: 'Section', lines }] };
}

function model(periodCount: number, historicals: Record<string, (number | null)[]>): Model {
  const timeline: TimelinePeriod[] = Array.from({ length: periodCount }, (_, i) => ({
    id: `p${i}`,
    type: 'FY',
    endDate: `202${i}-12-31`,
    label: `FY 202${i}`,
    kind: 'actual',
  }));
  return {
    id: 'm1',
    companyId: 'c1',
    name: 'Model',
    statementSchemaId: 's1',
    modelImportId: 'mi1',
    mappingId: 'map1',
    timeline,
    historicals,
    createdAt: '',
  };
}

describe('evaluateModel', () => {
  it('reads a non-calculated line straight from historicals', () => {
    const s = schema([line('revenue')]);
    const m = model(1, { revenue: [100] });
    const result = evaluateModel(s, m);
    expect(result.getValue('revenue', 0)).toBe(100);
  });

  it('computes a calculated line from its precedents', () => {
    const s = schema([line('revenue'), line('cogs'), line('gross-profit', bin('-', ref('revenue'), ref('cogs')))]);
    const m = model(1, { revenue: [100], cogs: [40] });
    const result = evaluateModel(s, m);
    expect(result.getValue('gross-profit', 0)).toBe(60);
  });

  it('evaluates independently per period', () => {
    const s = schema([line('revenue'), line('cogs'), line('gross-profit', bin('-', ref('revenue'), ref('cogs')))]);
    const m = model(2, { revenue: [100, 200], cogs: [40, 50] });
    const result = evaluateModel(s, m);
    expect(result.getValue('gross-profit', 0)).toBe(60);
    expect(result.getValue('gross-profit', 1)).toBe(150);
  });

  it('propagates null through arithmetic when an input is missing', () => {
    const s = schema([line('revenue'), line('cogs'), line('gross-profit', bin('-', ref('revenue'), ref('cogs')))]);
    const m = model(1, { revenue: [100], cogs: [null] });
    const result = evaluateModel(s, m);
    expect(result.getValue('gross-profit', 0)).toBeNull();
  });

  it('treats division by zero as null, not Infinity', () => {
    const s = schema([line('a'), line('b'), line('ratio', bin('/', ref('a'), ref('b')))]);
    const m = model(1, { a: [10], b: [0] });
    const result = evaluateModel(s, m);
    expect(result.getValue('ratio', 0)).toBeNull();
  });

  it('sum/min/max/avg ignore null args like Excel ignores blanks', () => {
    const s = schema([
      line('a'),
      line('b'),
      line('c'),
      line('total', call('sum', [ref('a'), ref('b'), ref('c')])),
      line('lowest', call('min', [ref('a'), ref('b'), ref('c')])),
      line('highest', call('max', [ref('a'), ref('b'), ref('c')])),
      line('average', call('avg', [ref('a'), ref('b'), ref('c')])),
    ]);
    const m = model(1, { a: [10], b: [null], c: [30] });
    const result = evaluateModel(s, m);
    expect(result.getValue('total', 0)).toBe(40);
    expect(result.getValue('lowest', 0)).toBe(10);
    expect(result.getValue('highest', 0)).toBe(30);
    expect(result.getValue('average', 0)).toBe(20);
  });

  it('a call is null only when every argument is null', () => {
    const s = schema([line('a'), line('b'), line('total', call('sum', [ref('a'), ref('b')]))]);
    const m = model(1, { a: [null], b: [null] });
    const result = evaluateModel(s, m);
    expect(result.getValue('total', 0)).toBeNull();
  });

  it('abs propagates null rather than treating it as zero', () => {
    const s = schema([line('a'), line('magnitude', call('abs', [ref('a')]))]);
    const m = model(1, { a: [null] });
    const result = evaluateModel(s, m);
    expect(result.getValue('magnitude', 0)).toBeNull();
  });

  it('solves a converging circular reference via fixed-point iteration', () => {
    // a = 10 + 0.5*b, b = 10 + 0.5*a — the symmetric fixed point is a = b = 20.
    const s = schema([
      line('a', bin('+', num(10), bin('*', num(0.5), ref('b')))),
      line('b', bin('+', num(10), bin('*', num(0.5), ref('a')))),
    ]);
    const m = model(1, {});
    const result = evaluateModel(s, m);
    expect(result.getValue('a', 0)).toBeCloseTo(20, 4);
    expect(result.getValue('b', 0)).toBeCloseTo(20, 4);
    expect(result.getError('a')).toBeUndefined();
  });

  it('surfaces a non-convergent circular reference as an error, not an infinite loop', () => {
    // a = 2*b + 1, b = 2*a + 1 — diverges without bound instead of settling.
    const s = schema([
      line('a', bin('+', bin('*', num(2), ref('b')), num(1))),
      line('b', bin('+', bin('*', num(2), ref('a')), num(1))),
    ]);
    const m = model(1, {});
    const result = evaluateModel(s, m);
    expect(result.getError('a')).toBeDefined();
    expect(result.getError('b')).toBeDefined();
  });
});
