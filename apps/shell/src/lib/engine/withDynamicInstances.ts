import type { DriverDefinition, LineInstance, StatementLine, StatementSchema } from '../../data';
import { buildActualFormula, buildDaysFormula, buildFlatFormula, buildGrowthFormula, buildRatioFormula, buildRollOffFormula } from './resolve';
import { evaluateModel, type EvaluationInput, type EvaluationResult } from './evaluate';

/** Builds the synthetic StatementLine + (when the method needs one) DriverDefinition for one
 *  instance, using the exact same formula-builders the schema editor's own projection-method UI
 *  already uses for any ordinary line — an instance needs zero new engine capability, it's just
 *  another calculated/driver-projected line. */
function materializeInstance(instance: LineInstance): { line: StatementLine; driver: DriverDefinition | null } {
  const { projection } = instance;
  const line: StatementLine = {
    id: instance.id,
    name: instance.name,
    required: false,
    rowFormat: 'normal',
    numberFormat: 'number',
    sign: 'natural',
    aggregation: 'sum',
    formula:
      projection.method === 'flat'
        ? buildFlatFormula(instance.id)
        : projection.method === 'growth'
          ? buildGrowthFormula(instance.id, projection.driverId)
          : projection.method === 'percent-of'
            ? buildRatioFormula(projection.basisLineId!, projection.driverId)
            : projection.method === 'days-of'
              ? buildDaysFormula(projection.basisLineId!, projection.driverId)
              : projection.method === 'roll-off'
                ? buildRollOffFormula(instance.id, projection.driverId)
                : buildActualFormula(projection.driverId),
    projection,
    aliases: [],
  };
  if (projection.method === 'flat') return { line, driver: null };
  return {
    line,
    driver: {
      id: projection.driverId,
      name: instance.name,
      unit: projection.method === 'days-of' ? 'days' : projection.method === 'actual' ? 'raw' : '%',
      targetLineId: instance.id,
      method: projection.method,
      basisLineId: projection.basisLineId,
    },
  };
}

/** Splices every instance whose target still accepts it into a COPY of the schema, as an
 *  ordinary real StatementLine (+ a real DriverDefinition, for a driver-based projection
 *  method) — this is what lets a sibling-instance basis work: once spliced, instance B's
 *  formula can `ref` instance A's id, because they're both ordinary lines in the SAME schema
 *  copy. An instance whose `lineId`/`sectionId` no longer resolves, or whose target no longer
 *  has the matching flag set (the line/section was deleted, or the flag was cleared since), is
 *  defensively skipped entirely — not spliced in at all — rather than left as an orphaned row
 *  or allowed to break evaluation. */
export function spliceInstanceLines(schema: StatementSchema, instances: LineInstance[]): StatementSchema {
  const copy = structuredClone(schema);
  const extraDrivers: DriverDefinition[] = [];
  // Tracks how many instances have already been spliced in after a given parent, so a second
  // (or third) sibling is appended after the ones already inserted rather than always landing
  // right after the parent — otherwise each new sibling would push every prior one further down,
  // reversing their creation order.
  const insertedCountByParentId = new Map<string, number>();

  for (const instance of instances) {
    const { line, driver } = materializeInstance(instance);

    if (instance.lineId !== undefined) {
      const section = copy.sections.find((s) => s.lines.some((l) => l.id === instance.lineId));
      const parentIndex = section?.lines.findIndex((l) => l.id === instance.lineId) ?? -1;
      if (!section || parentIndex < 0 || !section.lines[parentIndex].allowsSubLines) continue;
      const alreadyInserted = insertedCountByParentId.get(instance.lineId) ?? 0;
      section.lines.splice(parentIndex + 1 + alreadyInserted, 0, line);
      insertedCountByParentId.set(instance.lineId, alreadyInserted + 1);
    } else if (instance.sectionId !== undefined) {
      const section = copy.sections.find((s) => s.id === instance.sectionId);
      if (!section || !section.allowsFreeformLines) continue;
      section.lines.push(line);
    } else {
      continue;
    }

    if (driver) extraDrivers.push(driver);
  }

  copy.drivers = [...copy.drivers, ...extraDrivers];
  return copy;
}

/** Sums a period's instance values the same "ignore blanks" way the engine's own `sum()` formula
 *  function already does (see evaluate.ts's evalNode) — null only when every instance is null
 *  for that period, so a rollup line with instances but no data yet reads as "unknown", not
 *  "zero". */
function sumIgnoringNulls(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null);
  if (present.length === 0) return null;
  return present.reduce((a, b) => a + b, 0);
}

/** For every line with `allowsSubLines` that has ≥1 spliced-in instance, sums those instances'
 *  pass-1 values and writes the result into a historicals COPY at that line's id, for every
 *  period (both actual and projected) — this is what makes a sub-line SUPERSEDE, not blend with,
 *  any direct mapping on its parent line once it exists (see StatementLine.allowsSubLines' own
 *  doc comment). A freeform (KPI-style, sectionId-scoped) instance has no parent line, so it
 *  contributes nothing here — it's simply displayed as its own already-computed row. */
function injectRollups(
  instancedSchema: StatementSchema,
  instances: LineInstance[],
  pass1: EvaluationResult,
  periodCount: number,
  historicals: Record<string, (number | null)[]>,
): Record<string, (number | null)[]> {
  const bySublineParent = new Map<string, LineInstance[]>();
  for (const instance of instances) {
    if (instance.lineId === undefined) continue;
    const group = bySublineParent.get(instance.lineId) ?? [];
    group.push(instance);
    bySublineParent.set(instance.lineId, group);
  }

  const augmented = { ...historicals };
  for (const line of instancedSchema.sections.flatMap((s) => s.lines)) {
    if (!line.allowsSubLines) continue;
    const children = bySublineParent.get(line.id);
    if (!children || children.length === 0) continue;
    augmented[line.id] = Array.from({ length: periodCount }, (_, periodIndex) =>
      sumIgnoringNulls(children.map((c) => pass1.getValue(c.id, periodIndex))),
    );
  }
  return augmented;
}

