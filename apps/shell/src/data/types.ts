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
 *  'roll-off' anchors to this line's own value at the model's last actual period (via a
 *  `lastActual` formula call, not the prior period) and holds `1 - driver` of it flat forever;
 *  the `driver` fraction is subtracted from the basis line's own formula every period, via a
 *  non-destructive wrapper (see lib/statementLineChildren.ts's applyRollOffContra) — e.g. a
 *  one-time cost that permanently lowers another line's run-rate while continuing to show as a
 *  partial EBITDA add-back. 'hardcode' has no formula computation at all — the driver IS the
 *  value, a per-period hardcoded number. */
export type ProjectionMethod = 'growth' | 'percent-of' | 'days-of' | 'roll-off' | 'hardcode';

/** How a line gets its values — the one field the schema editor's "Role" column edits.
 *  'required' / 'optional' are SOURCED: mapped from an uploaded model for the actual periods (a
 *  required one must be), with a projection (see StatementLine.projection) for the rest.
 *  'calculated' is never mapped — one formula produces its value in every period, actual and
 *  projected alike. 'check' is a calculated line that must tie out (see checkTolerance).
 *  'linked' is never mapped either: it reads one other line (optionally sign-flipped) in every
 *  period — so a value that appears in two places is mapped once, on the line it belongs to, and
 *  flows to the rest by link instead of being mapped twice. */
export type LineRole = 'required' | 'optional' | 'calculated' | 'linked' | 'check';

/** A SOURCED line's projection type — how its projected periods get a value. The first group
 *  ('flat' and the driver-backed methods) is "Standard" in the editor; 'formula' is a
 *  hand-written formula stored in StatementLine.formula. 'link' is not a sourced line's
 *  projection: it is what a LINKED line (role 'linked') stores — the line it reads. 'hardcode' is one
 *  of the driver-backed methods: its driver IS the value, entered per period by hand. See
 *  StatementLine.projection. */
export type LineProjection =
  | { method: 'flat' }
  | { method: ProjectionMethod; driverId: string }
  /** `flipSign` reads the basis line negated — a Link's one adjustment, so a plain pull-through
   *  of an opposite-signed line doesn't need a hand-written Formula. */
  | { method: 'link'; basisLineId: string; flipSign?: boolean }
  | { method: 'formula' };

/** What role a debt-schedule-generated line plays — see StatementLine.debtScheduleRole and
 *  lib/debtSchedule.ts. The first seven are schedule-level (one each, not tied to a tranche;
 *  the three totals always exist, even with zero tranches, so any other line can reference them
 *  by ordinary qualified name — e.g. "Debt Schedule.Interest Expense" — with nothing special on
 *  the referencing side); the rest are per-tranche, one set of six (or seven, for a revolver's
 *  commitmentFee) per tranche. */
export type DebtScheduleRole =
  | 'minimumCashTarget'
  | 'cashAvailableForRepayment'
  | 'cashShortfall'
  | 'revolverBreach'
  | 'totalInterestExpense'
  | 'totalBorrowings'
  | 'totalRepayments'
  | 'beginningBalance'
  | 'borrowing'
  | 'repayment'
  | 'amortization'
  | 'interestExpense'
  | 'commitmentFee'
  | 'endingBalance';

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
   *  Absent for 'growth' (references its own target line via priorPeriod instead) and 'hardcode'
   *  (no basis at all — the driver is just a hardcoded number). */
  basisLineId?: string;
}

