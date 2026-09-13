export interface Company {
  id: string;
  name: string;
  createdAt: string;
  /** Absent means "not yet set" — treated as private (see valuationMultiple) until set true. */
  isPublic?: boolean;
  /** Used for Enterprise Value when isPublic is true. */
  marketCap?: number;
  /** Used for Enterprise Value (EBITDA × multiple) when isPublic is false. */
  valuationMultiple?: number;
}

export interface CreateCompanyInput {
  name: string;
}

export interface CompanyRepository {
  list(): Promise<Company[]>;
  get(id: string): Promise<Company | undefined>;
  create(input: CreateCompanyInput): Promise<Company>;
  update(id: string, patch: Partial<Omit<Company, 'id'>>): Promise<Company>;
  remove(id: string): Promise<void>;
}

export type LineRowFormat = 'normal' | 'total' | 'metric';
export type LineNumberFormat = 'number' | 'percentage' | 'multiple';
export type LineSign = 'natural' | 'absolute';
/** How a flow/balance line rolls up when periods are collapsed (e.g. quarters into a year) — 'none' for ratios/metrics that don't aggregate. Not used until period rollup ships. */
export type LineAggregation = 'sum' | 'last' | 'none';

/** A formula resolved at authoring time (see lib/engine/resolve.ts) — every reference is a
 *  specific line id, not a name, so it survives a rename or reorder elsewhere in the schema.
 *  `driverRef` is never hand-typed or parsed from text (unlike every other node here) — it's
 *  only ever constructed directly by the projection-method UI (see DriverDefinition below). */
export type ResolvedFormula =
  | { kind: 'num'; value: number }
  | { kind: 'ref'; lineId: string }
  | { kind: 'driverRef'; driverId: string }
  | { kind: 'neg'; arg: ResolvedFormula }
  | { kind: 'bin'; op: '+' | '-' | '*' | '/' | '^'; left: ResolvedFormula; right: ResolvedFormula }
  | { kind: 'call'; fn: 'sum' | 'min' | 'max' | 'avg' | 'abs' | 'priorPeriod' | 'priorYear' | 'lastActual'; args: ResolvedFormula[] };

/** How a line's PROJECTED periods derive a value when no mapped source exists for them (an
 *  actual period always prefers its mapped value regardless of this — see StatementLine.formula
 *  and lib/engine/evaluate.ts's computeLine). 'growth'/'percent-of'/'days-of'/'roll-off' each
 *  generate a formula that reads a DriverDefinition's per-period value via a driverRef node;
 *  'flat' is a pure carry-forward (priorPeriod(self)) and needs no driver at all.
 *  'roll-off' (LineInstance projections only — see instances/projectionMethod.tsx) anchors to
 *  this line's own value at the model's last actual period (via a `lastActual` formula call, not
 *  the prior period) and holds `1 - driver` of it flat forever; the `driver` fraction is injected
 *  as a contra adjustment onto the basis line every period (see
 *  lib/engine/withDynamicInstances.ts's injectRollOffContras) — e.g. a one-time cost that
 *  permanently lowers another line's run-rate while continuing to show as a partial EBITDA
 *  add-back. 'actual' (also LineInstance-only) has no formula computation at all — the driver IS
 *  the value, a per-period hardcoded number. */
export type ProjectionMethod = 'growth' | 'percent-of' | 'days-of' | 'roll-off' | 'actual';

/** A named, per-period leaf value (see StatementSchema.drivers) — architecturally almost
 *  identical to a non-calculated line, just living outside the statement sections and feeding
 *  the drivers panel instead of the grid. Referenced from a formula via a driverRef node,
 *  resolved by the same graph/evaluator every other formula uses; not a special calculation
 *  method the engine special-cases. */
export interface DriverDefinition {
  /** Stable once created — never regenerated, since formulas reference it. */
  id: string;
  /** Auto-suggested from the target line at creation (e.g. "Revenue Growth Rate"), editable after. */
  name: string;
  /** Display only ("%", "days") — never read by the engine. */
  unit: string;
  targetLineId: string;
  method: ProjectionMethod;
  /** Required for 'percent-of' | 'days-of' | 'roll-off' — the line this driver is expressed
   *  against (roll-off's basis line is where the contra adjustment lands, not a ratio basis).
   *  Absent for 'growth' (references its own target line via priorPeriod instead) and 'actual'
   *  (no basis at all — the driver is just a hardcoded number). */
  basisLineId?: string;
}

