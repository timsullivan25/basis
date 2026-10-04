import { describe, expect, it } from 'vitest';
import { evaluateModel } from './engine/evaluate';
import {
  basePoint,
  evaluateCase,
  gridShifts,
  inputOptions,
  probabilityBeyond,
  readOutput,
  runGrid,
  runMonteCarlo,
  runOneAtATime,
  sampleShift,
  seededRandom,
  sensitizableDrivers,
  shiftDriverValues,
  stepShifts,
  suggestedOutputs,
  suggestedShift,
  summarizeDistribution,
  tornadoRows,
  type SensitivityContext,
  type SensitivityInput,
} from './sensitivity';
import { analysisInputId, availableAnalysisMetrics, NO_ANALYSIS_PARAMS, type AnalysisContext } from './sensitivityAnalyses';
import type { DriverDefinition, Model, ProjectionMethod, ResolvedFormula, StatementLine, StatementSchema, TimelinePeriod } from '../data';

function line(id: string, formula: ResolvedFormula | null = null, extra: Partial<StatementLine> = {}): StatementLine {
  return {
    id, name: id, role: 'optional', rowFormat: 'normal', numberFormat: 'number', sign: 'natural', aggregation: 'sum',
    formula, projection: null, aliases: [], ...extra,
  };
}
const ref = (lineId: string): ResolvedFormula => ({ kind: 'ref', lineId });
const num = (value: number): ResolvedFormula => ({ kind: 'num', value });
const driverRef = (driverId: string): ResolvedFormula => ({ kind: 'driverRef', driverId });
const bin = (op: '+' | '-' | '*' | '/', left: ResolvedFormula, right: ResolvedFormula): ResolvedFormula => ({ kind: 'bin', op, left, right });
const prior = (arg: ResolvedFormula): ResolvedFormula => ({ kind: 'call', fn: 'priorPeriod', args: [arg] });

function driver(id: string, method: ProjectionMethod, targetLineId: string, basisLineId?: string): DriverDefinition {
  return { id, name: id, unit: method === 'days-of' ? 'days' : '%', targetLineId, method, basisLineId };
}

/** Revenue grows by `g`; EBITDA is `m` of revenue; Capex is a hardcoded amount; Cash Flow is
 *  EBITDA less Capex. The DCF lines (EBIT = EBITDA, no D&A, no tax, flat NWC) make UFCF equal
 *  Cash Flow. Two actual periods, two projected. */
function fixture(driverValues: Record<string, (number | null)[]> = {}) {
  const schema: StatementSchema = {
    id: 's', name: 'Test', createdAt: '', updatedAt: '',
    sections: [{
      id: 'sec', name: 'Section',
      lines: [
        line('Revenue', bin('*', prior(ref('Revenue')), bin('+', num(1), driverRef('g')))),
        line('EBITDA', bin('*', ref('Revenue'), driverRef('m'))),
        line('Capex', driverRef('c')),
        line('Cash Flow', bin('-', ref('EBITDA'), ref('Capex')), { role: 'calculated' }),
        line('EBIT', ref('EBITDA'), { role: 'calculated' }),
        line('D&A', num(0), { role: 'calculated' }),
        line('Net Working Capital', num(0), { role: 'calculated' }),
        line('Tax Rate', num(0), { role: 'calculated' }),
        line('Net Debt', num(50), { role: 'calculated' }),
      ],
    }],
    drivers: [driver('g', 'growth', 'Revenue'), driver('m', 'percent-of', 'EBITDA', 'Revenue'), driver('c', 'hardcode', 'Capex')],
  };
  const timeline: TimelinePeriod[] = [0, 1, 2, 3].map((i) => ({
    id: `p${i}`, type: 'FY', endDate: `202${i}-12-31`, label: `FY 202${i}`, kind: i < 2 ? 'actual' : 'projected',
  }));
  const model: Model = {
    id: 'm', companyId: 'c', name: 'M', statementSchemaId: 's', modelImportId: 'i', mappingId: 'map',
    timeline,
    historicals: { Revenue: [90, 100, null, null], EBITDA: [18, 20, null, null], Capex: [5, 5, null, null] },
    driverValues: { g: [null, null, 0.1, 0.1], c: [null, null, 6, 6], ...driverValues },
    createdAt: '', updatedAt: '',
  };
  const baseline = evaluateModel(schema, model);
  const ctx: SensitivityContext = { schema, model, baseline, analysis: null };
  return { schema, model, baseline, ctx };
}