export interface StatementLine {
  /** Stable once created — never regenerated on rename/reorder/move, since formulas and aliases reference it. */
  id: string;
  name: string;
  /** How this line gets its values — see LineRole. */
  role: LineRole;
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
  /** A SOURCED line's explicit projection type — always set on a required/optional line (a new
   *  one defaults to 'flat'), so a projection can't silently be left unset. `formula` is then its
   *  projected-period formula: generated for the standard methods and 'link', hand-written for
   *  'formula', null for 'hardcode'. `null` means the line has no projection of its own: a
   *  calculated or check line (one formula, every period), a debt line (its value comes from the
   *  Debt Schedule) or a parent that sums its sub-lines. */
  projection: LineProjection | null;
  aliases: string[];
  /** When true, a model may grow a list of real child StatementLines under this line (a revenue
   *  segment, an EBITDA adjustment, a debt tranche) — see `parentLineId` below and
   *  lib/statementLineChildren.ts. Absent/false means this line behaves exactly as it does
   *  today; most lines never set this. Once a model has ≥1 child here, this line's own formula
   *  is regenerated to sum them for every period, superseding (not blending with) any direct
   *  mapping. */
  allowsSubLines?: boolean;
  /** The parent line this is a child of, within the SAME schema. Absent for an ordinary
   *  top-level line. Only ever set on a line living in a MODEL's own (privately-owned, forked —
   *  see StatementSchema.copiedFromSchemaId) schema copy, never on a template's own lines,
   *  since a template never has actual children instantiated — see ModelMappingScreen's
   *  "+ Add sub-line"/"+ Add KPI" handling. A child with no parentLineId but living directly in
   *  a section whose allowsFreeformLines is true is the KPI case — no separate field needed for
   *  that, since the line simply lives in that section's own `lines` array like any other. */
  parentLineId?: string;
  /** 'debt' today; other kinds may exist later. Fully independent of allowsSubLines —
   *  a line can be debt with no children (a single lump-sum balance carrying its own properties
   *  directly), have children without being debt (a revenue segment's parent), both, or neither.
   *  A child's EFFECTIVE kind is always its parent's (via parentLineId) — never independently set
   *  on the child itself, so it can never drift out of sync with the parent (a rollup mixing debt
   *  and non-debt children wouldn't mean anything). Only a line with no parentLineId has this
   *  field mean anything on its own. 'check' is unrelated to the debt fields below — see
   *  checkTolerance. */
  lineKind?: 'debt';
  /** Set on whichever debt-kind line (lineKind === 'debt', directly or inherited) currently has
   *  no children of its own — a standalone debt line, or a leaf tranche. The moment a debt line
   *  gains a real child, it becomes a pure rollup (its own formula sums the children — see
   *  ModelMappingScreen) and stops carrying its own properties; each child carries its own
   *  instead. Absent for a non-debt line. */
  debtProperties?: DebtTrancheProperties;
  /** Tags a line GENERATED by lib/debtSchedule.ts's regenerateDebtSchedule — what it is and,
   *  for a per-tranche line, which tranche it belongs to. Distinct from parentLineId/children:
   *  a tranche's own Beginning/Interest/Amortization/Repayment/Borrowing/Ending lines DECOMPOSE
   *  that one tranche's value, they don't sum together AS it — reusing parentLineId here would
   *  incorrectly give the tranche children, moving its debtProperties away (see
   *  lib/statementLineChildren.ts's regenerateParentSumFormula). Absent trancheLineId marks one
   *  of the handful of schedule-level (not per-tranche) lines. Purely descriptive/generated —
   *  plays no role in deciding what's eligible for the schedule (that's still effectiveLineKind
   *  === 'debt' on a childless line, unchanged from Capital Structure). */
  debtScheduleRole?: { trancheLineId?: string; role: DebtScheduleRole };
  /** Only meaningful for a Check line (role 'check') — the largest absolute computed value (in the
   *  line's own units, e.g. a fraction for a percentage-formatted check) still considered "tied
   *  out". Absent falls back to DEFAULT_CHECK_TOLERANCE (see statementFormatting.ts's
   *  getCheckStatus) rather than treating every nonzero value as a failure. */
  checkTolerance?: number;
}

/** Property bundle for one debt tranche — see StatementLine.debtProperties' own doc comment for
 *  exactly which line carries this. */
export interface DebtTrancheProperties {
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
   *  amortizationRate) — falls back to this line's own last-historical-period value when
   *  absent, since original issuance size often isn't separately reported. */
  originalFaceValue?: number;
  /** Annual %, e.g. 0.01 for 1%/year — applied against originalFaceValue, not the current
   *  balance. Debt Schedule's concern to actually compute; captured here as a property now. */
  amortizationRate?: number;
  /** Whether this tranche participates in the (future) cash-sweep repayment waterfall. Defaults
   *  to true when absent — most tranches are repayable; a bond typically is not. */
  repayable?: boolean;
  /** Revolver-only: the cap on what can be drawn. This line's own historicals/driver value is
   *  always the DRAWN amount (what rolls up into its parent), never the commitment amount. */
  commitmentAmount?: number;
  /** Revolver-only: annual rate on the undrawn portion (commitmentAmount minus the drawn
   *  balance). */
  commitmentFeeRate?: number;
}