export interface StatementLine {
  /** Stable once created — never regenerated on rename/reorder/move, since formulas and aliases reference it. */
  id: string;
  name: string;
  /** Must have an explicit mapped value for every actual period — independent of whether the
   *  line also carries a projection formula for its future periods (see `projection`). */
  required: boolean;
  rowFormat: LineRowFormat;
  numberFormat: LineNumberFormat;
  sign: LineSign;
  aggregation: LineAggregation;
  /** Resolved at authoring time (see lib/engine/resolve.ts) — refs point at a specific line id,
   *  not a name, so a rename or reorder elsewhere in the schema never changes what this reads.
   *  An explicit mapped value always wins over this when one exists for a given period — this is
   *  the fallback, used for any period without one (in practice: every projected period, and any
   *  actual period this line simply isn't mappable/reported for). `null` means no formula at all. */
  formula: ResolvedFormula | null;
  /** Set only when `formula` was generated by the projection-method UI rather than hand-written —
   *  lets the schema editor re-render the right controls, and distinguishes a genuine structural
   *  calculated line (formula set, projection null) from a normally-sourced line with a forward
   *  projection (formula set, projection non-null). 'flat' carries no DriverDefinition (its
   *  formula is a pure `priorPeriod(self)` carry-forward); every other method does. */
  projection: { method: 'flat' } | { method: ProjectionMethod; driverId: string } | null;
  aliases: string[];
  /** When true, a model may grow a list of LineInstance rows under this line (a revenue
   *  segment, an EBITDA adjustment) — see LineInstance's own doc comment. Absent/false means
   *  this line behaves exactly as it does today; most lines never set this. Once a model has
   *  ≥1 instance here, this line's value is the sum of its instances for every period,
   *  superseding (not blending with) any direct mapping — see
   *  lib/engine/withDynamicInstances.ts. */
  allowsSubLines?: boolean;
}

export interface StatementSection {
  /** Stable once created — never regenerated on rename/reorder. */
  id: string;
  name: string;
  /** Array position is the display order within the section. */
  lines: StatementLine[];
  /** When true, a model may grow a list of freestanding LineInstance rows under this section
   *  (KPIs) — each just a real spliced-in line with no rollup target, unlike a `lineId`-scoped
   *  instance under an `allowsSubLines` line. Only meaningful for a section with no natural
   *  parent line to attach sub-lines to. */
  allowsFreeformLines?: boolean;
}

export interface StatementSchema {
  /** Stable once created — never regenerated on rename. */
  id: string;
  name: string;
  /** Set when this schema was created via duplicate() — provenance only, no runtime merge with the source. */
  copiedFromSchemaId?: string;
  createdAt: string;
  /** Bumped on every save() — part of a computed result's version stamp (see ComputedResult), so a
   *  formula/driver edit invalidates any cached result for every model built on this schema. */
  updatedAt: string;
  /** Array position is the display order of sections. */
  sections: StatementSection[];
  drivers: DriverDefinition[];
}

export interface StatementSchemaRepository {
  list(): Promise<StatementSchema[]>;
  get(id: string): Promise<StatementSchema | undefined>;
  create(input: { name: string }): Promise<StatementSchema>;
  duplicate(id: string, name: string): Promise<StatementSchema>;
  /** Returns the persisted record (its `updatedAt` is bumped on save) — use this, not the object
   *  passed in, as the new source of truth for any local state tracking the schema. */
  save(schema: StatementSchema): Promise<StatementSchema>;
  remove(id: string): Promise<void>;
}

/** "extract-ai" is a placeholder for now — not selectable until AI extraction exists. */
export type ModelTemplateType = 'basis-template' | 'extract-ai';

/** Pure upload provenance — where a model's historicals came from. Carries no mapping or resolved values itself. */
export interface ModelImport {
  id: string;
  companyId: string;
  templateType: ModelTemplateType;
  /** Which statement schema this import is mapped (or being mapped) against. */
  statementSchemaId: string;
  fileName: string;
  fileSize: number;
  uploadedAt: string;
  /** The raw uploaded workbook, read back to re-parse (e.g. to seed prior-mapping hints for the next import). */
  file: Blob;
}

