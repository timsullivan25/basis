import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type {
  AnalysisResult,
  AnalysisSettings,
  Company,
  ComputedResult,
  LboCase,
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
  lboCases: {
    key: string;
    value: LboCase;
    // No index — id === modelId, so a direct get() is always the lookup, same as analysisSettings.
  };
}

const DB_NAME = 'basis';
const DB_VERSION = 21;

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
        // Every model now owns a private, forked copy of its schema, and a dynamic child line
        // (segment, EBITDA adjustment, KPI, debt tranche) is a real StatementLine living
        // directly in it (see lib/statementLineChildren.ts) rather than a separate LineInstance
        // row — the `lineInstances` store a v11-or-earlier install already has is dropped for
        // good below (no replacement — a fresh install, oldVersion 0, never creates it at all
        // anymore). Both are genuinely new invariants existing data was never built under. This
        // is dev/test data, not production, so the simplest correct migration is wiping every
        // model-dependent store rather than attempting to fold old data into shapes it never
        // had; existing companies just re-import fresh. `companies` and `statementSchema`
        // (templates) survive untouched. Each store below is only deleted+recreated when it
        // already exists from a PRIOR session's upgrade (oldVersion at or past that store's own
        // creation threshold above) — otherwise the block above this one is what creates it
        // fresh in this same pass, and touching it again here would collide.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 'lineInstances' no
        // longer exists on the current BasisDb type (the whole point of this deletion), but
        // idb's deleteObjectStore only accepts today's known store names.
        // Guarded by existence: only a v11 install still has it. An unguarded delete on any later
        // version threw NotFoundError inside this async callback, where it's swallowed — the version
        // bumped and every migration below it silently never ran.
        if (oldVersion >= 11 && db.objectStoreNames.contains('lineInstances' as any)) db.deleteObjectStore('lineInstances' as any);
        if (oldVersion >= 1 && oldVersion < 12) {
          if (oldVersion >= 3) {
            db.deleteObjectStore('modelImports');
            const s = db.createObjectStore('modelImports', { keyPath: 'id' });
            s.createIndex('by-companyId', 'companyId');
          }
          if (oldVersion >= 5) {
            db.deleteObjectStore('models');
            const models = db.createObjectStore('models', { keyPath: 'id' });
            models.createIndex('by-companyId', 'companyId');
            db.deleteObjectStore('mappings');
            const mappings = db.createObjectStore('mappings', { keyPath: 'id' });
            mappings.createIndex('by-modelImportId', 'modelImportId');
          }
          if (oldVersion >= 6) {
            db.deleteObjectStore('scenarios');
            const s = db.createObjectStore('scenarios', { keyPath: 'id' });
            s.createIndex('by-modelId', 'modelId');
          }
          if (oldVersion >= 7) {
            db.deleteObjectStore('computedResults');
            const s = db.createObjectStore('computedResults', { keyPath: 'id' });
            s.createIndex('by-modelId', 'modelId');
          }
          if (oldVersion >= 8) {
            db.deleteObjectStore('snapshots');
            const s = db.createObjectStore('snapshots', { keyPath: 'id' });
            s.createIndex('by-companyId', 'companyId');
          }
          if (oldVersion >= 9) {
            db.deleteObjectStore('analysisSettings');
            db.createObjectStore('analysisSettings', { keyPath: 'id' });
          }
          if (oldVersion >= 10) {
            db.deleteObjectStore('analysisResults');
            const s = db.createObjectStore('analysisResults', { keyPath: 'id' });
            s.createIndex('by-modelId', 'modelId');
          }
        }
        // Scenario.driverValues' override contract changed from per-cell (a null cell falls back
        // to the model's own value at that cell) to per-line, all-or-nothing (a driverId present
        // at all means its whole array is used verbatim — see lib/scenario.ts). Existing scenario
        // data was written under the old contract and isn't guaranteed to satisfy the new one, so
        // wipe scenarios rather than fold old sparse shapes forward — same "dev/test data, no real
        // companies yet" reasoning as the v11→v12 migration above. computedResults/analysisResults
        // are wiped too: both are version-stamped caches keyed off model/scenario/schema updatedAt,
        // but that stamp can't detect this kind of change — the MERGE FUNCTION changed, not the
        // underlying data, so a cached result computed under the old interpretation could still
        // read as fresh and silently serve a wrong number. snapshots are deliberately left alone:
        // a Snapshot embeds its own already-resolved, frozen outputs rather than re-merging live,
        // so it stays internally consistent regardless of how live merging works today.
        if (oldVersion >= 1 && oldVersion < 13) {
          if (oldVersion >= 6) {
            db.deleteObjectStore('scenarios');
            const s = db.createObjectStore('scenarios', { keyPath: 'id' });
            s.createIndex('by-modelId', 'modelId');
          }
          if (oldVersion >= 7) {
            db.deleteObjectStore('computedResults');
            const s = db.createObjectStore('computedResults', { keyPath: 'id' });
            s.createIndex('by-modelId', 'modelId');
          }
          if (oldVersion >= 10) {
            db.deleteObjectStore('analysisResults');
            const s = db.createObjectStore('analysisResults', { keyPath: 'id' });
            s.createIndex('by-modelId', 'modelId');
          }
        }

        // v14 -> v18 (v15: a line's explicit `role` and projection type — see StatementLine;
        // v16/v17: Hardcode is a projection method of its own, replacing 'actual'; v18: the
        // Basis Template gained a Group column, shifting its periods one column right).
        // No conversion of older saved data — this app is pre-beta, so everything is cleared and
        // re-seeded instead: the default and bundled templates regenerate themselves the next time the
        // template list is read, and models are re-imported.
        if (oldVersion >= 1 && oldVersion < 18) {
          for (const name of Array.from(db.objectStoreNames)) transaction.objectStore(name).clear();
        }
        if (oldVersion < 19) {
          db.createObjectStore('lboCases', { keyPath: 'id' });
        }
        // LboCase dropped its own frozen historicals/driverValues/entryPeriodLabel in favor of
        // resolving the base model's figures live on every evaluation, and financing became
        // per-scenario — a v19 row doesn't satisfy the new shape, so (same pre-beta "wipe and
        // re-seed" convention as v14->v18 above) a case just needs re-enabling, not migrating.
        if (oldVersion >= 19 && oldVersion < 20) {
          transaction.objectStore('lboCases').clear();
        }
        // LboCase gained leverageLinkedTrancheId (a stable reference, not re-derived positionally
        // — see its own doc comment) — same "pre-beta, wipe and re-seed" treatment as v19 -> v20.
        if (oldVersion >= 1 && oldVersion < 21) {
          transaction.objectStore('lboCases').clear();
        }
      },
    });
  }
  return dbPromise;
}
