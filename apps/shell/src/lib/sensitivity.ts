import type { DriverDefinition, LineNumberFormat, StatementSchema, Timeline } from '../data';
import { evaluateModel, type EvaluationInput, type EvaluationResult } from './engine/evaluate';
import { findSummaryLine, type SummaryConcept } from './summaryLines';
import {
  analysisInputId,
  analysisParamFor,
  availableAnalysisMetrics,
  availableAnalysisParams,
  NO_ANALYSIS_PARAMS,
  type AnalysisContext,
  type AnalysisParams,
} from './sensitivityAnalyses';

/**
 * Sensitivity analysis (roadmap phase 1). The same move scenarios already make — layer different
 * driver values onto the model and call the pure `evaluateModel` — repeated: shift some inputs,
 * evaluate, read outputs. The engine itself never learns about sensitivity runs.
 *
 * An input is a model driver or an analysis assumption (lib/sensitivityAnalyses.ts). An output is
 * a model line at a period or an analysis result. Every run produces CasePoints — one evaluated
 * combination of shifts — and any output can be read off any point afterwards without re-running
 * anything, so switching the output picker is free.
 *
 * Three ways to combine inputs, all built on `evaluateCase`:
 * - one at a time (`runOneAtATime`), feeding a tornado;
 * - a two-way grid over two inputs (`runGrid`), the classic data table;
 * - Monte Carlo (`runMonteCarlo`), every input sampled at once, summarized as a distribution.
 *
 * The starting case is whatever the caller hands in — the model's own driver values or a
 * scenario's merged map, and that scenario's analysis assumptions.
 */

/** 'absolute' adds the shift to the value in its own units (+0.02 to a 5% growth rate gives 7%;
 *  +5 to 45 receivable days gives 50; +0.5 to a 4.0x leverage multiple gives 4.5x). 'relative'
 *  scales it (+0.1 is ×1.1) — the sensible shift for an amount of any magnitude, such as a
 *  'hardcode' driver. */
export type ShiftKind = 'absolute' | 'relative';

/** How Monte Carlo draws a shift from an input's [low, high] range. 'normal' centres on the
 *  midpoint with low and high two standard deviations out (about 95% of draws land inside);
 *  'triangular' peaks at no shift (clamped into the range). */
export type Distribution = 'uniform' | 'triangular' | 'normal';

export interface SensitivityInput {
  /** A driver id, or an analysis assumption's id (see sensitivityAnalyses.ts's analysisInputId). */
  id: string;
  kind: ShiftKind;
  /** The shift at each end of the range (low is usually negative). A driver shift applies to every
   *  projected period alike; actual periods are never touched. */
  low: number;
  high: number;
  distribution: Distribution;
}

export type SensitivityOutput =
  | { kind: 'line'; lineId: string; periodIndex: number }
  | { kind: 'analysis'; metricId: string };

/** Everything a run needs: the starting case and how to read analysis results. */
export interface SensitivityContext {
  schema: StatementSchema;
  /** The starting case's model inputs (timeline, historicals, driver values). */
  model: EvaluationInput;
  /** `model` evaluated. */
  baseline: EvaluationResult;
  /** Null when no analysis is enabled. */
  analysis: AnalysisContext | null;
}

/** One evaluated combination of shifts. */
export interface CasePoint {
  /** Input id → shift applied. Inputs absent here sit at the starting case. */
  shifts: Record<string, number>;
  evaluation: EvaluationResult;
  params: AnalysisParams;
}

export interface SweepPoint extends CasePoint {
  shift: number;
}

export interface InputSweep {
  input: SensitivityInput;
  /** Ascending by shift, low end first and high end last; the starting case (shift 0) is not
   *  repeated here. */
  points: SweepPoint[];
}

/** How many evaluations one input gets across its range, both ends included. Only the two ends
 *  feed the tornado; the interior points are there for a later spider chart. */
export const DEFAULT_STEP_COUNT = 5;

// --- Inputs ------------------------------------------------------------------------------------

/** The range offered for a driver before the user edits it. Rates and ratios move ±2 points,
 *  days ±5 days, hardcoded amounts ±10% of themselves. */
