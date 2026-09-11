import type {
  Company,
  CreateSnapshotInput,
  LineInstance,
  Mapping,
  Model,
  ModelImport,
  Scenario,
  ScenarioKey,
  SnapshotScenario,
  StatementSchema,
} from '../data';
import { applyDynamicInstances } from './engine/withDynamicInstances';
import { materializeEvaluation, type LineValues } from './computedCache';
import { mergeScenarioDriverValues } from './scenario';

/** Mirrors evaluate.ts's own lastActualIndex scan (and SummaryPanel's copy of the same logic) —
 *  periods are always built/extended so actuals form a prefix, but this scans defensively rather
 *  than assuming that. */
function lastActualIndex(model: Model): number {
  for (let i = model.timeline.length - 1; i >= 0; i--) {
    if (model.timeline[i].kind === 'actual') return i;
  }
  return model.timeline.length - 1;
}

/** Pre-fills the "Label" field when a user opens the Snapshot dialog — a starting point meant to
 *  be replaced with something meaningful ("Revised thesis"), not the final word (see Snapshot's
 *  own doc comment in data/types.ts). */
export function defaultSnapshotLabel(model: Model): string {
  const period = model.timeline[lastActualIndex(model)];
  const date = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return period ? `${period.label} · ${date}` : date;
}

interface BuildSnapshotParams {
  company: Company;
  model: Model;
  schema: StatementSchema;
  mapping: Mapping;
  modelImport: ModelImport;
  scenarios: Scenario[];
  /** The model's current LineInstance rows — spliced into `schema` for every case's evaluation
   *  (so a frozen segment/adjustment rolls up correctly) and frozen verbatim into the snapshot's
   *  own `instances` field for provenance (see Snapshot.instances' own doc comment). */
  instances: LineInstance[];
  label: string;
  note: string;
}

/** Assembles a full, self-contained snapshot input — every case (Base + every named scenario)
 *  freshly evaluated at this instant (never read from the ComputedResult cache, which might not
 *  be fresh — a snapshot has to reflect truth at the moment of freezing), the schema/mapping/
 *  historicals/timeline deep-copied so a later edit to the live model can never reach back into
 *  an already-taken snapshot. Returns the repository's create() input, not a full Snapshot — id
 *  and createdAt are the repository's to assign, same convention every other builder in this
 *  codebase follows (e.g. lib/computedCache.ts's buildComputedResult).
 *
 *  The embedded `schema` is the INSTANCED schema (every live instance already spliced in as a
 *  real StatementLine), not the raw one — so SnapshotViewScreen can render `schema.sections[].lines`
 *  exactly like the live workspace does, with zero special-casing for instance rows. */
export function buildSnapshot(params: BuildSnapshotParams): CreateSnapshotInput {
  const { company, model, schema, mapping, modelImport, scenarios, instances, label, note } = params;

  const cases: Array<{ scenarioId: ScenarioKey; name: string; driverValues: Record<string, (number | null)[]> }> = [
    { scenarioId: 'base', name: 'Base case', driverValues: model.driverValues ?? {} },
    ...scenarios.map((s) => ({ scenarioId: s.id, name: s.name, driverValues: s.driverValues })),
  ];

  let instancedSchema = schema;
  const snapshotScenarios: SnapshotScenario[] = cases.map((c) => {
    const merged =
      c.scenarioId === 'base' ? (model.driverValues ?? {}) : mergeScenarioDriverValues(model.driverValues ?? {}, c.driverValues);
    const { schema: casedSchema, evaluation } = applyDynamicInstances(schema, { ...model, driverValues: merged }, instances);
    instancedSchema = casedSchema; // structurally identical across cases (same instances every time) — any case's copy will do.
    const materialized = materializeEvaluation(casedSchema, model, evaluation);
    return { scenarioId: c.scenarioId, name: c.name, driverValues: structuredClone(c.driverValues), ...materialized };
  });

  return {
    modelId: model.id,
    companyId: company.id,
    label,
    note,
    timeline: structuredClone(model.timeline),
    historicals: structuredClone(model.historicals),
    schema: structuredClone(instancedSchema),
    mapping: { lines: structuredClone(mapping.lines), mappedAt: mapping.mappedAt },
    sourceFileName: modelImport.fileName,
    sourceUploadedAt: modelImport.uploadedAt,
    scenarios: snapshotScenarios,
    instances: structuredClone(instances),
  };
}

/** Adapts one frozen SnapshotScenario to the same LineValues shape a live EvaluationResult or a
 *  cached ComputedResult already satisfy (see computedCache.ts's toLineValues) — so SummaryPanel
 *  never has to know it's reading frozen data. */
export function toSnapshotLineValues(scenario: SnapshotScenario): LineValues {
  return {
    getValue: (lineId, periodIndex) => scenario.values[lineId]?.[periodIndex] ?? null,
    getError: (lineId) => scenario.errors[lineId],
  };
}