export interface CreateModelImportInput {
  companyId: string;
  templateType: ModelTemplateType;
  statementSchemaId: string;
  file: File;
}

export interface ModelImportRepository {
  get(id: string): Promise<ModelImport | undefined>;
  create(input: CreateModelImportInput): Promise<ModelImport>;
  remove(id: string): Promise<void>;
}

export type PeriodType = 'FY' | 'Quarter' | 'Semi-Annual';

export interface ParsedPeriod {
  type: PeriodType;
  /** ISO date string for the period end, as read from the source file. */
  date: string;
  /** Display label as given in the file, e.g. "FY 2026". */
  name: string;
}

export interface ParsedSourceLine {
  /** Stable within one parsed workbook (derived from row position at parse time). */
  id: string;
  section: string;
  name: string;
  /** Aligned index-for-index with ParsedWorkbook.periods; null where the cell was blank. */
  values: (number | null)[];
}

export interface ParsedWorkbook {
  periods: ParsedPeriod[];
  lines: ParsedSourceLine[];
}

/** 'prior' is a hit against a name carried from the company's previous mapping — distinct from 'alias' (a registered schema alias), read differently in review. */
export type MatchMethod = 'exact' | 'alias' | 'prior' | 'fuzzy' | 'ai' | 'manual' | 'none';

export interface LineMapping {
  targetLineId: string;
  /** Source line ids being summed into this target. Empty means unmapped. */
  sourceLineIds: string[];
  method: MatchMethod;
  /** 0-1. Meaningless when method is 'none'. */
  confidence: number;
  note: string;
  /** Manually confirmed despite low confidence — suppresses the review flag without changing the match. */
  approved: boolean;
}

/** One mapping record per uploaded file per schema — separate from ModelImport so it can be edited (re-reviewed, corrected) independently of the file it was produced from. */
export interface Mapping {
  id: string;
  modelImportId: string;
  statementSchemaId: string;
  lines: LineMapping[];
  mappedAt: string;
}

export interface CreateMappingInput {
  modelImportId: string;
  statementSchemaId: string;
  lines: LineMapping[];
}

export interface MappingRepository {
  get(id: string): Promise<Mapping | undefined>;
  create(input: CreateMappingInput): Promise<Mapping>;
  /** Updates lines in place — used when re-reviewing the mapping of the *same* uploaded file, not when a new file supersedes it. */
  save(id: string, lines: LineMapping[]): Promise<Mapping>;
}

/** Anticipates phase 04's projected periods; only 'actual' is ever produced before then. */
export type PeriodKind = 'actual' | 'projected';

export interface TimelinePeriod {
  /** Stable across re-parses of the same workbook — derived from type + date, not array position. */
  id: string;
  type: PeriodType;
  /** ISO date string for the period end. */
  endDate: string;
  label: string;
  kind: PeriodKind;
}

export type Timeline = TimelinePeriod[];

/**
 * The one current model for a company — never a peer among several. Re-mapping supersedes it
 * (with a confirm — see ModelMappingScreen); superseded models aren't retained here. Durable
 * point-in-time history is what Snapshot (a later phase) is for.
 */
export interface Model {
  id: string;
  companyId: string;
  name: string;
  statementSchemaId: string;
  modelImportId: string;
  mappingId: string;
  timeline: Timeline;
  /** Resolved once at mapping-save time, index-aligned to `timeline` — never re-derived from the workbook on read. */
  historicals: Record<string, (number | null)[]>;
  /** Per-driver, per-period assumption values — index-aligned to `timeline`, keyed by
   *  DriverDefinition.id from the model's statement schema. Meaningful only at projected-period
   *  indices; edited via the drivers panel, never resolved from a workbook. */
  driverValues: Record<string, (number | null)[]>;
  createdAt: string;
  /** Bumped on every update() — part of a computed result's version stamp (see ComputedResult). */
  updatedAt: string;
  /** Bumped by IndexedDbLineInstanceRepository on every create/update/remove of one of this
   *  model's LineInstance rows — deliberately NOT part of ModelRepository.update()'s patch, since
   *  nothing but that repository ever touches it (the same cross-store-write pattern
   *  IndexedDbModelRepository's own cascade deletes already use). A stored aggregate, not derived
   *  from the current instances' own updatedAt fields, so that REMOVING an instance still bumps
   *  it — the max-of-survivors would otherwise miss exactly that case. Part of a computed
   *  result's version stamp (see ComputedResult) so removing/editing an instance correctly
   *  invalidates any cached result. */
  instancesUpdatedAt: string;
}

