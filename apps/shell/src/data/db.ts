import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Company, ModelImport, StatementSchema } from './types';

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
}

const DB_NAME = 'basis';
const DB_VERSION = 4;

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
      },
    });
  }
  return dbPromise;
}
