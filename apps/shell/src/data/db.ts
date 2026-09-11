import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type {
  AnalysisResult,
  AnalysisSettings,
  Company,
  ComputedResult,
  Mapping,
  Model,
  ModelImport,
  Scenario,
  Snapshot,
  StatementSchema,
} from './types';

export interface BasisDb extends DBSchema {
  companies: {
    key: string;
    value: Company;
    indexes: { 'by-createdAt': string };
  };
  statementSchema: {
    key: string;
    value: StatementSchema;
    indexes: { 'by-createdAt': string };
  };
  modelImports: {
    key: string;
    value: ModelImport;
    indexes: { 'by-companyId': string };
  };
  models: {
    key: string;
    value: Model;
    indexes: { 'by-companyId': string };
  };
  mappings: {
    key: string;
    value: Mapping;
    indexes: { 'by-modelImportId': string };
  };
  scenarios: {
    key: string;
    value: Scenario;
    indexes: { 'by-modelId': string };
  };
  computedResults: {
    key: string;
    value: ComputedResult;
    indexes: { 'by-modelId': string };
  };
  snapshots: {
    key: string;
    value: Snapshot;
    /** By companyId, deliberately not modelId — see Snapshot's own doc comment: a snapshot must
     *  stay reachable after a re-map replaces the live model with a brand-new modelId. */
    indexes: { 'by-companyId': string };
  };
  analysisSettings: {
    key: string;
    value: AnalysisSettings;
    // No index — id === modelId, so a direct get() is always the lookup.
  };
  analysisResults: {
    key: string;
    value: AnalysisResult;
    indexes: { 'by-modelId': string };
  };
}

const DB_NAME = 'basis';
const DB_VERSION = 10;

/** The single key statementSchema was stored under before it became a keyPath store (versions 2-3). */
const LEGACY_STATEMENT_SCHEMA_KEY = 'default';

let dbPromise: Promise<IDBPDatabase<BasisDb>> | undefined;

export function openBasisDb(): Promise<IDBPDatabase<BasisDb>> {
  if (!dbPromise) {
    dbPromise = openDB<BasisDb>(DB_NAME, DB_VERSION, {
      async upgrade(db, oldVersion, _newVersion, transaction) {
        if (oldVersion < 1) {
          const store = db.createObjectStore('companies', { keyPath: 'id' });
          store.createIndex('by-createdAt', 'createdAt');
        }
        // Versions 2-3 created a keyless single-value statementSchema store; capture whatever
        // it held (if anything) before version 4 recreates it with a keyPath below.
        let legacy: { sections?: { lines: unknown[] }[] } | undefined;
        if (oldVersion >= 2 && oldVersion < 4) {
          legacy = (await transaction.objectStore('statementSchema').get(LEGACY_STATEMENT_SCHEMA_KEY)) as
            | { sections?: { lines: unknown[] }[] }
            | undefined;
        }
        if (oldVersion >= 2 && oldVersion < 4) {
          db.deleteObjectStore('statementSchema');
        }
        if (oldVersion < 3) {
          const store = db.createObjectStore('modelImports', { keyPath: 'id' });
          store.createIndex('by-companyId', 'companyId');
        }
        if (oldVersion < 4) {
          const store = db.createObjectStore('statementSchema', { keyPath: 'id' });
          store.createIndex('by-createdAt', 'createdAt');
          const hadRealContent = legacy?.sections?.some((s) => s.lines.length > 0);
          if (legacy && hadRealContent) {
            await store.add({
              ...legacy,
              id: crypto.randomUUID(),
              name: 'Basis Default',
              createdAt: new Date().toISOString(),
            } as StatementSchema);
          }
          // Otherwise leave the store empty — the repository seeds a real default on first list().
        }
        if (oldVersion < 5) {
          const modelsStore = db.createObjectStore('models', { keyPath: 'id' });
          modelsStore.createIndex('by-companyId', 'companyId');
          const mappingsStore = db.createObjectStore('mappings', { keyPath: 'id' });
          mappingsStore.createIndex('by-modelImportId', 'modelImportId');

          // modelImports used to carry mapping/mappedAt inline. Split each into a Mapping and
          // a Model record so today's data survives as a real current model, then strip those
          // fields off the import (it's pure upload provenance now). Historicals can't be
          // cheaply re-resolved here (would mean re-parsing the xlsx inside this transaction),
          // so a migrated model starts with empty historicals — re-mapping (or, once it exists,
          // opening the workspace) regenerates them like any other save.
          if (oldVersion >= 3) {
            const importsStore = transaction.objectStore('modelImports');
            const legacyImports = (await importsStore.getAll()) as (ModelImport & {
              mapping?: Mapping['lines'];
              mappedAt?: string;
            })[];
            for (const imp of legacyImports) {
              if (imp.mapping && imp.mapping.length > 0) {
                const mappingId = crypto.randomUUID();
                await mappingsStore.add({
                  id: mappingId,
                  modelImportId: imp.id,
                  statementSchemaId: imp.statementSchemaId,
                  lines: imp.mapping,
                  mappedAt: imp.mappedAt ?? new Date().toISOString(),
                });
                await modelsStore.add({
                  id: crypto.randomUUID(),
                  companyId: imp.companyId,
                  name: imp.fileName,
                  statementSchemaId: imp.statementSchemaId,
                  modelImportId: imp.id,
                  mappingId,
                  timeline: [],
                  historicals: {},
                  driverValues: {},
                  createdAt: imp.uploadedAt,
                  updatedAt: imp.uploadedAt,
                });
              }
              const { mapping: _mapping, mappedAt: _mappedAt, ...rest } = imp;
              await importsStore.put(rest);
            }
          }
        }
        if (oldVersion < 6) {
          const store = db.createObjectStore('scenarios', { keyPath: 'id' });
          store.createIndex('by-modelId', 'modelId');
        }
        if (oldVersion < 7) {
          const store = db.createObjectStore('computedResults', { keyPath: 'id' });
          store.createIndex('by-modelId', 'modelId');
        }
        if (oldVersion < 8) {
          const store = db.createObjectStore('snapshots', { keyPath: 'id' });
          store.createIndex('by-companyId', 'companyId');
        }
        if (oldVersion < 9) {
          db.createObjectStore('analysisSettings', { keyPath: 'id' });
        }
        if (oldVersion < 10) {
          const store = db.createObjectStore('analysisResults', { keyPath: 'id' });
          store.createIndex('by-modelId', 'modelId');
        }
      },
    });
  }
  return dbPromise;
}
