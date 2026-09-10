import { IndexedDbCompanyRepository } from './indexedDbCompanyRepository';
import { IndexedDbMappingRepository } from './indexedDbMappingRepository';
import { IndexedDbModelImportRepository } from './indexedDbModelImportRepository';
import { IndexedDbModelRepository } from './indexedDbModelRepository';
import { IndexedDbStatementSchemaRepository } from './indexedDbStatementSchemaRepository';
import type {
  CompanyRepository,
  MappingRepository,
  ModelImportRepository,
  ModelRepository,
  StatementSchemaRepository,
} from './types';

export type {
  Company,
  CompanyRepository,
  CreateCompanyInput,
  CreateMappingInput,
  CreateModelImportInput,
  CreateModelInput,
  DriverDefinition,
  LineAggregation,
  LineMapping,
  LineNumberFormat,
  LineRowFormat,
  LineSign,
  Mapping,
  MappingRepository,
  MatchMethod,
  Model,
  ModelImport,
  ModelImportRepository,
  ModelRepository,
  ModelTemplateType,
  ParsedPeriod,
  ParsedSourceLine,
  ParsedWorkbook,
  PeriodKind,
  PeriodType,
  ProjectionMethod,
  ResolvedFormula,
  StatementLine,
  StatementSchema,
  StatementSchemaRepository,
  StatementSection,
  Timeline,
  TimelinePeriod,
} from './types';

// The one place that picks which adapter backs the app. Swapping to a real
// API later is a new class implementing the same interface and a change here.
export const companyRepository: CompanyRepository = new IndexedDbCompanyRepository();
export const statementSchemaRepository: StatementSchemaRepository = new IndexedDbStatementSchemaRepository();
export const modelImportRepository: ModelImportRepository = new IndexedDbModelImportRepository();
export const mappingRepository: MappingRepository = new IndexedDbMappingRepository();
export const modelRepository: ModelRepository = new IndexedDbModelRepository();
