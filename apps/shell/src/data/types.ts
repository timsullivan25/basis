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
