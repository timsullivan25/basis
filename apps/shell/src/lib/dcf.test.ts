import { describe, expect, it } from 'vitest';
import { computeDcfOutputs, computeSensitivityGrid, computeUfcf, effectiveDcfInputs, type DcfConceptLines, type DcfUfcfRow } from './dcf';
import type { LineValues } from './computedCache';
import type { AnalysisSettings, Timeline, TimelinePeriod } from '../data';

function period(id: string, kind: TimelinePeriod['kind']): TimelinePeriod {
  return { id, type: 'FY', endDate: `${id}-12-31`, label: id, kind };
}

function lineValues(values: Record<string, (number | null)[]>): LineValues {
  return {
    getValue: (lineId, periodIndex) => values[lineId]?.[periodIndex] ?? null,
    getError: () => undefined,
  };
}

const concepts: DcfConceptLines = { ebit: 'ebit', da: 'da', capex: 'capex', nwc: 'nwc', taxRate: 'taxRate' };

describe('computeUfcf', () => {
  it('produces one row per PROJECTED period only, skipping actuals', () => {
    const timeline: Timeline = [period('2023', 'actual'), period('2024', 'actual'), period('2025', 'projected')];
    const result = lineValues({
      ebit: [100, 110, 120],
      da: [10, 11, 12],
      capex: [8, 9, 10],
      nwc: [20, 22, 24],
      taxRate: [0.2, 0.21, null],
    });
    const rows = computeUfcf(result, timeline, concepts);
    expect(rows).toHaveLength(1);
    expect(rows[0].periodIndex).toBe(2);
  });

  it('computes NOPAT, ΔNWC and UFCF correctly for a fully-populated projected period', () => {
    const timeline: Timeline = [period('2023', 'actual'), period('2024', 'projected')];
    const result = lineValues({
      ebit: [100, 120],
      da: [10, 12],
      capex: [8, 10],
      nwc: [20, 25],
      taxRate: [0.2, null], // falls back to last actual (0.2) since projected period has no value
    });
    const rows = computeUfcf(result, timeline, concepts);
    // taxRate = 0.2 (fallback); NOPAT = 120 * (1-0.2) = 96; ΔNWC = 25-20 = 5; UFCF = 96+12-10-5 = 93
    expect(rows[0].taxRate).toBe(0.2);
    expect(rows[0].nopat).toBeCloseTo(96);
    expect(rows[0].deltaNwc).toBe(5);
    expect(rows[0].ufcf).toBeCloseTo(93);
  });

  it('uses a genuinely projected tax rate value when the schema has one, not the fallback', () => {
    const timeline: Timeline = [period('2023', 'actual'), period('2024', 'projected')];
    const result = lineValues({
      ebit: [100, 120],
      da: [10, 12],
      capex: [8, 10],
      nwc: [20, 25],
      taxRate: [0.2, 0.25],
    });
    const rows = computeUfcf(result, timeline, concepts);
    expect(rows[0].taxRate).toBe(0.25);
    expect(rows[0].nopat).toBeCloseTo(90);
  });

  it('yields a null UFCF (not a garbage number) when any required input is null', () => {
    const timeline: Timeline = [period('2023', 'actual'), period('2024', 'projected')];
    const result = lineValues({
      ebit: [100, null],
      da: [10, 12],
      capex: [8, 10],
      nwc: [20, 25],
      taxRate: [0.2, null],
    });
    const rows = computeUfcf(result, timeline, concepts);
    expect(rows[0].ufcf).toBeNull();
  });

  it('yields a null ΔNWC/UFCF for the first projected period when there is no prior period at all', () => {
    const timeline: Timeline = [period('2024', 'projected')];
    const result = lineValues({
      ebit: [100],
      da: [10],
      capex: [8],
      nwc: [20],
      taxRate: [0.2],
    });
    const rows = computeUfcf(result, timeline, concepts);
    expect(rows[0].deltaNwc).toBeNull();
    expect(rows[0].ufcf).toBeNull();
  });
});

