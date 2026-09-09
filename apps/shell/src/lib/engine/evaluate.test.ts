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
function call(fn: 'sum' | 'min' | 'max' | 'avg' | 'abs' | 'priorPeriod' | 'priorYear', args: ResolvedFormula[]): ResolvedFormula {
  return { kind: 'call', fn, args };
}

function schema(lines: StatementLine[]): StatementSchema {
  return { id: 's1', name: 'Test', createdAt: '', sections: [{ id: 'sec', name: 'Section', lines }] };
}

function modelWithTimeline(timeline: TimelinePeriod[], historicals: Record<string, (number | null)[]>): Model {
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

function model(periodCount: number, historicals: Record<string, (number | null)[]>): Model {
  const timeline: TimelinePeriod[] = Array.from({ length: periodCount }, (_, i) => ({
    id: `p${i}`,
    type: 'FY',
    endDate: `202${i}-12-31`,
    label: `FY 202${i}`,
    kind: 'actual',
  }));
  return modelWithTimeline(timeline, historicals);
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

describe('priorPeriod / priorYear', () => {
  it('priorPeriod at the first period is null', () => {
    const s = schema([line('revenue'), line('prior', call('priorPeriod', [ref('revenue')]))]);
    const m = model(1, { revenue: [100] });
    const result = evaluateModel(s, m);
    expect(result.getValue('prior', 0)).toBeNull();
  });

  it('priorPeriod reads the immediately preceding period', () => {
    const s = schema([line('revenue'), line('prior', call('priorPeriod', [ref('revenue')]))]);
    const m = model(3, { revenue: [100, 150, 200] });
    const result = evaluateModel(s, m);
    expect(result.getValue('prior', 0)).toBeNull();
    expect(result.getValue('prior', 1)).toBe(100);
    expect(result.getValue('prior', 2)).toBe(150);
  });

  it('evaluates a self-referencing running total in one pass, not via the cycle solver', () => {
    // total(p) = sum(priorPeriod(total), delta(p)) — a legitimate recurrence, not a same-period
    // cycle (graph.test.ts covers the classification itself; this covers the actual numbers).
    // sum() rather than '+' so period 0's missing prior value (null) doesn't null out the total —
    // it's simply absent, same as any other sum() argument would be.
    const s = schema([
      line('delta'),
      line('total', call('sum', [call('priorPeriod', [ref('total')]), ref('delta')])),
    ]);
    const m = model(3, { delta: [10, 10, 10] });
    const result = evaluateModel(s, m);
    expect(result.getValue('total', 0)).toBe(10);
    expect(result.getValue('total', 1)).toBe(20);
    expect(result.getValue('total', 2)).toBe(30);
    expect(result.getError('total')).toBeUndefined();
  });

  it('does not leak a same-period cycle\'s in-flight values into a priorPeriod read of an earlier period', () => {
    // a/b form a genuine same-period cycle (converges to 20/20 at every period, independent of
    // time). c reads priorPeriod(a) — if the cycle's in-flight iteration values ever leaked into
    // that cross-period read, c(1) would reflect period 1's own in-progress solve instead of
    // period 0's already-converged, memoized value.
    const s = schema([
      line('a', bin('+', num(10), bin('*', num(0.5), ref('b')))),
      line('b', bin('+', num(10), bin('*', num(0.5), ref('a')))),
      line('c', call('priorPeriod', [ref('a')])),
    ]);
    const m = model(2, {});
    const result = evaluateModel(s, m);
    expect(result.getValue('a', 0)).toBeCloseTo(20, 4);
    expect(result.getValue('c', 1)).toBeCloseTo(20, 4);
  });

  it('priorYear on an annual timeline agrees with priorPeriod', () => {
    const s = schema([line('revenue'), line('py', call('priorYear', [ref('revenue')]))]);
    const m = model(3, { revenue: [100, 150, 200] }); // FY periods exactly 1 year apart
    const result = evaluateModel(s, m);
    expect(result.getValue('py', 1)).toBe(100);
    expect(result.getValue('py', 2)).toBe(150);
  });

  it('priorYear on a quarterly timeline lands 4 periods back', () => {
    const timeline: TimelinePeriod[] = [
      { id: 'q1', type: 'Quarter', endDate: '2024-03-31', label: 'Q1 2024', kind: 'actual' },
      { id: 'q2', type: 'Quarter', endDate: '2024-06-30', label: 'Q2 2024', kind: 'actual' },
      { id: 'q3', type: 'Quarter', endDate: '2024-09-30', label: 'Q3 2024', kind: 'actual' },
      { id: 'q4', type: 'Quarter', endDate: '2024-12-31', label: 'Q4 2024', kind: 'actual' },
      { id: 'q5', type: 'Quarter', endDate: '2025-03-31', label: 'Q1 2025', kind: 'actual' },
    ];
    const s = schema([line('revenue'), line('py', call('priorYear', [ref('revenue')]))]);
    const m = modelWithTimeline(timeline, { revenue: [10, 20, 30, 40, 50] });
    const result = evaluateModel(s, m);
    expect(result.getValue('py', 4)).toBe(10);
    expect(result.getValue('py', 0)).toBeNull();
  });

  it('priorYear returns null when no same-type period falls within tolerance', () => {
    const timeline: TimelinePeriod[] = [
      { id: 'fy1', type: 'FY', endDate: '2018-12-31', label: 'FY 2018', kind: 'actual' },
      { id: 'fy2', type: 'FY', endDate: '2024-12-31', label: 'FY 2024', kind: 'actual' },
    ];
    const s = schema([line('revenue'), line('py', call('priorYear', [ref('revenue')]))]);
    const m = modelWithTimeline(timeline, { revenue: [100, 500] });
    const result = evaluateModel(s, m);
    expect(result.getValue('py', 1)).toBeNull();
  });

  it('priorYear only ever matches a period of the same type', () => {
    const timeline: TimelinePeriod[] = [
      { id: 'fy1', type: 'FY', endDate: '2023-12-31', label: 'FY 2023', kind: 'actual' },
      { id: 'q1', type: 'Quarter', endDate: '2024-12-31', label: 'Q4 2024', kind: 'actual' },
    ];
    const s = schema([line('revenue'), line('py', call('priorYear', [ref('revenue')]))]);
    const m = modelWithTimeline(timeline, { revenue: [100, 500] });
    const result = evaluateModel(s, m);
    // q1's date is exactly one year after fy1's, but they're different types — must not match.
    expect(result.getValue('py', 1)).toBeNull();
  });
});