export interface CreateModelInput {
  companyId: string;
  name: string;
  statementSchemaId: string;
  modelImportId: string;
  mappingId: string;
  timeline: Timeline;
  historicals: Record<string, (number | null)[]>;
}

export interface ModelRepository {
  getForCompany(companyId: string): Promise<Model | undefined>;
  /** Atomic replace: if the company already has a current model, its ModelImport/Mapping/Scenarios are deleted first. Callers confirm with the user before calling this — the repository itself never asks. */
  create(input: CreateModelInput): Promise<Model>;
  update(id: string, patch: Partial<Pick<Model, 'name' | 'timeline' | 'historicals' | 'driverValues'>>): Promise<Model>;
  /** Cascades to the model's ModelImport, Mapping and Scenarios. */
  remove(id: string): Promise<void>;
}

/**
 * A user-added row under one model — either a sub-line rolling up into a `StatementLine` whose
 * `allowsSubLines` is true (a revenue segment, an EBITDA adjustment), via `lineId`; or a
 * freestanding row under a `StatementSection` whose `allowsFreeformLines` is true (a KPI), via
 * `sectionId`. Exactly one of the two is ever set. Deliberately its own top-level entity, not an
 * array embedded in `Model` — same reasoning as `Scenario`/`ComputedResult`/`AnalysisSettings`:
 * `Model`'s only per-model assumption bag is `driverValues`.
 *
 * At evaluation time, every instance is spliced into a COPY of the schema as an ordinary, real
 * `StatementLine` (id = instance.id) and evaluated through the completely unmodified engine —
 * see lib/engine/withDynamicInstances.ts. This is also what makes a sibling-instance basis work:
 * `projection.basisLineId` may point at either a schema line's id or another instance's id,
 * since after splicing both are just ordinary line ids in the same schema copy.
 */
export interface LineInstance {
  id: string;
  modelId: string;
  /** The allowsSubLines line this rolls up into. Omitted for a freeform (KPI-style) instance. */
  lineId?: string;
  /** The allowsFreeformLines section this is a freestanding row of. Omitted for a sub-line. */
  sectionId?: string;
  name: string;
  /** The uploaded workbook's source line ids this instance's historicals are derived from —
   *  persisted directly on the instance (unlike a schema line, which has no equivalent since its
   *  mapping lives in a separate Mapping record) so re-opening the mapping screen can show and
   *  edit what actually produced an existing instance's values, not just the resulting numbers.
   *  Empty means "manual": this instance's historicals are typed in directly rather than derived
   *  from any source line — the one-time-adjustment case. Absent on rows created before this
   *  field existed; every read site treats that the same as empty (`?? []`), which is also
   *  correct for them (their historicals were set once at creation and are otherwise untouched). */
  sourceLineIds: string[];
  /** Same vocabulary StatementLine.projection already uses. driverId is a real key into the
   *  SAME Model.driverValues / Scenario.driverValues maps every other driver already lives in —
   *  deliberately not a separate instance-owned value bag, so scenario overrides and
   *  mergeScenarioDriverValues work completely unchanged. */
  projection: { method: 'flat' } | { method: ProjectionMethod; driverId: string; basisLineId?: string };
  /** Debt-tranche fields — all absent/undefined for a non-debt instance (a revenue segment, an
   *  EBITDA adjustment). Set only when `lineId` targets a debt-tier line (1L/2L/Unsecured Debt) —
   *  see capitalStructure.ts. Kept on LineInstance rather than a parallel entity so tranches reuse
   *  the exact same splice/rollup mechanism (withDynamicInstances.ts) as every other instance. */
  debtType?: 'term' | 'revolver';
  /** ISO date string. */
  maturity?: string;
  /** Annual rate, e.g. 0.08 for 8%. For a revolver, the rate on the DRAWN balance. */
  couponRate?: number;
  couponType?: 'fixed' | 'floating';
  /** Free-text reference (e.g. "SOFR") — only meaningful when couponType is 'floating'. Not yet
   *  resolved to an actual per-period rate value; that's Debt Schedule's concern. */
  baseRate?: string;
  frequency?: 'quarterly' | 'semiAnnual';
  /** Overrides the "original face value" amortization is computed against (see
   *  amortizationRate) — falls back to the instance's own last-historical-period value when
   *  absent, since original issuance size often isn't separately reported. */
  originalFaceValue?: number;
  /** Annual %, e.g. 0.01 for 1%/year — applied against originalFaceValue, not the current
   *  balance. Debt Schedule's concern to actually compute; captured here as a property now. */
  amortizationRate?: number;
  /** Whether this tranche participates in the (future) cash-sweep repayment waterfall. Defaults
   *  to true when absent — most tranches are repayable; a bond typically is not. */
  repayable?: boolean;
  /** Revolver-only: the cap on what can be drawn. The instance's own historicals/driver value is
   *  always the DRAWN amount (what rolls up into 1L Debt), never the commitment amount. */
  commitmentAmount?: number;
  /** Revolver-only: annual rate on the undrawn portion (commitmentAmount minus the drawn
   *  balance). */
  commitmentFeeRate?: number;
  createdAt: string;
  updatedAt: string;
}