function withDcf(ctx: SensitivityContext): SensitivityContext {
  const analysis: AnalysisContext = {
    schema: ctx.schema, timeline: ctx.model.timeline, scenarioId: 'base', enabledIds: ['dcf'], lboCase: null,
    base: { ...NO_ANALYSIS_PARAMS, dcf: { wacc: 0.1, terminalGrowth: 0.02 } },
  };
  return { ...ctx, analysis };
}

const input = (id: string, low: number, high: number, extra: Partial<SensitivityInput> = {}): SensitivityInput => ({
  id, kind: 'absolute', low, high, distribution: 'uniform', ...extra,
});

describe('suggestedShift', () => {
  it('moves rates by 2 points, days by 5 and hardcoded amounts by 10%', () => {
    expect(suggestedShift(driver('a', 'growth', 'x'))).toEqual({ kind: 'absolute', low: -0.02, high: 0.02 });
    expect(suggestedShift(driver('a', 'days-of', 'x', 'y'))).toEqual({ kind: 'absolute', low: -5, high: 5 });
    expect(suggestedShift(driver('a', 'hardcode', 'x'))).toEqual({ kind: 'relative', low: -0.1, high: 0.1 });
  });
});

describe('stepShifts / gridShifts', () => {
  it('spaces steps evenly across the range, ends exact, without repeating the baseline', () => {
    const shifts = stepShifts(-0.02, 0.02, 5);
    expect(shifts).toHaveLength(4);
    [-0.02, -0.01, 0.01, 0.02].forEach((expected, i) => expect(shifts[i]).toBeCloseTo(expected));
    expect(shifts[0]).toBe(-0.02);
    expect(shifts[3]).toBe(0.02);
  });

  it('grid steps always include the starting case', () => {
    expect(gridShifts(-1, 1, 5)).toEqual([-1, -0.5, 0, 0.5, 1]);
    expect(gridShifts(-1, 1, 4)).toHaveLength(5);
    expect(gridShifts(-1, 1, 4)).toContain(0);
  });
});

describe('shiftDriverValues', () => {
  it('shifts the effective value, so a blank percent-of cell shifts from its implied ratio', () => {
    const { model, baseline } = fixture();
    // m is blank everywhere; the engine defaults it to the last actual ratio, 20 / 100.
    const shifted = shiftDriverValues(model.driverValues, model.timeline, baseline, 'm', 'absolute', 0.02);
    expect(shifted.m[2]).toBeCloseTo(0.22);
    expect(shifted.m[3]).toBeCloseTo(0.22);
    expect(shifted.m[0]).toBeNull();
    expect(shifted.g).toBe(model.driverValues.g);
  });

  it('scales a relative shift', () => {
    const { model, baseline } = fixture();
    const shifted = shiftDriverValues(model.driverValues, model.timeline, baseline, 'c', 'relative', -0.1);
    expect(shifted.c[2]).toBeCloseTo(5.4);
  });
});

describe('inputOptions / sensitizableDrivers', () => {
  it('skips a hardcode driver with nothing entered', () => {
    const { schema, model, baseline } = fixture({ c: [null, null, null, null] });
    expect(sensitizableDrivers(schema, model.timeline, baseline).map((d) => d.id)).toEqual(['g', 'm']);
  });

  it('skips a driver whose target line sums sub-lines', () => {
    const { ctx } = fixture();
    ctx.schema.sections[0].lines.push(line('Revenue A', null, { parentLineId: 'Revenue' }));
    expect(inputOptions(ctx).map((o) => o.id)).toEqual(['m', 'c']);
  });

  it('adds assumptions of enabled analyses after the drivers', () => {
    const options = inputOptions(withDcf(fixture().ctx));
    expect(options.map((o) => o.id)).toEqual(['g', 'm', 'c', analysisInputId('dcf.wacc'), analysisInputId('dcf.terminalGrowth')]);
    const wacc = options[3];
    expect(wacc).toMatchObject({ group: 'DCF', baseValue: 0.1, shiftUnit: 'pp', suggested: { low: -0.01, high: 0.01 } });
    expect(options[2].shiftUnit).toBe('%');
  });
});

describe('suggestedOutputs', () => {
  it('resolves headline concepts at the last period', () => {
    const { schema, model } = fixture();
    expect(suggestedOutputs(schema, model.timeline)).toEqual([
      { kind: 'line', lineId: 'EBITDA', periodIndex: 3 },
      { kind: 'line', lineId: 'Net Debt', periodIndex: 3 },
      { kind: 'line', lineId: 'Revenue', periodIndex: 3 },
    ]);
  });
});