describe('effectiveDcfInputs', () => {
  function settings(dcfInputs: AnalysisSettings['dcfInputs']): AnalysisSettings {
    return { id: 'm1', modelId: 'm1', enabledAnalysisIds: ['dcf'], dcfInputs, createdAt: 't0', updatedAt: 't0' };
  }

  it("returns Base's own values for the 'base' scenario key", () => {
    const s = settings({ base: { wacc: 0.1, terminalGrowth: 0.03 } });
    expect(effectiveDcfInputs(s, 'base')).toEqual({ wacc: 0.1, terminalGrowth: 0.03 });
  });

  it('falls back to Base per-field when a named scenario has no entry at all', () => {
    const s = settings({ base: { wacc: 0.1, terminalGrowth: 0.03 } });
    expect(effectiveDcfInputs(s, 'downside')).toEqual({ wacc: 0.1, terminalGrowth: 0.03 });
  });

  it('overrides only the field a named scenario actually set, cascading the other from Base', () => {
    const s = settings({
      base: { wacc: 0.1, terminalGrowth: 0.03 },
      downside: { wacc: 0.12, terminalGrowth: null },
    });
    expect(effectiveDcfInputs(s, 'downside')).toEqual({ wacc: 0.12, terminalGrowth: 0.03 });
  });
});

function ufcfRow(periodIndex: number, ufcf: number | null): DcfUfcfRow {
  return { periodIndex, ebit: null, taxRate: null, nopat: null, da: null, capex: null, deltaNwc: null, ufcf };
}

describe('computeDcfOutputs', () => {
  // One actual period, one projected period exactly one calendar year later — so the discount
  // exponent is (very close to) exactly 1, making the expected numbers hand-checkable.
  const timeline: Timeline = [period('2024', 'actual'), period('2025', 'projected')];

  it('returns an all-null result when WACC or terminal growth is unset', () => {
    const out = computeDcfOutputs([ufcfRow(1, 100)], timeline, { wacc: null, terminalGrowth: 0.02 }, 50);
    expect(out.enterpriseValue).toBeNull();
    expect(out.equityValue).toBeNull();
    expect(out.discountFactors).toEqual([null]);
  });

  it('returns an all-null result when WACC does not exceed terminal growth', () => {
    const out = computeDcfOutputs([ufcfRow(1, 100)], timeline, { wacc: 0.05, terminalGrowth: 0.05 }, 50);
    expect(out.enterpriseValue).toBeNull();
    const out2 = computeDcfOutputs([ufcfRow(1, 100)], timeline, { wacc: 0.04, terminalGrowth: 0.05 }, 50);
    expect(out2.enterpriseValue).toBeNull();
  });

  it('returns an all-null result when any UFCF row is null, rather than a partial sum', () => {
    const out = computeDcfOutputs([ufcfRow(1, 100), ufcfRow(1, null)], timeline, { wacc: 0.1, terminalGrowth: 0.02 }, 50);
    expect(out.enterpriseValue).toBeNull();
    expect(out.presentValueOfUfcf).toBeNull();
  });

  it('computes EV = PV(UFCF) + PV(terminal value), and equity value = EV − net debt', () => {
    const out = computeDcfOutputs([ufcfRow(1, 100)], timeline, { wacc: 0.1, terminalGrowth: 0.02 }, 50);
    // exponent ≈ 1 (365 days / 365.25) — close enough to hand-check against the standard formulas.
    const exponent = 365 / 365.25;
    const discountFactor = 1 / Math.pow(1.1, exponent);
    const terminalValue = (100 * 1.02) / (0.1 - 0.02);
    const expectedEV = 100 * discountFactor + terminalValue * discountFactor;
    expect(out.discountFactors[0]).toBeCloseTo(discountFactor, 6);
    expect(out.terminalValue).toBeCloseTo(terminalValue, 6);
    expect(out.enterpriseValue).toBeCloseTo(expectedEV, 6);
    expect(out.equityValue).toBeCloseTo(expectedEV - 50, 6);
  });

  it('leaves equity value null when net debt is unresolved, even though EV still computes', () => {
    const out = computeDcfOutputs([ufcfRow(1, 100)], timeline, { wacc: 0.1, terminalGrowth: 0.02 }, null);
    expect(out.enterpriseValue).not.toBeNull();
    expect(out.equityValue).toBeNull();
  });

  // Regression: real parsed/actual periods store endDate as a full ISO datetime
  // ("2025-12-31T00:00:00.000Z", from the workbook import path), while extendTimeline's projected
  // periods store a plain "YYYY-MM-DD" — confirmed live against a real model. DCF is the first
  // thing that diffs an actual period's date against a projected one (the valuation-date
  // exponent), which silently produced NaN everywhere before toUTCMillis normalized both shapes.
  it('discounts correctly when the last actual period uses a full ISO-datetime endDate', () => {
    const isoTimeline: Timeline = [
      { id: 'a', type: 'FY', endDate: '2025-12-31T00:00:00.000Z', label: '2025', kind: 'actual' },
      { id: 'b', type: 'FY', endDate: '2026-12-31', label: '2026', kind: 'projected' },
    ];
    const out = computeDcfOutputs([ufcfRow(1, 100)], isoTimeline, { wacc: 0.1, terminalGrowth: 0.02 }, 50);
    expect(out.enterpriseValue).not.toBeNull();
    expect(Number.isNaN(out.enterpriseValue)).toBe(false);
    expect(out.discountFactors[0]).not.toBeNull();
    expect(Number.isNaN(out.discountFactors[0])).toBe(false);
  });
});