export function suggestedShift(driver: DriverDefinition): Pick<SensitivityInput, 'kind' | 'low' | 'high'> {
  switch (driver.method) {
    case 'days-of':
      return { kind: 'absolute', low: -5, high: 5 };
    case 'hardcode':
      return { kind: 'relative', low: -0.1, high: 0.1 };
    default:
      return { kind: 'absolute', low: -0.02, high: 0.02 };
  }
}

function projectedIndices(timeline: Timeline): number[] {
  return timeline.flatMap((p, i) => (p.kind === 'projected' ? [i] : []));
}

/** Drivers worth sensitizing: one with a value somewhere in the projection (a blank 'hardcode'
 *  driver has nothing to shift) whose target line isn't a parent summing its sub-lines (that
 *  driver is superseded — shifting it would always show zero swing). */
export function sensitizableDrivers(schema: StatementSchema, timeline: Timeline, baseline: EvaluationResult): DriverDefinition[] {
  const parentIds = new Set(schema.sections.flatMap((s) => s.lines).flatMap((l) => (l.parentLineId ? [l.parentLineId] : [])));
  const projected = projectedIndices(timeline);
  return (schema.drivers ?? []).filter(
    (d) => !parentIds.has(d.targetLineId) && projected.some((i) => baseline.getDriverValue(d.id, i) !== null),
  );
}

/** One row of the inputs table: a driver or an analysis assumption, with its suggested range. */
export interface InputOption {
  id: string;
  label: string;
  /** 'Drivers' or the analysis's name — the inputs table's grouping. */
  group: string;
  /** The value at the starting case (a driver's first projected period). */
  baseValue: number | null;
  numberFormat: LineNumberFormat;
  /** What a shift is entered in: 'pp' for a rate moving absolutely, 'days', 'x' for a multiple,
   *  '%' for a relative shift. */
  shiftUnit: 'pp' | 'days' | 'x' | '%';
  suggested: SensitivityInput;
}

const ANALYSIS_GROUP: Record<string, string> = { dcf: 'DCF', lbo: 'LBO', recoveryWaterfall: 'Recovery Waterfall' };

function shiftUnitFor(kind: ShiftKind, numberFormat: LineNumberFormat, isDays: boolean): InputOption['shiftUnit'] {
  if (kind === 'relative') return '%';
  if (isDays) return 'days';
  return numberFormat === 'multiple' ? 'x' : 'pp';
}

/** Every input offered: sensitizable drivers first, then assumptions of enabled analyses. */
export function inputOptions(ctx: SensitivityContext): InputOption[] {
  const firstProjected = ctx.model.timeline.findIndex((p) => p.kind === 'projected');
  const drivers = sensitizableDrivers(ctx.schema, ctx.model.timeline, ctx.baseline).map((driver): InputOption => {
    const shift = suggestedShift(driver);
    const numberFormat: LineNumberFormat = driver.method === 'days-of' || driver.method === 'hardcode' ? 'number' : 'percentage';
    return {
      id: driver.id,
      label: driver.name,
      group: 'Drivers',
      baseValue: firstProjected >= 0 ? ctx.baseline.getDriverValue(driver.id, firstProjected) : null,
      numberFormat,
      shiftUnit: shiftUnitFor(shift.kind, numberFormat, driver.method === 'days-of'),
      suggested: { id: driver.id, ...shift, distribution: 'triangular' },
    };
  });
  const params = availableAnalysisParams(ctx.analysis).map((def): InputOption => ({
    id: analysisInputId(def.id),
    label: def.label,
    group: ANALYSIS_GROUP[def.analysisId] ?? def.analysisId,
    baseValue: def.read(ctx.analysis!.base),
    numberFormat: def.numberFormat,
    shiftUnit: shiftUnitFor(def.kind, def.numberFormat, false),
    suggested: { id: analysisInputId(def.id), kind: def.kind, low: def.low, high: def.high, distribution: 'triangular' },
  }));
  return [...drivers, ...params];
}

// --- Outputs -----------------------------------------------------------------------------------

/** Headline lines offered first as outputs, resolved by concept so they work across schemas. */
export const SUGGESTED_OUTPUT_CONCEPTS: SummaryConcept[] = ['ebitda', 'fcf', 'netLeverage', 'cash', 'netDebt', 'revenue'];

/** The suggested line outputs that resolve in this schema, each at the last period of the
 *  timeline — the end of the projection, where a shift applied to every projected period has
 *  compounded. */
