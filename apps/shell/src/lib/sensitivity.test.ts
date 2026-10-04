import { describe, expect, it } from 'vitest';
import { evaluateModel } from './engine/evaluate';
import {
  runOneAtATime,
  sensitizableDrivers,
  shiftDriverValues,
  stepShifts,
  suggestedInputs,
  suggestedOutputs,
  suggestedShift,
  tornadoRows,
} from './sensitivity';
import type { DriverDefinition, Model, ProjectionMethod, ResolvedFormula, StatementLine, StatementSchema, TimelinePeriod } from '../data';

function line(id: string, formula: ResolvedFormula | null = null, extra: Partial<StatementLine> = {}): StatementLine {
  return {
    id, name: id, role: 'optional', rowFormat: 'normal', numberFormat: 'number', sign: 'natural', aggregation: 'sum',
    formula, projection: null, aliases: [], ...extra,
  };
}
const ref = (lineId: string): ResolvedFormula => ({ kind: 'ref', lineId });
const driverRef = (driverId: string): ResolvedFormula => ({ kind: 'driverRef', driverId });
const bin = (op: '+' | '-' | '*' | '/', left: ResolvedFormula, right: ResolvedFormula): ResolvedFormula => ({ kind: 'bin', op, left, right });
const prior = (arg: ResolvedFormula): ResolvedFormula => ({ kind: 'call', fn: 'priorPeriod', args: [arg] });

function driver(id: string, method: ProjectionMethod, targetLineId: string, basisLineId?: string): DriverDefinition {
  return { id, name: id, unit: method === 'days-of' ? 'days' : '%', targetLineId, method, basisLineId };
}

/** Revenue grows by `g`; EBITDA is `m` of revenue; Capex is a hardcoded amount; Cash is EBITDA
 *  less Capex. Two actual periods, two projected. */
function fixture(driverValues: Record<string, (number | null)[]> = {}) {
  const schema: StatementSchema = {
    id: 's', name: 'Test', createdAt: '', updatedAt: '',
    sections: [{
      id: 'sec', name: 'Section',
      lines: [
        line('Revenue', bin('*', prior(ref('Revenue')), bin('+', { kind: 'num', value: 1 }, driverRef('g')))),
        line('EBITDA', bin('*', ref('Revenue'), driverRef('m'))),
        line('Capex', driverRef('c')),
        line('Cash Flow', bin('-', ref('EBITDA'), ref('Capex')), { role: 'calculated' }),
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
  return { schema, model, baseline: evaluateModel(schema, model) };
}

describe('suggestedShift', () => {
  it('moves rates by 2 points, days by 5 and hardcoded amounts by 10%', () => {
    expect(suggestedShift(driver('a', 'growth', 'x'))).toEqual({ kind: 'absolute', low: -0.02, high: 0.02 });
    expect(suggestedShift(driver('a', 'days-of', 'x', 'y'))).toEqual({ kind: 'absolute', low: -5, high: 5 });
    expect(suggestedShift(driver('a', 'hardcode', 'x'))).toEqual({ kind: 'relative', low: -0.1, high: 0.1 });
  });
});

describe('stepShifts', () => {
  it('spaces steps evenly across the range, ends included, without repeating the baseline', () => {
    const shifts = stepShifts(-0.02, 0.02, 5);
    expect(shifts).toHaveLength(4);
    [-0.02, -0.01, 0.01, 0.02].forEach((expected, i) => expect(shifts[i]).toBeCloseTo(expected));
    expect(shifts[0]).toBe(-0.02);
    expect(shifts[3]).toBe(0.02);
    expect(stepShifts(-1, 1, 2)).toEqual([-1, 1]);
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

describe('suggestedInputs / sensitizableDrivers', () => {
  it('skips a hardcode driver with nothing entered', () => {
    const { schema, model, baseline } = fixture({ c: [null, null, null, null] });
    expect(sensitizableDrivers(schema, model.timeline, baseline).map((d) => d.id)).toEqual(['g', 'm']);
  });

  it('skips a driver whose target line sums sub-lines', () => {
    const { schema, model, baseline } = fixture();
    schema.sections[0].lines.push(line('Revenue A', null, { parentLineId: 'Revenue' }));
    expect(suggestedInputs(schema, model.timeline, baseline).map((i) => i.driverId)).toEqual(['m', 'c']);
  });
});

describe('suggestedOutputs', () => {
  it('resolves headline concepts at the last period', () => {
    const { schema, model } = fixture();
    expect(suggestedOutputs(schema, model.timeline)).toEqual([
      { lineId: 'EBITDA', periodIndex: 3 },
      { lineId: 'Revenue', periodIndex: 3 },
    ]);
  });
});

describe('runOneAtATime + tornadoRows', () => {
  it('moves only the swept driver and ranks inputs by output swing', () => {
    const { schema, model, baseline } = fixture();
    const inputs = suggestedInputs(schema, model.timeline, baseline);
    const sweeps = runOneAtATime(schema, model, baseline, inputs, 3);
    // Base cash flow at the last period: revenue 121, EBITDA 24.2, capex 6 → 18.2.
    expect(baseline.getValue('Cash Flow', 3)).toBeCloseTo(18.2);

    const rows = tornadoRows(sweeps, baseline, { lineId: 'Cash Flow', periodIndex: 3 });
    expect(rows.map((r) => r.driverId)).toEqual(['m', 'g', 'c']);

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
    const { schema, model, baseline } = fixture();
    const sweeps = runOneAtATime(schema, model, baseline, [{ driverId: 'c', kind: 'absolute', low: 0, high: 1 }], 2);
    const [row] = tornadoRows(sweeps, baseline, { lineId: 'Cash Flow', periodIndex: 3 });
    expect(row.max).toBeCloseTo(18.2);
    expect(row.min).toBeCloseTo(17.2);

    const [missing] = tornadoRows(sweeps, baseline, { lineId: 'Nope', periodIndex: 3 });
    expect(missing.swing).toBe(0);
    expect(missing.min).toBeNull();
  });
});