/** Every field a LineInstance can be created or updated with, other than its identity
 *  (id/modelId), timestamps, and lineId/sectionId (which line/section it targets is fixed at
 *  creation — see LineInstance's own doc comment on "exactly one of the two is ever set"). */
export type LineInstanceContent = Pick<
  LineInstance,
  | 'name'
  | 'sourceLineIds'
  | 'projection'
  | 'debtType'
  | 'maturity'
  | 'couponRate'
  | 'couponType'
  | 'baseRate'
  | 'frequency'
  | 'originalFaceValue'
  | 'amortizationRate'
  | 'repayable'
  | 'commitmentAmount'
  | 'commitmentFeeRate'
>;

export interface CreateLineInstanceInput extends Partial<LineInstanceContent> {
  modelId: string;
  lineId?: string;
  sectionId?: string;
  name: string;
  sourceLineIds: string[];
  projection: LineInstance['projection'];
}

export interface LineInstanceRepository {
  list(modelId: string): Promise<LineInstance[]>;
  get(id: string): Promise<LineInstance | undefined>;
  create(input: CreateLineInstanceInput): Promise<LineInstance>;
  update(id: string, patch: Partial<LineInstanceContent>): Promise<LineInstance>;
  remove(id: string): Promise<void>;
}

/**
 * A named fork of a model's driver assumptions — same lines and formulas as the model (scenarios
 * never diverge structurally), only `driverValues` differ. `driverValues` is a SPARSE override
 * layer, same shape as `Model.driverValues` and index-aligned to the same `timeline`: a `null` (or
 * an entirely absent driverId/index) means "not overridden here", cascading down to the model's
 * own `driverValues` at that cell (which may itself be explicit or fall further to the engine's
 * computed default — see evaluate.ts's `defaultDriverValue`). There is deliberately no way to say
 * "ignore the model's value here, use the pure computed default instead" — clearing a scenario
 * cell always falls through to the model, never past it. A real but narrow gap (documented, not
 * fixed): a scenario can't revert a single driver to trend while the model still assumes momentum.
 * The implicit "Base case" (the model's own driverValues) is never itself a Scenario row — see
 * lib/scenario.ts's mergeScenarioDriverValues, used to compute an effective driverValues map for
 * evaluateModel without the engine ever needing to know scenarios exist.
 */
export interface Scenario {
  id: string;
  modelId: string;
  name: string;
  driverValues: Record<string, (number | null)[]>;
  createdAt: string;
  /** Bumped on every update() — part of a computed result's version stamp (see ComputedResult). */
  updatedAt: string;
}

