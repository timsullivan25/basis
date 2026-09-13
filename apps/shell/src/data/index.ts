import { IndexedDbAnalysisResultRepository } from './indexedDbAnalysisResultRepository';
import { IndexedDbAnalysisSettingsRepository } from './indexedDbAnalysisSettingsRepository';
import { IndexedDbCompanyRepository } from './indexedDbCompanyRepository';
import { IndexedDbComputedResultRepository } from './indexedDbComputedResultRepository';
import { IndexedDbLineInstanceRepository } from './indexedDbLineInstanceRepository';
import { IndexedDbMappingRepository } from './indexedDbMappingRepository';
import { IndexedDbModelImportRepository } from './indexedDbModelImportRepository';
import { IndexedDbModelRepository } from './indexedDbModelRepository';
import { IndexedDbScenarioRepository } from './indexedDbScenarioRepository';
import { IndexedDbSnapshotRepository } from './indexedDbSnapshotRepository';
import { IndexedDbStatementSchemaRepository } from './indexedDbStatementSchemaRepository';
import type {
  AnalysisResultRepository,
  AnalysisSettingsRepository,
  ComputedResultRepository,
  CompanyRepository,
  LineInstanceRepository,
  MappingRepository,
  ModelImportRepository,
  ModelRepository,
  ScenarioRepository,
  SnapshotRepository,
  StatementSchemaRepository,
} from './types';

export type {
  AnalysisResult,
  AnalysisResultRepository,
  AnalysisResultVersionStamp,
  AnalysisSettings,
  AnalysisSettingsRepository,
  Company,
  CompanyRepository,
  ComputedResult,
  ComputedResultRepository,
  ComputedResultVersionStamp,
  CreateCompanyInput,
  CreateMappingInput,
  CreateModelImportInput,
  CreateModelInput,
  CreateScenarioInput,
  CreateSnapshotInput,
  DcfInputs,
  DcfOutput,
  CreateLineInstanceInput,
  DriverDefinition,
  LineAggregation,
  LineInstance,
  LineInstanceContent,
  LineInstanceRepository,
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
  Scenario,
  ScenarioKey,
  ScenarioRepository,
  Snapshot,
  SnapshotRepository,
  SnapshotScenario,
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
export const scenarioRepository: ScenarioRepository = new IndexedDbScenarioRepository();
export const computedResultRepository: ComputedResultRepository = new IndexedDbComputedResultRepository();
export const snapshotRepository: SnapshotRepository = new IndexedDbSnapshotRepository();
export const analysisSettingsRepository: AnalysisSettingsRepository = new IndexedDbAnalysisSettingsRepository();
export const analysisResultRepository: AnalysisResultRepository = new IndexedDbAnalysisResultRepository();
export const lineInstanceRepository: LineInstanceRepository = new IndexedDbLineInstanceRepository();