export function suggestedOutputs(schema: StatementSchema, timeline: Timeline): SensitivityOutput[] {
  if (timeline.length === 0) return [];
  const periodIndex = timeline.length - 1;
  const seen = new Set<string>();
  const outputs: SensitivityOutput[] = [];
  for (const concept of SUGGESTED_OUTPUT_CONCEPTS) {
    const line = findSummaryLine(schema, concept);
    if (!line || seen.has(line.id)) continue;
    seen.add(line.id);
    outputs.push({ kind: 'line', lineId: line.id, periodIndex });
  }
  return outputs;
}

/** An output's name and how its values display. */
export function describeOutput(ctx: SensitivityContext, output: SensitivityOutput): { label: string; numberFormat: LineNumberFormat } | null {
  if (output.kind === 'line') {
    const line = ctx.schema.sections.flatMap((s) => s.lines).find((l) => l.id === output.lineId);
    const period = ctx.model.timeline[output.periodIndex];
    return line ? { label: `${line.name}, ${period?.label ?? ''}`.trim(), numberFormat: line.numberFormat } : null;
  }
  const metric = availableAnalysisMetrics(ctx.analysis).find((m) => m.id === output.metricId);
  return metric ? { label: metric.label, numberFormat: metric.numberFormat } : null;
}

/** A reader for one output, resolved once so reading it off hundreds of points stays cheap. */
export function outputReader(ctx: SensitivityContext, output: SensitivityOutput): (point: CasePoint) => number | null {
  if (output.kind === 'line') return (point) => point.evaluation.getValue(output.lineId, output.periodIndex);
  const analysis = ctx.analysis;
  const metric = analysis ? availableAnalysisMetrics(analysis).find((m) => m.id === output.metricId) : undefined;
  if (!analysis || !metric) return () => null;
  return (point) => metric.compute(analysis, point.evaluation, point.params);
}

export function readOutput(ctx: SensitivityContext, point: CasePoint, output: SensitivityOutput): number | null {
  return outputReader(ctx, output)(point);
}

// --- Evaluating a case -------------------------------------------------------------------------

/** The value an input actually takes with `shift` applied. Driver shifts move the EFFECTIVE value
 *  (`baseline.getDriverValue`, which includes the engine's computed default for a blank cell), not
 *  the stored one — a blank growth cell means 0%, so +2 points has to mean 2%, not blank. */
function shiftedValue(base: number | null, kind: ShiftKind, shift: number): number | null {
  if (base === null) return null;
  return kind === 'absolute' ? base + shift : base * (1 + shift);
}

/** `driverValues` with one driver's projected periods replaced by its shifted effective values.
 *  Actual periods keep whatever was stored (the engine never reads a driver there anyway). */
export function shiftDriverValues(
  driverValues: Record<string, (number | null)[]>,
  timeline: Timeline,
  baseline: EvaluationResult,
  driverId: string,
  kind: ShiftKind,
  shift: number,
): Record<string, (number | null)[]> {
  const stored = driverValues[driverId] ?? [];
  const values = timeline.map((period, i) =>
    period.kind === 'projected' ? shiftedValue(baseline.getDriverValue(driverId, i), kind, shift) : (stored[i] ?? null),
  );
  return { ...driverValues, [driverId]: values };
}

/** The starting case as a point — what every tornado bar and grid cell is measured against. */
export function basePoint(ctx: SensitivityContext): CasePoint {
  return { shifts: {}, evaluation: ctx.baseline, params: ctx.analysis?.base ?? NO_ANALYSIS_PARAMS };
}

/** Evaluates the starting case with every given input shifted at once. Re-evaluates the model only
 *  when a driver moves; a case that only moves analysis assumptions reuses the baseline evaluation. */
