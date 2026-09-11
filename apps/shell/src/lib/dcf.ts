import type { AnalysisSettings, DcfInputs, ScenarioKey, Timeline } from '../data';
import type { LineValues } from './computedCache';

/** Mirrors evaluate.ts's own lastActualIndex-style scan — periods are always built/extended so
 *  actuals form a prefix, but this scans defensively rather than assuming that. Exported so a
 *  caller resolving Net Debt for the equity-value bridge reads it at the same index this module
 *  itself treats as "now." */
export function lastActualIndex(timeline: Timeline): number {
  for (let i = timeline.length - 1; i >= 0; i--) {
    if (timeline[i].kind === 'actual') return i;
  }
  return timeline.length - 1;
}

/** The four resolved statement-line ids DCF's UFCF build-up reads, plus the resolved tax-rate
 *  line — one per lib/summaryLines.ts SummaryConcept the DCF analysis catalog entry requires. */
export interface DcfConceptLines {
  ebit: string;
  da: string;
  capex: string;
  nwc: string;
  taxRate: string;
}

export interface DcfUfcfRow {
  periodIndex: number;
  ebit: number | null;
  taxRate: number | null;
  nopat: number | null;
  da: number | null;
  capex: number | null;
  deltaNwc: number | null;
  ufcf: number | null;
}

/**
 * The unlevered FCF build-up, one row per PROJECTED period only (a valuation looks forward from
 * the last actual, never restates history). `result` is anything LineValues-shaped — a live
 * EvaluationResult or a cached ComputedResult adapted via toLineValues, same as SummaryPanel and
 * the snapshot viewer already consume — so this never touches the engine's graph directly (see
 * this phase's plan for why: EV/the sensitivity grid don't fit a (lineId, periodIndex)-keyed
 * graph, so DCF reads computed values rather than contributing formula nodes).
 */
export function computeUfcf(result: LineValues, timeline: Timeline, conceptLines: DcfConceptLines): DcfUfcfRow[] {
  const lastActual = lastActualIndex(timeline);
  const taxRateAtLastActual = result.getValue(conceptLines.taxRate, lastActual);
  const rows: DcfUfcfRow[] = [];
  timeline.forEach((period, i) => {
    if (period.kind !== 'projected') return;
    const ebit = result.getValue(conceptLines.ebit, i);
    const da = result.getValue(conceptLines.da, i);
    const capex = result.getValue(conceptLines.capex, i);
    const nwc = result.getValue(conceptLines.nwc, i);
    const priorNwc = result.getValue(conceptLines.nwc, i - 1);
    const deltaNwc = nwc !== null && priorNwc !== null ? nwc - priorNwc : null;
    // Falls back to the resolved tax-rate line's own last-actual value when it has no value at
    // this projected period — the common case, since most schemas won't separately project
    // Income Tax Expense/Pretax Income — mirroring evaluate.ts's own "last-actual-implied-ratio"
    // convention for percent-of/days-of driver defaults, rather than inventing new fallback logic.
    const taxRate = result.getValue(conceptLines.taxRate, i) ?? taxRateAtLastActual;
    const nopat = ebit !== null && taxRate !== null ? ebit * (1 - taxRate) : null;
    const ufcf =
      nopat !== null && da !== null && capex !== null && deltaNwc !== null ? nopat + da - capex - deltaNwc : null;
    rows.push({ periodIndex: i, ebit, taxRate, nopat, da, capex, deltaNwc, ufcf });
  });
  return rows;
}

/** A scenario's effective WACC/terminal-growth — 'base' is ground truth, a named scenario's
 *  entry is sparse against it (per-field, not whole-record — see AnalysisSettings.dcfInputs'
 *  own doc comment for why), same shape as lib/scenario.ts's mergeScenarioDriverValues at
 *  2-scalar-fields-not-N-periods scale. */
export function effectiveDcfInputs(settings: AnalysisSettings, scenarioId: ScenarioKey): DcfInputs {
  const base = settings.dcfInputs.base ?? { wacc: null, terminalGrowth: null };
  if (scenarioId === 'base') return base;
  const override = settings.dcfInputs[scenarioId];
  return {
    wacc: override?.wacc ?? base.wacc,
    terminalGrowth: override?.terminalGrowth ?? base.terminalGrowth,
  };
}

const MS_PER_DAY = 86_400_000;

/** Parses an endDate into UTC milliseconds without a Date constructor's local-timezone
 *  interpretation — same convention evaluate.ts's own toUTCMillis uses. Duplicated rather than
 *  imported: evaluate.ts doesn't export it, and summaryLines.ts's own normalize() doc comment
 *  already documents this codebase's preference for a small duplicated private util over reaching
 *  across an unrelated module boundary for one.
 *
 *  Unlike evaluate.ts's copy, this one has to tolerate TWO endDate shapes actually seen in this
 *  data: a plain "YYYY-MM-DD" for projected periods (lib/periodTimeline.ts's extendTimeline) and
 *  a full ISO datetime like "2025-12-31T00:00:00.000Z" for parsed/actual periods (the workbook
 *  import path) — confirmed live against a real model, not assumed. DCF is the first thing that
 *  ever diffs an ACTUAL period's date against a PROJECTED one (the valuation-date exponent), which
 *  is exactly the mixed-format comparison neither existing date-math caller in this codebase had
 *  to do before. Slicing to the first 10 characters before splitting on "-" normalizes both. */
