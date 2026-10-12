import type { AnalysisResult, AnalysisResultVersionStamp, DcfOutput, LboOutput, Model, Scenario, ScenarioKey, StatementSchema } from '../data';

/** Whichever record an analysis's own inputs live in — AnalysisSettings for DCF's WACC/terminal
 *  growth, LboCase for LBO's financing — reduced to just the two fields this module needs, so it
 *  depends on neither type directly (any analysis's own inputs record satisfies this shape). */
export interface AnalysisInputsRecord {
  updatedAt: string;
  createdAt: string;
}

/** The four fields an AnalysisResult's freshness depends on — a sibling to computedCache.ts's
 *  computeVersionStamp, not a call to it, so ComputedResultVersionStamp's own 3-field consumers
 *  stay untouched. `scenario` is null for the Base case, same convention. */
export function computeAnalysisVersionStamp(
  model: Model,
  scenario: Scenario | null,
  schema: StatementSchema,
  inputs: AnalysisInputsRecord,
): AnalysisResultVersionStamp {
  return {
    modelUpdatedAt: model.updatedAt ?? model.createdAt,
    scenarioUpdatedAt: scenario ? (scenario.updatedAt ?? scenario.createdAt) : null,
    schemaUpdatedAt: schema.updatedAt ?? schema.createdAt,
    inputsUpdatedAt: inputs.updatedAt ?? inputs.createdAt,
  };
}

export function analysisVersionStampMatches(
  stamp: AnalysisResultVersionStamp,
  model: Model,
  scenario: Scenario | null,
  schema: StatementSchema,
  inputs: AnalysisInputsRecord,
): boolean {
  const current = computeAnalysisVersionStamp(model, scenario, schema, inputs);
  return (
    stamp.modelUpdatedAt === current.modelUpdatedAt &&
    stamp.scenarioUpdatedAt === current.scenarioUpdatedAt &&
    stamp.schemaUpdatedAt === current.schemaUpdatedAt &&
    stamp.inputsUpdatedAt === current.inputsUpdatedAt
  );
}

/** Assembles the persistable record from a fresh DcfOutput/LboOutput — the one place `id` and
 *  `computedAt` get set, mirroring computedCache.ts's buildComputedResult. */
export function buildAnalysisResult(
  modelId: string,
  scenarioId: ScenarioKey,
  analysisId: string,
  versionStamp: AnalysisResultVersionStamp,
  output: DcfOutput | LboOutput,
): AnalysisResult {
  return {
    id: `${modelId}:${scenarioId}:${analysisId}`,
    modelId,
    scenarioId,
    analysisId,
    output,
    versionStamp,
    computedAt: new Date().toISOString(),
  };
}
