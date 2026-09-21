import { describe, expect, it } from 'vitest';
import { evaluateModel } from './evaluate';
import type { DriverDefinition, Model, ProjectionMethod, ResolvedFormula, StatementLine, StatementSchema, TimelinePeriod } from '../../data';

/** A sourced line: mapped values win where they exist, its formula (a projection) is the fallback. */
function line(id: string, formula: ResolvedFormula | null = null): StatementLine {
  return {
    id,
    name: id,
    role: 'optional',
    rowFormat: 'normal',
    numberFormat: 'number',
    sign: 'natural',
    aggregation: 'sum',
    formula,
    projection: null,
    aliases: [],
  };
}

/** A Calculated line: its formula gives every period; a mapped value is never read. */
function calcLine(id: string, formula: ResolvedFormula): StatementLine {
  return { ...line(id, formula), role: 'calculated' };
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
function call(fn: 'sum' | 'min' | 'max' | 'avg' | 'abs' | 'priorPeriod' | 'priorYear' | 'lastActual', args: ResolvedFormula[]): ResolvedFormula {
  return { kind: 'call', fn, args };
}
function driverRef(driverId: string): ResolvedFormula {
  return { kind: 'driverRef', driverId };
}

function schema(lines: StatementLine[], drivers: DriverDefinition[] = []): StatementSchema {
  return { id: 's1', name: 'Test', createdAt: '', updatedAt: '', sections: [{ id: 'sec', name: 'Section', lines }], drivers };
}

function driver(id: string, method: ProjectionMethod, targetLineId: string, basisLineId?: string): DriverDefinition {
  return { id, name: id, unit: method === 'days-of' ? 'days' : '%', targetLineId, method, basisLineId };
}

function modelWithTimeline(
  timeline: TimelinePeriod[],
  historicals: Record<string, (number | null)[]>,
  driverValues: Record<string, (number | null)[]> = {},
): Model {
  return {
    id: 'm1',
    companyId: 'c1',
    name: 'Model',
    statementSchemaId: 's1',
    modelImportId: 'mi1',
    mappingId: 'map1',
    timeline,
    historicals,
    driverValues,
    createdAt: '',
    updatedAt: '',
  };
}

function model(
  periodCount: number,
  historicals: Record<string, (number | null)[]>,
  driverValues: Record<string, (number | null)[]> = {},
): Model {
  const timeline: TimelinePeriod[] = Array.from({ length: periodCount }, (_, i) => ({
    id: `p${i}`,
    type: 'FY',
    endDate: `202${i}-12-31`,
    label: `FY 202${i}`,
    kind: 'actual',
  }));
  return modelWithTimeline(timeline, historicals, driverValues);
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

describe('lastActual', () => {
  it('anchors every projected period to the same last-actual value, not the prior period', () => {
    // Mirrors buildRollOffFormula's real shape exactly: a self-referencing `lastActual(self)`
    // formula whose OWN actual periods are covered by a mapped historical (mapped-value-wins
    // means the formula never even runs for periods 0/1) — only the projected periods (2, 3),
    // which have no historical, actually fall through to it. lastActual is only ever guaranteed
    // safe to read from a period after the one it anchors to (see its own comment in evaluate.ts);
    // this is the one real call shape it needs to support.
    const timeline: TimelinePeriod[] = [
      { id: 'a1', type: 'FY', endDate: '2023-12-31', label: 'FY 2023', kind: 'actual' },
      { id: 'a2', type: 'FY', endDate: '2024-12-31', label: 'FY 2024', kind: 'actual' },
      { id: 'p1', type: 'FY', endDate: '2025-12-31', label: 'FY 2025', kind: 'projected' },
      { id: 'p2', type: 'FY', endDate: '2026-12-31', label: 'FY 2026', kind: 'projected' },
    ];
    const s = schema([line('anchor', call('lastActual', [ref('anchor')]))]);
    const m = modelWithTimeline(timeline, { anchor: [100, 150] });
    const result = evaluateModel(s, m);
    expect(result.getValue('anchor', 0)).toBe(100); // mapped, actual — formula never runs here
    expect(result.getValue('anchor', 1)).toBe(150); // mapped, actual
    expect(result.getValue('anchor', 2)).toBe(150); // no mapped value — falls through to lastActual
    expect(result.getValue('anchor', 3)).toBe(150); // same anchor again, not a further step back
  });

  it('is null when the timeline has no actual period at all', () => {
    const timeline: TimelinePeriod[] = [{ id: 'p1', type: 'FY', endDate: '2025-12-31', label: 'FY 2025', kind: 'projected' }];
    const s = schema([line('revenue'), line('anchor', call('lastActual', [ref('revenue')]))]);
    const m = modelWithTimeline(timeline, { revenue: [100] });
    const result = evaluateModel(s, m);
    expect(result.getValue('anchor', 0)).toBeNull();
  });
});

describe('driverRef and the mapped-value-first priority', () => {
  it('an explicit mapped value wins over the formula for that period', () => {
    const s = schema([line('a'), line('b'), line('total', bin('+', ref('a'), ref('b')))]);
    const m = model(1, { a: [10], b: [20], total: [999] });
    const result = evaluateModel(s, m);
    expect(result.getValue('total', 0)).toBe(999);
  });

  it('a Calculated line ignores any mapped value — its formula gives every period', () => {
    const s = schema([line('a'), line('b'), calcLine('total', bin('+', ref('a'), ref('b')))]);
    const m = model(1, { a: [10], b: [20], total: [999] });
    expect(evaluateModel(s, m).getValue('total', 0)).toBe(30);
  });

  it('falls back to the formula for a period with no mapped value', () => {
    const s = schema([line('a'), line('b'), line('total', bin('+', ref('a'), ref('b')))]);
    const m = model(2, { a: [10, 15], b: [20, 25], total: [999] });
    const result = evaluateModel(s, m);
    expect(result.getValue('total', 0)).toBe(999);
    expect(result.getValue('total', 1)).toBe(40);
  });

  it('flat (priorPeriod(self), no driver) carries the last actual value forward indefinitely', () => {
    const s = schema([line('revenue', call('priorPeriod', [ref('revenue')]))]);
    const m = model(3, { revenue: [100] });
    const result = evaluateModel(s, m);
    expect(result.getValue('revenue', 0)).toBe(100);
    expect(result.getValue('revenue', 1)).toBe(100);
    expect(result.getValue('revenue', 2)).toBe(100);
  });

  it('growth compounds off the last actual value and off an earlier projected value', () => {
    // revenue = priorPeriod(revenue) * (1 + growth driver)
    const s = schema([line('revenue', bin('*', call('priorPeriod', [ref('revenue')]), bin('+', num(1), driverRef('g'))))]);
    const m = model(3, { revenue: [100] }, { g: [null, 0.1, 0.2] });
    const result = evaluateModel(s, m);
    expect(result.getValue('revenue', 0)).toBe(100);
    expect(result.getValue('revenue', 1)).toBeCloseTo(110, 6); // 100 * 1.1
    expect(result.getValue('revenue', 2)).toBeCloseTo(132, 6); // 110 * 1.2, chained off the projected period
  });

  it('a missing driver value propagates null rather than a wrong number', () => {
    const s = schema([line('revenue', bin('*', call('priorPeriod', [ref('revenue')]), bin('+', num(1), driverRef('g'))))]);
    const m = model(2, { revenue: [100] }, { g: [] }); // no value at all for period 1
    const result = evaluateModel(s, m);
    expect(result.getValue('revenue', 1)).toBeNull();
  });

  it('percent-of resolves against a plain, non-driven basis line', () => {
    const s = schema([line('revenue'), line('cogs', bin('*', ref('revenue'), driverRef('pct')))]);
    const m = model(2, { revenue: [420, 470], cogs: [145] }, { pct: [null, 0.3] });
    const result = evaluateModel(s, m);
    expect(result.getValue('cogs', 0)).toBe(145); // mapped
    expect(result.getValue('cogs', 1)).toBeCloseTo(141, 6); // 470 * 0.3, formula fallback
  });

  it('percent-of resolves correctly when its own basis line is itself growth-driven', () => {
    const revenueFormula = bin('*', call('priorPeriod', [ref('revenue')]), bin('+', num(1), driverRef('g')));
    const s = schema([line('revenue', revenueFormula), line('cogs', bin('*', ref('revenue'), driverRef('pct')))]);
    const m = model(2, { revenue: [100] }, { g: [null, 0.1], pct: [null, 0.5] });
    const result = evaluateModel(s, m);
    expect(result.getValue('revenue', 1)).toBeCloseTo(110, 6);
    expect(result.getValue('cogs', 1)).toBeCloseTo(55, 6); // 110 * 0.5, ordered correctly after revenue
  });

  it('a percent-of-style cycle between two lines converges via the same Gauss-Seidel path as a formula cycle', () => {
    // a = b * d1 + 10, b = a * d2 — a real same-period mutual dependency through driverRefs.
    const s = schema([
      line('a', bin('+', bin('*', ref('b'), driverRef('d1')), num(10))),
      line('b', bin('*', ref('a'), driverRef('d2'))),
    ]);
    const m = model(1, {}, { d1: [0.5], d2: [0.5] });
    const result = evaluateModel(s, m);
    // a = 0.5b + 10, b = 0.5a => a = 0.25a + 10 => a = 40/3, b = 20/3
    expect(result.getValue('a', 0)).toBeCloseTo(40 / 3, 4);
    expect(result.getValue('b', 0)).toBeCloseTo(20 / 3, 4);
    expect(result.getError('a')).toBeUndefined();
  });

  it('a days-of driverRef formula evaluates like any other arithmetic', () => {
    const s = schema([
      line('revenue'),
      line('ar', bin('*', bin('/', driverRef('dso'), num(365)), ref('revenue'))),
    ]);
    const m = model(1, { revenue: [365] }, { dso: [30] });
    const result = evaluateModel(s, m);
    expect(result.getValue('ar', 0)).toBeCloseTo(30, 6); // 30/365 * 365
  });
});

describe('driver defaults (no explicit value entered for a period)', () => {
  const mixedTimeline: TimelinePeriod[] = [
    { id: 'a0', type: 'FY', endDate: '2024-12-31', label: 'FY2024', kind: 'actual' },
    { id: 'p0', type: 'FY', endDate: '2025-12-31', label: 'FY2025', kind: 'projected' },
  ];

  it('growth defaults to 0% (a flat carry-forward) when nothing is entered', () => {
    const s = schema(
      [line('revenue', bin('*', call('priorPeriod', [ref('revenue')]), bin('+', num(1), driverRef('g'))))],
      [driver('g', 'growth', 'revenue')],
    );
    const m = modelWithTimeline(mixedTimeline, { revenue: [100] });
    const result = evaluateModel(s, m);
    expect(result.getDriverValue('g', 1)).toBe(0);
    expect(result.getValue('revenue', 1)).toBe(100);
  });

  it("percent-of defaults to the last actual period's implied ratio", () => {
    const s = schema(
      [line('revenue'), line('cogs', bin('*', ref('revenue'), driverRef('pct')))],
      [driver('pct', 'percent-of', 'cogs', 'revenue')],
    );
    // Last actual: cogs=30, revenue=100 -> implied 30%.
    const m = modelWithTimeline(mixedTimeline, { revenue: [100, 200], cogs: [30] });
    const result = evaluateModel(s, m);
    expect(result.getDriverValue('pct', 1)).toBeCloseTo(0.3, 6);
    expect(result.getValue('cogs', 1)).toBeCloseTo(60, 6); // 200 * 0.3
  });

  it("days-of defaults to the last actual period's implied day count", () => {
    const s = schema(
      [line('revenue'), line('ar', bin('*', bin('/', driverRef('dso'), num(365)), ref('revenue')))],
      [driver('dso', 'days-of', 'ar', 'revenue')],
    );
    // Last actual: ar=30, revenue=365 -> implied 30 days.
    const m = modelWithTimeline(mixedTimeline, { revenue: [365, 730], ar: [30] });
    const result = evaluateModel(s, m);
    expect(result.getDriverValue('dso', 1)).toBeCloseTo(30, 6);
    expect(result.getValue('ar', 1)).toBeCloseTo(60, 6); // (30/365) * 730
  });

  it('roll-off defaults to 0% (no adjustment yet) when nothing is entered', () => {
    const s = schema(
      [line('cost', call('lastActual', [ref('cost')])), line('ga')],
      [driver('roll', 'roll-off', 'cost', 'ga')],
    );
    const m = modelWithTimeline(mixedTimeline, { cost: [40], ga: [100] });
    const result = evaluateModel(s, m);
    expect(result.getDriverValue('roll', 1)).toBe(0);
  });

  it('actual has no computed default at all (null, not an inferred number)', () => {
    const s = schema([line('cost', driverRef('one-time'))], [driver('one-time', 'hardcode', 'cost')]);
    const m = modelWithTimeline(mixedTimeline, { cost: [40] });
    const result = evaluateModel(s, m);
    expect(result.getDriverValue('one-time', 1)).toBeNull();
    expect(result.getValue('cost', 1)).toBeNull();
  });

  it('an explicit value still overrides the computed default', () => {
    const s = schema(
      [line('revenue', bin('*', call('priorPeriod', [ref('revenue')]), bin('+', num(1), driverRef('g'))))],
      [driver('g', 'growth', 'revenue')],
    );
    const m = modelWithTimeline(mixedTimeline, { revenue: [100] }, { g: [null, 0.2] });
    const result = evaluateModel(s, m);
    expect(result.getDriverValue('g', 1)).toBeCloseTo(0.2, 6);
    expect(result.getValue('revenue', 1)).toBeCloseTo(120, 6);
  });

  it('percent-of/days-of default to null when there is no actual period to imply a ratio from', () => {
    const allProjected: TimelinePeriod[] = [{ id: 'p0', type: 'FY', endDate: '2025-12-31', label: 'FY2025', kind: 'projected' }];
    const s = schema(
      [line('revenue'), line('cogs', bin('*', ref('revenue'), driverRef('pct')))],
      [driver('pct', 'percent-of', 'cogs', 'revenue')],
    );
    const m = modelWithTimeline(allProjected, {});
    const result = evaluateModel(s, m);
    expect(result.getDriverValue('pct', 0)).toBeNull();
  });
});