describe('one at a time + tornado', () => {
  it('moves only the swept driver and ranks inputs by output swing', () => {
    const { ctx } = fixture();
    const inputs = inputOptions(ctx).map((o) => o.suggested);
    const sweeps = runOneAtATime(ctx, inputs, 3);
    // Base cash flow at the last period: revenue 121, EBITDA 24.2, capex 6 → 18.2.
    expect(ctx.baseline.getValue('Cash Flow', 3)).toBeCloseTo(18.2);

    const rows = tornadoRows(ctx, sweeps, { kind: 'line', lineId: 'Cash Flow', periodIndex: 3 });
    expect(rows.map((r) => r.inputId)).toEqual(['m', 'g', 'c']);

    const margin = rows[0];
    expect(margin.atLow).toBeCloseTo(121 * 0.18 - 6);
    expect(margin.atHigh).toBeCloseTo(121 * 0.22 - 6);
    expect(margin.swing).toBeCloseTo(121 * 0.04);

    const growth = rows[1];
    expect(growth.atLow).toBeCloseTo(100 * 1.08 * 1.08 * 0.2 - 6);
    expect(growth.atHigh).toBeCloseTo(100 * 1.12 * 1.12 * 0.2 - 6);

    // Capex up lowers cash flow: the high end of the input is the low end of the output.
    const capex = rows[2];
    expect(capex.atHigh).toBeCloseTo(24.2 - 6.6);
    expect(capex.min).toBeCloseTo(24.2 - 6.6);
    expect(capex.max).toBeCloseTo(24.2 - 5.4);
  });

  it('includes the baseline in min/max, and gives a never-resolving output zero swing', () => {
    const { ctx } = fixture();
    const sweeps = runOneAtATime(ctx, [input('c', 0, 1)], 2);
    const [row] = tornadoRows(ctx, sweeps, { kind: 'line', lineId: 'Cash Flow', periodIndex: 3 });
    expect(row.max).toBeCloseTo(18.2);
    expect(row.min).toBeCloseTo(17.2);

    const [missing] = tornadoRows(ctx, sweeps, { kind: 'line', lineId: 'Nope', periodIndex: 3 });
    expect(missing.swing).toBe(0);
    expect(missing.min).toBeNull();
  });
});

describe('analysis inputs and outputs', () => {
  const ev = { kind: 'analysis', metricId: 'dcf.enterpriseValue' } as const;

  it('reads DCF results off a point, and moving WACC moves EV without re-evaluating the model', () => {
    const ctx = withDcf(fixture().ctx);
    expect(availableAnalysisMetrics(ctx.analysis).map((m) => m.id)).toEqual(['dcf.enterpriseValue', 'dcf.equityValue']);
    const base = readOutput(ctx, basePoint(ctx), ev)!;
    expect(base).toBeGreaterThan(0);
    expect(readOutput(ctx, basePoint(ctx), { kind: 'analysis', metricId: 'dcf.equityValue' })).toBeCloseTo(base - 50);

    const higherWacc = evaluateCase(ctx, [input(analysisInputId('dcf.wacc'), -0.01, 0.01)], [0.01]);
    expect(higherWacc.evaluation).toBe(ctx.baseline);
    expect(higherWacc.params.dcf?.wacc).toBeCloseTo(0.11);
    expect(readOutput(ctx, higherWacc, ev)!).toBeLessThan(base);
  });

  it('keeps analysis results separate for points that share params but not evaluations', () => {
    const ctx = withDcf(fixture().ctx);
    const higherMargin = evaluateCase(ctx, [input('m', -0.02, 0.02)], [0.02]);
    expect(higherMargin.params).toBe(ctx.analysis!.base);
    expect(readOutput(ctx, higherMargin, ev)!).toBeGreaterThan(readOutput(ctx, basePoint(ctx), ev)!);
  });

  it('ranks WACC alongside drivers in a tornado of EV', () => {
    const ctx = withDcf(fixture().ctx);
    const inputs = inputOptions(ctx).map((o) => o.suggested);
    const rows = tornadoRows(ctx, runOneAtATime(ctx, inputs, 2), ev);
    expect(rows.map((r) => r.inputId)).toContain(analysisInputId('dcf.wacc'));
    const wacc = rows.find((r) => r.inputId === analysisInputId('dcf.wacc'))!;
    expect(wacc.atLow!).toBeGreaterThan(wacc.atHigh!);
  });
});

