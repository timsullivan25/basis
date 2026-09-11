import type { AnalysisSettings, DcfInputs, ScenarioKey, Timeline } from '../data';
import type { LineValues } from './computedCache';

/** Mirrors evaluate.ts's own lastActualIndex-style scan — periods are always built/extended so
 *  actuals form a prefix, but this scans defensively rather than assuming that. */
function lastActualIndex(timeline: Timeline): number {
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
