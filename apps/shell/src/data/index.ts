import { IndexedDbCompanyRepository } from './indexedDbCompanyRepository';
import { IndexedDbStatementSchemaRepository } from './indexedDbStatementSchemaRepository';
import type { CompanyRepository, StatementSchemaRepository } from './types';

export type {
  Company,
  CompanyRepository,
  CreateCompanyInput,
  LineNumberFormat,
  LineRowFormat,
  LineSign,
  StatementLine,
  StatementSchema,
  StatementSchemaRepository,
  StatementSection,
} from './types';

// The one place that picks which adapter backs the app. Swapping to a real
// API later is a new class implementing the same interface and a change here.
export const companyRepository: CompanyRepository = new IndexedDbCompanyRepository();
export const statementSchemaRepository: StatementSchemaRepository = new IndexedDbStatementSchemaRepository();