export interface CreateScenarioInput {
  modelId: string;
  name: string;
  /** Defaults to `{}` (fully sparse — everything cascades to the model). Duplicating an existing
   *  scenario or the implicit Base case passes a real snapshot here instead. */
  driverValues?: Record<string, (number | null)[]>;
}

export interface ScenarioRepository {
  list(modelId: string): Promise<Scenario[]>;
  get(id: string): Promise<Scenario | undefined>;
  create(input: CreateScenarioInput): Promise<Scenario>;
  update(id: string, patch: Partial<Pick<Scenario, 'name' | 'driverValues'>>): Promise<Scenario>;
  remove(id: string): Promise<void>;
}

/** 'base' sentinel or a real Scenario.id — mirrors ModelWorkspaceScreen's activeScenarioId
 *  convention (the implicit Base case is never itself a stored Scenario row). */
export type ScenarioKey = 'base' | string;

/** The three fields a computed result's freshness depends on — compared against the CURRENT live
 *  `updatedAt` values on read (see lib/computedCache.ts's versionStampMatches). A mismatch means
 *  outputs may no longer agree with the inputs that produced them — the architecture contract's
 *  "calculation desync" — and is always treated as a silent cache miss (recompute, overwrite),
 *  never surfaced as a user-facing staleness badge; that's a different concept (see the modeling
 *  plan's Phase 6 notes on temporal staleness, deliberately not built yet). */
export interface ComputedResultVersionStamp {
  modelUpdatedAt: string;
  /** null when scenarioId is 'base' — Base has no Scenario row to stamp. */
  scenarioUpdatedAt: string | null;
  schemaUpdatedAt: string;
  /** Mirrors Model.instancesUpdatedAt — never null, since every model has one from creation,
   *  even with zero LineInstance rows. */
  instancesUpdatedAt: string;
}

/**
 * A materialized, plain-data snapshot of an EvaluationResult (see lib/engine/evaluate.ts) for one
 * (model, scenario) pair — "computed state is a cache, not a source" per the architecture
 * contract. EvaluationResult itself is a set of closures over Maps and can't be persisted directly;
 * `values`/`errors` are the same data flattened to plain records via lib/computedCache.ts's
 * materializeEvaluation, keyed by lineId and index-aligned to the model's timeline.
 */
export interface ComputedResult {
  /** `${modelId}:${scenarioId}` — also the natural primary key, so `set()` is a plain upsert. */
  id: string;
  modelId: string;
  scenarioId: ScenarioKey;
  values: Record<string, (number | null)[]>;
  errors: Record<string, string>;
  versionStamp: ComputedResultVersionStamp;
  computedAt: string;
}

export interface ComputedResultRepository {
  get(modelId: string, scenarioId: ScenarioKey): Promise<ComputedResult | undefined>;
  set(result: ComputedResult): Promise<void>;
}

/** One case's frozen state within a Snapshot — Base included as `scenarioId: 'base'` in the same
 *  array as every named scenario, no special-casing, same convention ComputedResult/
 *  ModelWorkspaceScreen already use. `driverValues` is the case's own sparse overrides as they
 *  stood at snapshot time (Base's own values, verbatim, for the 'base' entry); `values`/`errors`
 *  are the fully-resolved, already-merged computed output for that case — freshly evaluated at
 *  snapshot time via evaluateModel + materializeEvaluation, never read from the ComputedResult
 *  cache, since a snapshot must reflect truth at the instant of freezing regardless of whether the
 *  cache happens to be fresh. */
export interface SnapshotScenario {
  scenarioId: ScenarioKey;
  /** Frozen display name — survives the live scenario being renamed or deleted later. */
  name: string;
  driverValues: Record<string, (number | null)[]>;
  values: Record<string, (number | null)[]>;
  errors: Record<string, string>;
}

/**
 * An immutable, fully self-contained copy of a model at one point in time — actuals, the mapping
 * that produced them, driver values and computed outputs per case, and a full deep copy of the
 * statement schema (so a formula shows exactly as it read then, even after the live schema is
 * edited). Deliberately the one entity in this data model built to outlive its source: unlike
 * Scenario/ComputedResult, nothing cascade-deletes a Snapshot when the model it came from is
 * re-mapped or removed (see IndexedDbModelRepository) — it has zero live foreign-key dependencies
 * left to go stale, everything meaningful is embedded here already. Queried by `companyId`, not
 * `modelId`, for exactly this reason: re-mapping replaces the live model with a brand-new
 * `modelId`, so a company's snapshot history has to survive that swap to stay reachable.
 */