export function evaluateCase(ctx: SensitivityContext, inputs: SensitivityInput[], shifts: number[]): CasePoint {
  let driverValues = ctx.model.driverValues ?? {};
  let params = ctx.analysis?.base ?? NO_ANALYSIS_PARAMS;
  let driverMoved = false;
  const applied: Record<string, number> = {};
  inputs.forEach((input, i) => {
    const shift = shifts[i];
    applied[input.id] = shift;
    const param = analysisParamFor(input.id);
    if (param) {
      const base = param.read(params);
      const next = shiftedValue(base, input.kind, shift);
      if (next !== null) params = param.write(params, next);
      return;
    }
    driverValues = shiftDriverValues(driverValues, ctx.model.timeline, ctx.baseline, input.id, input.kind, shift);
    driverMoved = true;
  });
  const evaluation = driverMoved ? evaluateModel(ctx.schema, { ...ctx.model, driverValues }) : ctx.baseline;
  return { shifts: applied, evaluation, params };
}

// --- One at a time -----------------------------------------------------------------------------

/** `stepCount` evenly spaced shifts from low to high, both ends included, skipping an exact 0
 *  (the baseline is already known). */
export function stepShifts(low: number, high: number, stepCount = DEFAULT_STEP_COUNT): number[] {
  const count = Math.max(2, stepCount);
  const shifts: number[] = [];
  for (let i = 0; i < count; i++) {
    // The last step is `high` itself rather than an interpolation, so the range's ends are exact.
    const shift = i === count - 1 ? high : low + ((high - low) * i) / (count - 1);
    if (Math.abs(shift) > 1e-12) shifts.push(shift);
  }
  return shifts;
}

/** Steps each input through its range with everything else at the starting case. Cost is
 *  inputs × steps evaluations — cheap enough to run synchronously (one evaluation of the bundled
 *  template takes about half a millisecond). */
export function runOneAtATime(ctx: SensitivityContext, inputs: SensitivityInput[], stepCount = DEFAULT_STEP_COUNT): InputSweep[] {
  return inputs.map((input) => ({
    input,
    points: stepShifts(input.low, input.high, stepCount).map((shift) => ({ ...evaluateCase(ctx, [input], [shift]), shift })),
  }));
}

export interface TornadoRow {
  inputId: string;
  /** The output at the low and high ends of this input's range. */
  atLow: number | null;
  atHigh: number | null;
  /** The output's full extent across every step and the starting case — wider than
   *  [atLow, atHigh] only when the response isn't monotonic. */
  min: number | null;
  max: number | null;
  /** max − min; 0 when the output never resolves. What the tornado sorts by. */
  swing: number;
}

/** One output's tornado: every input's swing in that output, largest first. Ties keep input order. */
export function tornadoRows(ctx: SensitivityContext, sweeps: InputSweep[], output: SensitivityOutput): TornadoRow[] {
  const read = outputReader(ctx, output);
  const base = read(basePoint(ctx));
  const rows = sweeps.map((sweep): TornadoRow => {
    const values = sweep.points.map(read);
    const present = [base, ...values].filter((v): v is number => v !== null);
    const min = present.length > 0 ? Math.min(...present) : null;
    const max = present.length > 0 ? Math.max(...present) : null;
    return {
      inputId: sweep.input.id,
      atLow: sweep.points.length > 0 ? values[0] : null,
      atHigh: sweep.points.length > 0 ? values[values.length - 1] : null,
      min,
      max,
      swing: min !== null && max !== null ? max - min : 0,
    };
  });
  return rows.map((row, i) => ({ row, i })).sort((a, b) => b.row.swing - a.row.swing || a.i - b.i).map(({ row }) => row);
}

// --- Two-way grid ------------------------------------------------------------------------------

export interface GridRun {
  rowInput: SensitivityInput;
  colInput: SensitivityInput;
  /** Include 0 (the starting case) so the base cell sits in the grid. */
  rowShifts: number[];
  colShifts: number[];
  /** cells[r][c] has rowShifts[r] and colShifts[c] applied together. */
  cells: CasePoint[][];
}

/** `count` evenly spaced shifts across [low, high] with 0 inserted if the range straddles it, so
 *  the grid always contains the starting case. */
export function gridShifts(low: number, high: number, count = DEFAULT_STEP_COUNT): number[] {
  const n = Math.max(2, count);
  const shifts = Array.from({ length: n }, (_, i) => (i === n - 1 ? high : low + ((high - low) * i) / (n - 1)));
  const rounded = shifts.map((s) => (Math.abs(s) < 1e-12 ? 0 : s));
  if (low < 0 && high > 0 && !rounded.includes(0)) rounded.push(0);
  return rounded.sort((a, b) => a - b);
}