export interface StatementSection {
  /** Stable once created — never regenerated on rename/reorder. */
  id: string;
  name: string;
  /** Array position is the display order within the section. */
  lines: StatementLine[];
  /** When true, a model may grow a list of freestanding child StatementLines directly in this
   *  section's own `lines` (KPIs) — each with no `parentLineId`, unlike a sub-line rolling up
   *  into an `allowsSubLines` line. Only meaningful for a section with no natural parent line to
   *  attach sub-lines to. */
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
  /** `idMap` is the complete old-id -> new-id correspondence duplicate() built to remap the
   *  copy's own formulas/driver refs (every line, section, and driver id, all regenerated in
   *  the source's own order) — returned so a caller that holds OTHER state built against the
   *  source's ids (e.g. a mapping-in-progress, or draft dynamic-line instances) can rewrite
   *  those same references onto the copy, instead of them silently going stale. */
  duplicate(id: string, name: string): Promise<{ schema: StatementSchema; idMap: Map<string, string> }>;
  /** Returns the persisted record (its `updatedAt` is bumped on save) — use this, not the object
   *  passed in, as the new source of truth for any local state tracking the schema. */
  save(schema: StatementSchema): Promise<StatementSchema>;
  /** Regenerates the built-in "Basis Default" template from the current code
   *  (createDefaultStatementSchema) and overwrites it in place — the one template a model never
   *  forks a stale copy of by referencing old ids, since every model owns its own private schema
   *  fork from creation onward (see StatementSchema.copiedFromSchemaId). Safe to call any time:
   *  no model depends on the default template's own line/driver ids past the moment it forks.
   *  Discards any manual edits made to the default template itself — callers confirm with the
   *  user before calling this, same convention as remove(). */
  resetDefault(): Promise<StatementSchema>;
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
  /** Name and size of the root upload — the user's own file, even when `file` below is a generated template. */
  fileName: string;
  fileSize: number;
  uploadedAt: string;
  /** The workbook in Basis Template shape, read back to re-parse (e.g. to re-open mapping, or to seed prior-mapping hints for the next import). For an AI-extracted import this is the generated template; otherwise it is the upload itself. */
  file: Blob;
  /** Only for an AI-extracted import: the original, untouched upload the template was generated from. */
  originalFile?: Blob;
}

export interface CreateModelImportInput {
  companyId: string;
  templateType: ModelTemplateType;
  statementSchemaId: string;
  /** The Basis Template workbook to parse (the upload itself, or a generated one). */
  file: File;
  /** Set when `file` was generated from a different upload — that upload becomes the import's root file and name. */
  originalFile?: File;
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
  /** Title of the sub-block the row sits under in the source (a segment, a debt tranche), nested titles joined with " › ". Context only — matching runs on `name`. */
  group?: string;
  /** The row's own label, without its group. */
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
  /** Other source lines that matched just as well as `sourceLineIds` (same name in another group). Set only by the automatic pass; a non-empty list flags the match for review until the user picks or approves. */
  alternativeSourceLineIds?: string[];
  note: string;
  /** What this line was mapped to before an AI review changed it — kept so a single suggestion can be rejected and the earlier match restored. Set by the review, cleared on restore. */
  previous?: Omit<LineMapping, 'previous'>;
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
  /** Bumped on every update() — part of a computed result's version stamp (see ComputedResult).
   *  Every dynamic child line (segment, EBITDA adjustment, KPI, debt tranche) is a real
   *  StatementLine living in this model's own private schema (see lib/statementLineChildren.ts),
   *  so a structural change to one of those is a schema save — already covered by
   *  StatementSchema.updatedAt, with nothing extra needed here. */
  updatedAt: string;
  /** Whether a debt tranche's interest (and a revolver's commitment fee) accrues on
   *  avg(Beginning, Ending) balance — a genuine same-period circularity solved by the engine's
   *  existing Gauss-Seidel cycle solver — or on Beginning balance alone (the safe, non-circular
   *  default when absent/false). A model-level setting, not schema-level: it only decides which
   *  formula shape lib/debtSchedule.ts's regenerateDebtSchedule bakes into every tranche's
   *  interest line, edited from ModelWorkspaceScreen's "Recalculation" settings popover. */
  circularCalcsEnabled?: boolean;
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
  update(id: string, patch: Partial<Pick<Model, 'name' | 'timeline' | 'historicals' | 'driverValues' | 'circularCalcsEnabled'>>): Promise<Model>;
  /** Cascades to the model's ModelImport, Mapping and Scenarios. */
  remove(id: string): Promise<void>;
}

/**
 * A named fork of a model's driver assumptions — same lines and formulas as the model (scenarios
 * never diverge structurally), only `driverValues` differ. `driverValues` overrides the model's own
 * `driverValues` (same shape, index-aligned to the same `timeline`) on a **per-line, all-or-nothing**
 * basis: if a driverId key is entirely absent from this map, that whole line tracks the model's
 * (Base's) values live; if the key is present, this scenario's array is used verbatim for every
 * period — there is no per-cell mixing of explicit and inherited within one line. A line is
 * "promoted" from inherited to explicit the moment any one of its periods is edited (see
 * ModelWorkspaceScreen's `updateDriverValue` and lib/scenario.ts's `promoteScenarioDriverLine`),
 * which snapshots the model's current stored values into every period at once. "Reset to Base"
 * removes the key entirely, returning the whole line to live tracking. The implicit "Base case"
 * (the model's own driverValues) is never itself a Scenario row — see lib/scenario.ts's
 * mergeScenarioDriverValues, used to compute an effective driverValues map for evaluateModel
 * without the engine ever needing to know scenarios exist.
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