export interface Snapshot {
  id: string;
  /** The model this was taken from — provenance only; never used to look this record up (see
   *  companyId above) and never assumed to still exist. */
  modelId: string;
  companyId: string;
  /** Short, editable identifier — defaults to a period+date string (see lib/snapshot.ts's
   *  defaultSnapshotLabel) but is meant to be replaced with something meaningful ("Revised
   *  thesis"), not just a timestamp. */
  label: string;
  /** Optional longer free-text context for why this snapshot was taken (e.g. "completed earnings
   *  update"). Empty string, not undefined, when left blank — one shape to render, not two. */
  note: string;
  createdAt: string;
  timeline: Timeline;
  historicals: Record<string, (number | null)[]>;
  /** A deep copy, not an id reference — this is what makes formula-as-it-was true even after the
   *  live schema changes. */
  schema: StatementSchema;
  /** Only the reviewed content, not the live Mapping record's own id/foreign-keys, which would be
   *  meaningless once frozen. */
  mapping: { lines: LineMapping[]; mappedAt: string };
  /** Display provenance from the ModelImport — never the file Blob itself, so a snapshot never
   *  duplicates the uploaded workbook's bytes. */
  sourceFileName: string;
  sourceUploadedAt: string;
  scenarios: SnapshotScenario[];
  /** A frozen deep copy of the model's LineInstance rows at snapshot time — same convention as
   *  `scenarios` above. Without this, an old snapshot's NUMBERS would still be correct (they're
   *  fully materialized at freeze time regardless), but there'd be no record of which instances
   *  produced them or how they were configured. */
  instances: LineInstance[];
}

export interface CreateSnapshotInput {
  modelId: string;
  companyId: string;
  label: string;
  note: string;
  timeline: Timeline;
  historicals: Record<string, (number | null)[]>;
  schema: StatementSchema;
  mapping: { lines: LineMapping[]; mappedAt: string };
  sourceFileName: string;
  sourceUploadedAt: string;
  scenarios: SnapshotScenario[];
  instances: LineInstance[];
}

export interface SnapshotRepository {
  list(companyId: string): Promise<Snapshot[]>;
  get(id: string): Promise<Snapshot | undefined>;
  create(input: CreateSnapshotInput): Promise<Snapshot>;
}

/** WACC and terminal growth — the two DCF assumptions with no schema analog (unlike EBIT/D&A/
 *  CapEx/NWC/tax rate, nothing about "the discount rate you're valuing the company at" is a
 *  property of the financial statements themselves). `null` means "not set" (WACC/terminal
 *  growth default to null — no schema-derivable default exists for either), or, on a named
 *  scenario's entry, "not overridden here, cascade to Base" — see AnalysisSettings.dcfInputs. */
export interface DcfInputs {
  wacc: number | null;
  terminalGrowth: number | null;
}

/**
 * One row per model — which analyses (from the static ANALYSIS_CATALOG) are enabled, and DCF's
 * own per-scenario WACC/terminal-growth assumptions. Required inputs that DO have a schema
 * analog (EBIT, D&A, CapEx, Net Working Capital, tax rate) are deliberately NOT stored here —
 * they resolve from the schema's own lines/aliases via lib/summaryLines.ts's findSummaryLine,
 * the same mechanism mapping already uses, so resolving one is a real improvement to the
 * schema's own definition rather than a DCF-local override.
 */
export interface AnalysisSettings {
  /** == modelId — one settings row per model, so this doubles as the primary key. */
  id: string;
  modelId: string;
  enabledAnalysisIds: string[];
  /** Per-scenario DCF assumptions. 'base' is ground truth and never cascades further; a named
   *  scenario's entry is SPARSE against it — a null field means "not overridden here, use
   *  Base's value", same semantics and same reason as Scenario.driverValues' per-field cascade
   *  (see lib/scenario.ts's mergeScenarioDriverValues) — just at 2-scalar-fields-not-N-periods
   *  scale. A whole-record fallback was considered and rejected: it would force copying Base's
   *  other field the instant only one field is first overridden, silently freezing it at that
   *  moment even as Base's own assumption keeps evolving. */
  dcfInputs: Record<ScenarioKey, DcfInputs>;
  createdAt: string;
  updatedAt: string;
}

