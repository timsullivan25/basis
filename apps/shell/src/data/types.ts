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

export interface StatementLine {
  /** Stable once created — never regenerated on rename/reorder/move, since formulas and aliases reference it. */
  id: string;
  name: string;
  /** Ignored (treated as "Calculated") whenever formula is non-empty. */
  required: boolean;
  rowFormat: LineRowFormat;
  numberFormat: LineNumberFormat;
  sign: LineSign;
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
  /** Array position is the display order of sections. */
  sections: StatementSection[];
}

export interface StatementSchemaRepository {
  get(): Promise<StatementSchema>;
  save(schema: StatementSchema): Promise<void>;
}

/** "extract-ai" is a placeholder for now — not selectable until AI extraction exists. */
export type ModelTemplateType = 'basis-template' | 'extract-ai';

export interface ModelImport {
  id: string;
  companyId: string;
  templateType: ModelTemplateType;
  fileName: string;
  fileSize: number;
  uploadedAt: string;
  /** The raw uploaded workbook, read back to parse/re-parse. */
  file: Blob;
  /** Present once the user has completed and saved the mapping step. */
  mapping?: LineMapping[];
  mappedAt?: string;
}

export interface CreateModelImportInput {
  companyId: string;
  templateType: ModelTemplateType;
  file: File;
}

export interface ModelImportRepository {
  getForCompany(companyId: string): Promise<ModelImport | undefined>;
  create(input: CreateModelImportInput): Promise<ModelImport>;
  saveMapping(id: string, mapping: LineMapping[]): Promise<ModelImport>;
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

export type MatchMethod = 'exact' | 'alias' | 'fuzzy' | 'ai' | 'manual' | 'none';

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