/** Varies two inputs together over every combination of their steps — interactions included,
 *  which a tornado can't show. */
export function runGrid(ctx: SensitivityContext, rowInput: SensitivityInput, colInput: SensitivityInput, count = DEFAULT_STEP_COUNT): GridRun {
  const rowShifts = gridShifts(rowInput.low, rowInput.high, count);
  const colShifts = gridShifts(colInput.low, colInput.high, count);
  const cells = rowShifts.map((r) => colShifts.map((c) => evaluateCase(ctx, [rowInput, colInput], [r, c])));
  return { rowInput, colInput, rowShifts, colShifts, cells };
}

// --- Monte Carlo -------------------------------------------------------------------------------

export const DEFAULT_TRIALS = 1000;
export const DEFAULT_SEED = 1;

/** mulberry32 — a small seeded PRNG, so the same seed reproduces the same run. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One draw of a shift from the input's range, per its distribution. */
export function sampleShift(input: Pick<SensitivityInput, 'low' | 'high' | 'distribution'>, random: () => number): number {
  const { low, high } = input;
  if (high <= low) return low;
  switch (input.distribution) {
    case 'uniform':
      return low + (high - low) * random();
    case 'triangular': {
      const mode = Math.min(Math.max(0, low), high);
      const u = random();
      const cut = (mode - low) / (high - low);
      return u < cut ? low + Math.sqrt(u * (high - low) * (mode - low)) : high - Math.sqrt((1 - u) * (high - low) * (high - mode));
    }
    case 'normal': {
      // Box–Muller; 1 - random() keeps the log argument in (0, 1].
      const z = Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
      return (low + high) / 2 + z * ((high - low) / 4);
    }
  }
}

/** Samples every input at once, independently (no correlation between inputs yet), `trials`
 *  times. */
export function runMonteCarlo(ctx: SensitivityContext, inputs: SensitivityInput[], trials = DEFAULT_TRIALS, seed = DEFAULT_SEED): CasePoint[] {
  const random = seededRandom(seed);
  const points: CasePoint[] = [];
  for (let t = 0; t < trials; t++) {
    points.push(evaluateCase(ctx, inputs, inputs.map((input) => sampleShift(input, random))));
  }
  return points;
}

export interface DistributionSummary {
  /** Trials where the output resolved; the rest (null) are counted in `unresolved`. */
  count: number;
  unresolved: number;
  mean: number;
  min: number;
  max: number;
  p5: number;
  p50: number;
  p95: number;
  bins: Array<{ from: number; to: number; count: number }>;
}

/** Linear-interpolated percentile of an ascending array. */
function percentile(sorted: number[], p: number): number {
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Mean, spread, percentiles and an equal-width histogram of one output across a run. Null when
 *  the output never resolved. */
export function summarizeDistribution(values: (number | null)[], binCount = 24): DistributionSummary | null {
  const present = values.filter((v): v is number => v !== null).sort((a, b) => a - b);
  if (present.length === 0) return null;
  const min = present[0];
  const max = present[present.length - 1];
  const width = (max - min) / binCount;
  const bins = Array.from({ length: binCount }, (_, i) => ({ from: min + width * i, to: i === binCount - 1 ? max : min + width * (i + 1), count: 0 }));
  for (const v of present) {
    const i = width === 0 ? 0 : Math.min(binCount - 1, Math.floor((v - min) / width));
    bins[i].count++;
  }
  return {
    count: present.length,
    unresolved: values.length - present.length,
    mean: present.reduce((a, b) => a + b, 0) / present.length,
    min,
    max,
    p5: percentile(present, 0.05),
    p50: percentile(present, 0.5),
    p95: percentile(present, 0.95),
    bins: width === 0 ? [{ from: min, to: max, count: present.length }] : bins,
  };
}

/** Share of resolved trials where the output is below (or above) a threshold — e.g. the chance
 *  leverage breaches a covenant. Null when nothing resolved. */
export function probabilityBeyond(values: (number | null)[], threshold: number, direction: 'below' | 'above'): number | null {
  const present = values.filter((v): v is number => v !== null);
  if (present.length === 0) return null;
  const hits = present.filter((v) => (direction === 'below' ? v < threshold : v > threshold)).length;
  return hits / present.length;
}
