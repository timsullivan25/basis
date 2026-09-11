import type { ComputedResult, ComputedResultVersionStamp, Model, Scenario, ScenarioKey, StatementSchema } from '../data';
import type { EvaluationResult } from './engine/evaluate';

/** The minimal shape a consumer of computed line values actually needs — a structural subset of
 *  EvaluationResult (no getDriverValue; nothing reading a summary/cache needs driver assumptions,
 *  only line values). Satisfied by both a live EvaluationResult and toLineValues's cached-result
 *  adapter below, so a consumer never has to know or care which one it's holding. */
export interface LineValues {
  getValue(lineId: string, periodIndex: number): number | null;
  getError(lineId: string): string | undefined;
}

/** The four fields a computed result's freshness depends on, read live off the current model/
 *  scenario/schema. `scenario` is null for the Base case (no Scenario row to stamp). Falls back to
 *  `createdAt` for any record saved before `updatedAt` (or `instancesUpdatedAt`) existed — same
 *  normalize-at-point-of-use convention this codebase already uses for other fields added after
 *  the fact (e.g. `driverValues ?? {}`), rather than a repository-level migration for a field
 *  that's harmless to default this way. */
export function computeVersionStamp(model: Model, scenario: Scenario | null, schema: StatementSchema): ComputedResultVersionStamp {
  return {
    modelUpdatedAt: model.updatedAt ?? model.createdAt,
    scenarioUpdatedAt: scenario ? (scenario.updatedAt ?? scenario.createdAt) : null,
    schemaUpdatedAt: schema.updatedAt ?? schema.createdAt,
    instancesUpdatedAt: model.instancesUpdatedAt ?? model.createdAt,
  };
}

/** Whether a stored version stamp still matches the CURRENT live model/scenario/schema — a
 *  mismatch means a cache miss (recompute, overwrite), never a user-facing staleness badge. See
 *  ComputedResultVersionStamp's doc comment for why this is the "calculation desync" guard, not
 *  temporal staleness. */
export function versionStampMatches(
  stamp: ComputedResultVersionStamp,
  model: Model,
  scenario: Scenario | null,
  schema: StatementSchema,
): boolean {
  const current = computeVersionStamp(model, scenario, schema);
  return (
    stamp.modelUpdatedAt === current.modelUpdatedAt &&
    stamp.scenarioUpdatedAt === current.scenarioUpdatedAt &&
    stamp.schemaUpdatedAt === current.schemaUpdatedAt &&
    stamp.instancesUpdatedAt === current.instancesUpdatedAt
  );
}

/** Flattens a live EvaluationResult into plain, IndexedDB-serializable records — one entry per
 *  schema line, index-aligned to the model's timeline. EvaluationResult itself is a set of
 *  closures over Maps and can't be persisted directly. */
export function materializeEvaluation(
  schema: StatementSchema,
  model: Model,
  evaluation: EvaluationResult,
): { values: Record<string, (number | null)[]>; errors: Record<string, string> } {
  const values: Record<string, (number | null)[]> = {};
  const errors: Record<string, string> = {};
  for (const line of schema.sections.flatMap((s) => s.lines)) {
    values[line.id] = model.timeline.map((_, i) => evaluation.getValue(line.id, i));
    const error = evaluation.getError(line.id);
    if (error !== undefined) errors[line.id] = error;
  }
  return { values, errors };
}

/** Assembles the persistable record from a fresh materialization — the one place `id` and
 *  `computedAt` get set, so every writer builds the same shape. */
export function buildComputedResult(
  modelId: string,
  scenarioId: ScenarioKey,
  versionStamp: ComputedResultVersionStamp,
  materialized: { values: Record<string, (number | null)[]>; errors: Record<string, string> },
): ComputedResult {
  return {
    id: `${modelId}:${scenarioId}`,
    modelId,
    scenarioId,
    ...materialized,
    versionStamp,
    computedAt: new Date().toISOString(),
  };
}

/** Adapts a stored ComputedResult to the same LineValues shape a live EvaluationResult already
 *  satisfies structurally — so a consumer (e.g. SummaryPanel) never branches on live-vs-cached. */
export function toLineValues(result: ComputedResult): LineValues {
  return {
    getValue: (lineId, periodIndex) => result.values[lineId]?.[periodIndex] ?? null,
    getError: (lineId) => result.errors[lineId],
  };
}
