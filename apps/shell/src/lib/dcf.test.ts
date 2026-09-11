import { describe, expect, it } from 'vitest';
import { computeUfcf, effectiveDcfInputs, type DcfConceptLines } from './dcf';
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