describe('Recovery Waterfall as an analysis', () => {
  it('shifts the distributable value and reads each tranche recovery rate', () => {
    const { ctx } = fixture();
    ctx.schema.sections[0].lines.push(line('Term Loan', num(100), { role: 'calculated', lineKind: 'debt', debtProperties: {} }));
    const analysis: AnalysisContext = {
      schema: ctx.schema, timeline: ctx.model.timeline, scenarioId: 'base', enabledIds: ['recoveryWaterfall'], lboCase: null,
      base: { ...NO_ANALYSIS_PARAMS, recovery: { method: 'direct', multiple: null, periodIndex: null, directValue: 80, adminCosts: null } },
    };
    const rctx = { ...ctx, baseline: evaluateModel(ctx.schema, ctx.model), analysis };
    const pct = { kind: 'analysis', metricId: 'recovery.pct.Term Loan' } as const;
    expect(inputOptions(rctx).map((o) => o.id)).toContain(analysisInputId('recovery.directValue'));
    expect(readOutput(rctx, basePoint(rctx), pct)).toBeCloseTo(0.8);
    const lower = evaluateCase(rctx, [input(analysisInputId('recovery.directValue'), -0.2, 0.2, { kind: 'relative' })], [-0.2]);
    expect(readOutput(rctx, lower, pct)).toBeCloseTo(0.64);
  });
});

describe('runGrid', () => {
  it('evaluates every combination, with the starting case in the middle', () => {
    const { ctx } = fixture();
    const grid = runGrid(ctx, input('m', -0.02, 0.02), input('c', -1, 1), 3);
    expect(grid.rowShifts).toEqual([-0.02, 0, 0.02]);
    expect(grid.colShifts).toEqual([-1, 0, 1]);
    const value = (r: number, c: number) => grid.cells[r][c].evaluation.getValue('Cash Flow', 3);
    expect(value(1, 1)).toBeCloseTo(18.2);
    expect(value(2, 0)).toBeCloseTo(121 * 0.22 - 5);
    expect(value(0, 2)).toBeCloseTo(121 * 0.18 - 7);
  });
});

describe('Monte Carlo', () => {
  it('draws within range for uniform and triangular, centred for normal', () => {
    const random = seededRandom(42);
    for (let i = 0; i < 500; i++) {
      const u = sampleShift({ low: -1, high: 2, distribution: 'uniform' }, random);
      const t = sampleShift({ low: -1, high: 2, distribution: 'triangular' }, random);
      expect(u).toBeGreaterThanOrEqual(-1);
      expect(u).toBeLessThanOrEqual(2);
      expect(t).toBeGreaterThanOrEqual(-1);
      expect(t).toBeLessThanOrEqual(2);
    }
    const normals = Array.from({ length: 4000 }, () => sampleShift({ low: -2, high: 2, distribution: 'normal' }, random));
    const mean = normals.reduce((a, b) => a + b, 0) / normals.length;
    const sd = Math.sqrt(normals.reduce((a, b) => a + (b - mean) ** 2, 0) / normals.length);
    expect(mean).toBeCloseTo(0, 1);
    expect(sd).toBeCloseTo(1, 1);
  });

  it('is reproducible for a seed and moves every input at once', () => {
    const { ctx } = fixture();
    const inputs = [input('m', -0.02, 0.02), input('c', -1, 1)];
    const a = runMonteCarlo(ctx, inputs, 20, 7);
    const b = runMonteCarlo(ctx, inputs, 20, 7);
    const values = (points: typeof a) => points.map((p) => p.evaluation.getValue('Cash Flow', 3));
    expect(values(a)).toEqual(values(b));
    expect(Object.keys(a[0].shifts)).toEqual(['m', 'c']);
    for (const v of values(a)) {
      expect(v!).toBeGreaterThanOrEqual(121 * 0.18 - 7 - 1e-9);
      expect(v!).toBeLessThanOrEqual(121 * 0.22 - 5 + 1e-9);
    }
  });

  it('summarizes a distribution and threshold probabilities', () => {
    const values = [...Array.from({ length: 100 }, (_, i) => i + 1), null];
    const summary = summarizeDistribution(values, 10)!;
    expect(summary.count).toBe(100);
    expect(summary.unresolved).toBe(1);
    expect(summary.mean).toBeCloseTo(50.5);
    expect(summary.p50).toBeCloseTo(50.5);
    expect(summary.p5).toBeCloseTo(5.95);
    expect(summary.p95).toBeCloseTo(95.05);
    expect(summary.bins.reduce((a, b) => a + b.count, 0)).toBe(100);
    expect(probabilityBeyond(values, 10.5, 'below')).toBeCloseTo(0.1);
    expect(probabilityBeyond(values, 90, 'above')).toBeCloseTo(0.1);
    expect(summarizeDistribution([null])).toBeNull();
  });
});
