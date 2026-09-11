import type {
  AnalysisResult,
  AnalysisResultVersionStamp,
  AnalysisSettings,
  DcfOutput,
  Model,
  Scenario,
  ScenarioKey,
  StatementSchema,
} from '../data';

/** The four fields an AnalysisResult's freshness depends on — a sibling to computedCache.ts's
 *  computeVersionStamp, not a call to it, so ComputedResultVersionStamp's own 3-field consumers
 *  stay untouched. `scenario` is null for the Base case, same convention. */
export function computeAnalysisVersionStamp(
  model: Model,
  scenario: Scenario | null,
  schema: StatementSchema,
  analysisSettings: AnalysisSettings,
): AnalysisResultVersionStamp {
  return {
    modelUpdatedAt: model.updatedAt ?? model.createdAt,
    scenarioUpdatedAt: scenario ? (scenario.updatedAt ?? scenario.createdAt) : null,
    schemaUpdatedAt: schema.updatedAt ?? schema.createdAt,
    analysisSettingsUpdatedAt: analysisSettings.updatedAt ?? analysisSettings.createdAt,
  };
}

export function analysisVersionStampMatches(
  stamp: AnalysisResultVersionStamp,
  model: Model,
  scenario: Scenario | null,
  schema: StatementSchema,
  analysisSettings: AnalysisSettings,
): boolean {
  const current = computeAnalysisVersionStamp(model, scenario, schema, analysisSettings);
  return (
    stamp.modelUpdatedAt === current.modelUpdatedAt &&
    stamp.scenarioUpdatedAt === current.scenarioUpdatedAt &&
    stamp.schemaUpdatedAt === current.schemaUpdatedAt &&
    stamp.analysisSettingsUpdatedAt === current.analysisSettingsUpdatedAt
  );
}

/** Assembles the persistable record from a fresh DcfOutput — the one place `id` and `computedAt`
 *  get set, mirroring computedCache.ts's buildComputedResult. */
export function buildAnalysisResult(
  modelId: string,
  scenarioId: ScenarioKey,
  analysisId: string,
  versionStamp: AnalysisResultVersionStamp,
  output: DcfOutput,
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