describe('computeSensitivityGrid', () => {
  const timeline: Timeline = [period('2024', 'actual'), period('2025', 'projected')];
  const rows = [ufcfRow(1, 100)];

  it('produces a 5x5 grid centered on the given WACC/terminal growth', () => {
    const grid = computeSensitivityGrid(rows, timeline, 0.1, 0.02);
    expect(grid.waccValues).toHaveLength(5);
    expect(grid.terminalGrowthValues).toHaveLength(5);
    expect(grid.rows).toHaveLength(5);
    expect(grid.rows[0]).toHaveLength(5);
    expect(grid.waccValues[2]).toBeCloseTo(0.1, 6);
    expect(grid.terminalGrowthValues[2]).toBeCloseTo(0.02, 6);
  });

  it("the center cell's enterprise value matches computeDcfOutputs for the same inputs directly", () => {
    const grid = computeSensitivityGrid(rows, timeline, 0.1, 0.02);
    const direct = computeDcfOutputs(rows, timeline, { wacc: 0.1, terminalGrowth: 0.02 }, null);
    expect(grid.rows[2][2].enterpriseValue).toBeCloseTo(direct.enterpriseValue as number, 6);
  });

  it('blanks a cell independently when its own WACC/terminal-growth pair is invalid, even if the center is fine', () => {
    // Center WACC 0.5%, growth centered on 0% — WACC ranges -0.5%..+1.5%, growth ranges -0.5%..+0.5%.
    // The lowest-WACC/highest-growth corner (-0.5%, +0.5%) has wacc <= terminalGrowth even though
    // the exact center (0.5%, 0%) is valid.
    const grid = computeSensitivityGrid(rows, timeline, 0.005, 0);
    expect(grid.rows[2][2].enterpriseValue).not.toBeNull(); // center: wacc 0.5%, g 0%
    const firstRow = grid.rows[0]; // lowest WACC row (-0.5%)
    const invalidCell = firstRow[firstRow.length - 1]; // highest growth column (+0.5%)
    expect(invalidCell.wacc).toBeLessThanOrEqual(invalidCell.terminalGrowth);
    expect(invalidCell.enterpriseValue).toBeNull();
  });
});
