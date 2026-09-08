export interface Company {
  id: string;
  name: string;
  createdAt: string;
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

export interface StatementLine {
  /** Stable once created — never regenerated on rename/reorder/move, since formulas and aliases reference it. */
  id: string;
  name: string;
  /** Ignored (treated as "Calculated") whenever formula is non-empty. */
  required: boolean;
  rowFormat: LineRowFormat;
  numberFormat: LineNumberFormat;
  sign: LineSign;
  aggregation: LineAggregation;
  /** Raw expression referencing other line ids, e.g. "revenue - cogs". Parsed by the modeling engine later. */
  formula: string;
  aliases: string[];
}

export interface StatementSection {
  /** Stable once created — never regenerated on rename/reorder. */
  id: string;
  name: string;
  /** Array position is the display order within the section. */
  lines: StatementLine[];
}

export interface StatementSchema {
  /** Stable once created — never regenerated on rename. */
  id: string;
  name: string;
  /** Set when this schema was created via duplicate() — provenance only, no runtime merge with the source. */
  copiedFromSchemaId?: string;
  createdAt: string;
  /** Array position is the display order of sections. */
  sections: StatementSection[];
}

export interface StatementSchemaRepository {
  list(): Promise<StatementSchema[]>;
  get(id: string): Promise<StatementSchema | undefined>;
  create(input: { name: string }): Promise<StatementSchema>;
  duplicate(id: string, name: string): Promise<StatementSchema>;
  save(schema: StatementSchema): Promise<void>;
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
  createdAt: string;
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
  /** Atomic replace: if the company already has a current model, its ModelImport/Mapping are deleted first. Callers confirm with the user before calling this — the repository itself never asks. */
  create(input: CreateModelInput): Promise<Model>;
  update(id: string, patch: Partial<Pick<Model, 'name' | 'timeline' | 'historicals'>>): Promise<Model>;
  /** Cascades to the model's ModelImport and Mapping. */
  remove(id: string): Promise<void>;
}