/** The last 'actual'-kind period, or -1 if there isn't one — same scan evaluate.ts's own
 *  lastActualIndex does (deliberately NOT lib/dcf.ts's own helper of the same name, which falls
 *  back to the timeline's last period instead of -1; that fallback is wrong here, since it would
 *  anchor a roll-off to an arbitrary projected period rather than skipping the contra entirely). */
function lastActualIndex(timeline: EvaluationInput['timeline']): number {
  for (let i = timeline.length - 1; i >= 0; i--) {
    if (timeline[i].kind === 'actual') return i;
  }
  return -1;
}

/** For every 'roll-off' instance, sums the contra amount it rolls onto its basis line for each
 *  PROJECTED period only — `anchor - remaining`, where `anchor` is the instance's own value at
 *  the model's last actual period and `remaining` is its already-computed (pass 1) value for that
 *  period, which equals `anchor * driver%` once buildRollOffFormula's `lastActual(self) * (1 -
 *  driver)` is in effect — so no separate driver-reading logic is needed here, pass 1 already did
 *  the (anchor * (1-driver)) math; this just infers the other half of the same split. Actual
 *  periods are deliberately excluded, not merely expected to net to zero: an instance's own
 *  history isn't flat leading up to the anchor (e.g. 6, 3, 0), so `anchor - remaining` would be
 *  nonzero for an earlier actual period even though roll-off has no business touching it — only
 *  the formula-driven projected periods are the real contra. Multiple roll-off instances
 *  targeting the same basis line accumulate together. Folds into `historicals` (a copy — possibly
 *  already `injectRollups`' own augmented one) the same "explicit value wins" way that function's
 *  rollup totals do, so one final re-evaluation picks up both. */
function injectRollOffContras(
  instances: LineInstance[],
  pass1: EvaluationResult,
  periodCount: number,
  historicals: Record<string, (number | null)[]>,
  lastActualIdx: number,
): Record<string, (number | null)[]> {
  const contraByBasisLine = new Map<string, number[]>();
  for (const instance of instances) {
    if (instance.projection.method !== 'roll-off') continue;
    const { basisLineId } = instance.projection;
    const anchor = lastActualIdx >= 0 ? pass1.getValue(instance.id, lastActualIdx) : null;
    if (!basisLineId || anchor === null) continue;
    const sums = contraByBasisLine.get(basisLineId) ?? new Array(periodCount).fill(0);
    // Strictly PROJECTED periods only — an actual period's own mapped value can differ from
    // `anchor` (the instance's history isn't flat leading up to it), so `anchor - remaining`
    // is only ever the intended roll-off contribution once buildRollOffFormula's formula (not a
    // mapped historical) is actually driving `remaining`, i.e. after lastActualIdx.
    for (let p = lastActualIdx + 1; p < periodCount; p++) {
      const remaining = pass1.getValue(instance.id, p);
      if (remaining !== null) sums[p] += anchor - remaining;
    }
    contraByBasisLine.set(basisLineId, sums);
  }
  if (contraByBasisLine.size === 0) return historicals;

  const augmented = { ...historicals };
  for (const [basisLineId, sums] of contraByBasisLine) {
    augmented[basisLineId] = Array.from({ length: periodCount }, (_, p) => {
      const base = augmented[basisLineId]?.[p] ?? pass1.getValue(basisLineId, p);
      return base === null ? null : base - sums[p];
    });
  }
  return augmented;
}

/**
 * Splices every one of a model's LineInstance rows into a copy of `schema` and evaluates it
 * through the completely unmodified engine — twice. Pass 1 computes each instance's own value
 * (using its own driver/historicals, exactly like any other line, including a sibling-instance
 * basis, since both are ordinary lines in the same schema copy by the time this runs). Pass 2
 * folds two independent overlays into one augmented-historicals patch — `injectRollups`' sums for
 * every `allowsSubLines` line, and `injectRollOffContras`' contra reductions for every roll-off
 * instance's basis line — then re-evaluates once more so everything formula-chained off either
 * (Gross Profit off Revenue, Adjusted EBITDA off Adjusted EBITDA Delta, a lowered G&A run-rate)
 * picks up the correct total via the engine's own unmodified "mapped value always wins" rule — no
 * bridge-specific or segment-specific logic anywhere in here.
 *
 * Returns the spliced `schema` (not the original) so every existing consumer's
 * `schema.sections[].lines` rendering shows instance rows for free, with no row-builder changes.
 */
export function applyDynamicInstances(
  schema: StatementSchema,
  model: EvaluationInput,
  instances: LineInstance[],
): { schema: StatementSchema; evaluation: EvaluationResult } {
  const instancedSchema = spliceInstanceLines(schema, instances);
  const pass1 = evaluateModel(instancedSchema, model);

  const rollupAugmented = injectRollups(instancedSchema, instances, pass1, model.timeline.length, model.historicals);
  const augmentedHistoricals = injectRollOffContras(
    instances, pass1, model.timeline.length, rollupAugmented, lastActualIndex(model.timeline),
  );
  const finalEvaluation = evaluateModel(instancedSchema, { ...model, historicals: augmentedHistoricals });

  return { schema: instancedSchema, evaluation: finalEvaluation };
}
