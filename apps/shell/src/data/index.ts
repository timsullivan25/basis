import { IndexedDbCompanyRepository } from './indexedDbCompanyRepository';
import { IndexedDbModelImportRepository } from './indexedDbModelImportRepository';
import { IndexedDbStatementSchemaRepository } from './indexedDbStatementSchemaRepository';
import type { CompanyRepository, ModelImportRepository, StatementSchemaRepository } from './types';

export type {
  Company,
  CompanyRepository,
  CreateCompanyInput,
  CreateModelImportInput,
  LineNumberFormat,
  LineRowFormat,
  LineSign,
  ModelImport,
  ModelImportRepository,
  ModelTemplateType,
  StatementLine,
  StatementSchema,
  StatementSchemaRepository,
  StatementSection,
} from './types';

// The one place that picks which adapter backs the app. Swapping to a real
// API later is a new class implementing the same interface and a change here.
export const companyRepository: CompanyRepository = new IndexedDbCompanyRepository();
export const statementSchemaRepository: StatementSchemaRepository = new IndexedDbStatementSchemaRepository();
export const modelImportRepository: ModelImportRepository = new IndexedDbModelImportRepository();
