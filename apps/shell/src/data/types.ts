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
  /** The raw uploaded workbook — read back when mapping/parsing is built next. */
  file: Blob;
}

export interface CreateModelImportInput {
  companyId: string;
  templateType: ModelTemplateType;
  file: File;
}

export interface ModelImportRepository {
  getForCompany(companyId: string): Promise<ModelImport | undefined>;
  create(input: CreateModelImportInput): Promise<ModelImport>;
  remove(id: string): Promise<void>;
}
