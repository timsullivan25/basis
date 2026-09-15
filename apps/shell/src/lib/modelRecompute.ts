import { computedResultRepository, type Model, type Scenario, type ScenarioKey, type StatementSchema } from '../data';
import type { EvaluationResult } from './engine/evaluate';
import { buildComputedResult, computeVersionStamp, materializeEvaluation } from './computedCache';

/** Materializes an already-computed evaluation and writes it to the ComputedResult cache — the
 *  one place every writer (a mapping save, a schema edit, a driver/settings change) refreshes the
 *  cache the same way, so none of them can drift out of sync on the sequence. Kept out of
 *  computedCache.ts itself, which is deliberately repository-free/pure (see computedCache.test.ts).
 *  `evaluation` is taken as a parameter rather than computed here because a scenario's driver
 *  overrides may already be merged into it by the caller (see ModelWorkspaceScreen's own
 *  evaluation memo) — recomputing internally would risk silently dropping that merge. */
export async function recomputeAndCacheModel(
  schema: StatementSchema,
  model: Model,
  evaluation: EvaluationResult,
  scenario: Scenario | null = null,
  scenarioId: ScenarioKey = 'base',
): Promise<void> {
  const materialized = materializeEvaluation(schema, model, evaluation);
  const versionStamp = computeVersionStamp(model, scenario, schema);
  await computedResultRepository.set(buildComputedResult(model.id, scenarioId, versionStamp, materialized));
}