function toUTCMillis(endDate: string): number {
  const [y, m, d] = endDate.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function daysBetween(fromDate: string, toDate: string): number {
  return (toUTCMillis(toDate) - toUTCMillis(fromDate)) / MS_PER_DAY;
}

export interface DcfOutputs {
  /** Index-aligned with the ufcfRows this was computed from. */
  discountFactors: (number | null)[];
  presentValueOfUfcf: number | null;
  terminalValue: number | null;
  presentValueOfTerminalValue: number | null;
  enterpriseValue: number | null;
  netDebt: number | null;
  equityValue: number | null;
}

const emptyDcfOutputs = (ufcfRows: DcfUfcfRow[], netDebt: number | null): DcfOutputs => ({
  discountFactors: ufcfRows.map(() => null),
  presentValueOfUfcf: null,
  terminalValue: null,
  presentValueOfTerminalValue: null,
  enterpriseValue: null,
  netDebt,
  equityValue: null,
});

/**
 * Enterprise/equity value from an already-computed UFCF build-up. Only PROJECTED periods are
 * discounted, from the model's last ACTUAL period's endDate — the valuation date. Calendar-aware
 * (fractional years via actual calendar dates, not naive integer period-counting), matching this
 * codebase's own precedent for date math (evaluate.ts's findPriorYear). Requires WACC and
 * terminal growth both set and WACC > terminal growth, and every UFCF row populated — a partial
 * or invalid input returns an all-null DcfOutputs (never Infinity/NaN) rather than a
 * half-computed number.
 */
export function computeDcfOutputs(
  ufcfRows: DcfUfcfRow[],
  timeline: Timeline,
  inputs: DcfInputs,
  netDebt: number | null,
): DcfOutputs {
  const { wacc, terminalGrowth } = inputs;
  if (wacc === null || terminalGrowth === null || wacc <= terminalGrowth || ufcfRows.length === 0) {
    return emptyDcfOutputs(ufcfRows, netDebt);
  }
  if (ufcfRows.some((row) => row.ufcf === null)) {
    return emptyDcfOutputs(ufcfRows, netDebt);
  }

  const valuationDate = timeline[lastActualIndex(timeline)].endDate;
  const discountFactors = ufcfRows.map((row) => {
    const exponent = daysBetween(valuationDate, timeline[row.periodIndex].endDate) / 365.25;
    return 1 / Math.pow(1 + wacc, exponent);
  });

  const presentValueOfUfcf = ufcfRows.reduce((sum, row, i) => sum + (row.ufcf as number) * discountFactors[i]!, 0);
  const lastUfcf = ufcfRows[ufcfRows.length - 1].ufcf as number;
  const terminalValue = (lastUfcf * (1 + terminalGrowth)) / (wacc - terminalGrowth);
  const presentValueOfTerminalValue = terminalValue * discountFactors[discountFactors.length - 1]!;
  const enterpriseValue = presentValueOfUfcf + presentValueOfTerminalValue;
  const equityValue = netDebt !== null ? enterpriseValue - netDebt : null;

  return { discountFactors, presentValueOfUfcf, terminalValue, presentValueOfTerminalValue, enterpriseValue, netDebt, equityValue };
}

export interface SensitivityCell {
  wacc: number;
  terminalGrowth: number;
  enterpriseValue: number | null;
}

export interface SensitivityGrid {
  waccValues: number[];
  terminalGrowthValues: number[];
  /** rows[i][j] is the cell for waccValues[i] × terminalGrowthValues[j]. */
  rows: SensitivityCell[][];
}

const WACC_STEPS_PCT = [-1, -0.5, 0, 0.5, 1];
const GROWTH_STEPS_PCT = [-0.5, -0.25, 0, 0.25, 0.5];

/**
 * A small grid of WACC × terminal-growth around the current inputs. Each cell independently
 * recomputes terminal value AND re-guards WACC > terminal growth via computeDcfOutputs — terminal
 * value is itself a function of both inputs, so reusing one center-case TV and only re-discounting
 * would silently make every off-diagonal cell wrong; guarding only the center pair would miss a
 * cell that's individually invalid even when the center is fine.
 */
export function computeSensitivityGrid(
  ufcfRows: DcfUfcfRow[],
  timeline: Timeline,
  centerWacc: number,
  centerTerminalGrowth: number,
): SensitivityGrid {
  const waccValues = WACC_STEPS_PCT.map((pct) => centerWacc + pct / 100);
  const terminalGrowthValues = GROWTH_STEPS_PCT.map((pct) => centerTerminalGrowth + pct / 100);
  const rows = waccValues.map((wacc) =>
    terminalGrowthValues.map((terminalGrowth) => ({
      wacc,
      terminalGrowth,
      enterpriseValue: computeDcfOutputs(ufcfRows, timeline, { wacc, terminalGrowth }, null).enterpriseValue,
    })),
  );
  return { waccValues, terminalGrowthValues, rows };
}
