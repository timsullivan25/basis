import type { DriverDefinition, StatementSchema, Timeline } from '../data';
import { evaluateModel, type EvaluationInput, type EvaluationResult } from './engine/evaluate';
import { findSummaryLine, type SummaryConcept } from './summaryLines';

/**
 * One-at-a-time sensitivity analysis (roadmap phase 1, first slice). Same move scenarios already
 * make — layer different driver values onto the model and call the pure `evaluateModel` — just
 * repeated: each input is stepped through its range with every other driver at the starting case,
 * and each step's full evaluation is kept so any line/period can be read as an output afterwards
 * without re-running anything. The engine itself never learns about sensitivity runs.
 *
 * The "starting case" is whatever driverValues the caller hands in — the model's own (Base) or a
 * scenario's merged map (see lib/scenario.ts's mergeScenarioDriverValues) — so sensitizing a
 * scenario is the same call.
 */

/** 'absolute' adds the shift to the driver's value in its own units (+0.02 to a 5% growth rate
 *  gives 7%; +5 to 45 receivable days gives 50). 'relative' scales it (+0.1 is ×1.1) — the only
 *  sensible shift for a 'hardcode' driver, whose value is an absolute amount of any magnitude. */
export type ShiftKind = 'absolute' | 'relative';

export interface SensitivityInput {
  driverId: string;
  kind: ShiftKind;
  /** The shift at each end of the range (low is usually negative). Applied to every projected
   *  period alike; actual periods are never touched. */
  low: number;
  high: number;
}

/** A model line read at one period — the thing a tornado ranks inputs against. */
export interface SensitivityOutput {
  lineId: string;
  periodIndex: number;
}

export interface SweepPoint {
  shift: number;
  evaluation: EvaluationResult;
}

export interface InputSweep {
  input: SensitivityInput;
  /** Ascending by shift, low end first and high end last; the starting case (shift 0) is not
   *  repeated here — it's the caller's own baseline evaluation. */
  points: SweepPoint[];
}

/** How many evaluations one input gets across its range, both ends included. Only the two ends
 *  feed the tornado; the interior points are there so a spider chart (or a non-monotonic check)
 *  can read them later without a second run. */
export const DEFAULT_STEP_COUNT = 5;

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

/** Every sensitizable driver, each with its suggested range — the default input set. */
export function suggestedInputs(schema: StatementSchema, timeline: Timeline, baseline: EvaluationResult): SensitivityInput[] {
  return sensitizableDrivers(schema, timeline, baseline).map((d) => ({ driverId: d.id, ...suggestedShift(d) }));
}

/** Headline lines offered first as outputs, resolved by concept so they work across schemas. */
export const SUGGESTED_OUTPUT_CONCEPTS: SummaryConcept[] = ['ebitda', 'fcf', 'netLeverage', 'cash', 'netDebt', 'revenue'];

/** The suggested outputs that resolve in this schema, each at the last period of the timeline —
 *  the end of the projection, where a shift applied to every projected period has compounded. */
export function suggestedOutputs(schema: StatementSchema, timeline: Timeline): SensitivityOutput[] {
  if (timeline.length === 0) return [];
  const periodIndex = timeline.length - 1;
  const seen = new Set<string>();
  const outputs: SensitivityOutput[] = [];
  for (const concept of SUGGESTED_OUTPUT_CONCEPTS) {
    const line = findSummaryLine(schema, concept);
    if (!line || seen.has(line.id)) continue;
    seen.add(line.id);
    outputs.push({ lineId: line.id, periodIndex });
  }
  return outputs;
}

/** The value a driver actually takes at a period with `shift` applied. Shifts the EFFECTIVE value
 *  (`baseline.getDriverValue`, which includes the engine's computed default for a blank cell),
 *  not the stored one — a blank growth cell means 0%, so +2 points has to mean 2%, not blank. */
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

/**
 * Runs the one-at-a-time sweep: for each input, one evaluation per step with only that driver
 * shifted. `model.driverValues` is the starting case. Cost is inputs × steps evaluations, which
 * is cheap enough to run synchronously at today's schema sizes (an 11-driver template at 5 steps
 * is 55 evaluations).
 */
export function runOneAtATime(
  schema: StatementSchema,
  model: EvaluationInput,
  baseline: EvaluationResult,
  inputs: SensitivityInput[],
  stepCount = DEFAULT_STEP_COUNT,
): InputSweep[] {
  const driverValues = model.driverValues ?? {};
  return inputs.map((input) => ({
    input,
    points: stepShifts(input.low, input.high, stepCount).map((shift) => ({
      shift,
      evaluation: evaluateModel(schema, {
        ...model,
        driverValues: shiftDriverValues(driverValues, model.timeline, baseline, input.driverId, input.kind, shift),
      }),
    })),
  }));
}

export interface TornadoRow {
  driverId: string;
  /** The output at the low and high ends of this input's range. */
  atLow: number | null;
  atHigh: number | null;
  /** The output's full extent across every step, which is wider than [atLow, atHigh] only when
   *  the response isn't monotonic. */
  min: number | null;
  max: number | null;
  /** max − min; 0 when the output never resolves. What the tornado sorts by. */
  swing: number;
}

/** One output's tornado: every input's swing in that output, largest first. Ties keep input order. */
export function tornadoRows(sweeps: InputSweep[], baseline: EvaluationResult, output: SensitivityOutput): TornadoRow[] {
  const base = baseline.getValue(output.lineId, output.periodIndex);
  const rows = sweeps.map((sweep): TornadoRow => {
    const values = sweep.points.map((p) => p.evaluation.getValue(output.lineId, output.periodIndex));
    const present = [base, ...values].filter((v): v is number => v !== null);
    const min = present.length > 0 ? Math.min(...present) : null;
    const max = present.length > 0 ? Math.max(...present) : null;
    return {
      driverId: sweep.input.driverId,
      atLow: sweep.points.length > 0 ? values[0] : null,
      atHigh: sweep.points.length > 0 ? values[values.length - 1] : null,
      min,
      max,
      swing: min !== null && max !== null ? max - min : 0,
    };
  });
  return rows.map((row, i) => ({ row, i })).sort((a, b) => b.row.swing - a.row.swing || a.i - b.i).map(({ row }) => row);
}