export interface AnalysisSettingsRepository {
  get(modelId: string): Promise<AnalysisSettings | undefined>;
  /** Seeds a fresh row: enabledAnalysisIds from the catalog's defaultEnabled entries,
   *  dcfInputs: { base: { wacc: null, terminalGrowth: null } }. */
  create(modelId: string): Promise<AnalysisSettings>;
  update(modelId: string, patch: Partial<Pick<AnalysisSettings, 'enabledAnalysisIds' | 'dcfInputs'>>): Promise<AnalysisSettings>;
}

/** The full computed DCF output for one (model, scenario) pair — a plain-data mirror of
 *  lib/dcf.ts's working shapes (DcfUfcfRow/DcfOutputs/SensitivityGrid), same relationship
 *  ComputedResult's flattened values/errors already have to the live EvaluationResult they're
 *  materialized from. Deliberately DCF-shaped rather than generic: it's the only analysis today,
 *  and a second one would get its own typed payload here rather than forcing a premature union. */
export interface DcfOutput {
  ufcfRows: Array<{
    periodIndex: number;
    ebit: number | null;
    taxRate: number | null;
    nopat: number | null;
    da: number | null;
    capex: number | null;
    deltaNwc: number | null;
    ufcf: number | null;
  }>;
  discountFactors: (number | null)[];
  presentValueOfUfcf: number | null;
  terminalValue: number | null;
  presentValueOfTerminalValue: number | null;
  enterpriseValue: number | null;
  netDebt: number | null;
  equityValue: number | null;
  sensitivity: {
    waccValues: number[];
    terminalGrowthValues: number[];
    rows: Array<Array<{ wacc: number; terminalGrowth: number; enterpriseValue: number | null }>>;
  };
}

/** A SIBLING to ComputedResultVersionStamp, not a widening of it — computedCache.ts's existing
 *  3-field consumers stay untouched. The 4th field DCF needs beyond the other three: WACC/
 *  terminal-growth live in AnalysisSettings, whose own updatedAt must also match for the cache
 *  to be considered fresh. */
export interface AnalysisResultVersionStamp {
  modelUpdatedAt: string;
  scenarioUpdatedAt: string | null;
  schemaUpdatedAt: string;
  analysisSettingsUpdatedAt: string;
}

/**
 * A materialized cache of one analysis's output for one (model, scenario) pair — "computed state
 * is a cache, not a source" per the architecture contract, same pattern ComputedResult already
 * establishes. The payoff isn't that DCF math is slow (it isn't, same as evaluateModel at this
 * schema's scale) — it's what lets a cross-model reader (the "fetch analysis outputs for an
 * arbitrary set of company/model/scenario/analysis tuples" access pattern this phase's plan asks
 * for) read a number without loading that company's full model/schema/scenario and recomputing
 * DCF live for each one.
 */
export interface AnalysisResult {
  /** `${modelId}:${scenarioId}:${analysisId}` — also the natural primary key. */
  id: string;
  modelId: string;
  scenarioId: ScenarioKey;
  analysisId: string;
  output: DcfOutput;
  versionStamp: AnalysisResultVersionStamp;
  computedAt: string;
}

export interface AnalysisResultRepository {
  get(modelId: string, scenarioId: ScenarioKey, analysisId: string): Promise<AnalysisResult | undefined>;
  set(result: AnalysisResult): Promise<void>;
  /** Cache-only batch read for the cross-model access pattern ("fetch analysis outputs for an
   *  arbitrary set of company/model/scenario/analysis tuples") — no live-compute fallback baked
   *  in here, same as get() never falls back to evaluating on its own; a caller (e.g. a future
   *  cross-issuer comparison view) decides what to do with a miss. Tuples not found are simply
   *  omitted from the result, not represented as undefined placeholders. */
  getMany(tuples: Array<{ modelId: string; scenarioId: ScenarioKey; analysisId: string }>): Promise<AnalysisResult[]>;
}
