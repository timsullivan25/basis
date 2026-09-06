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
  };
  modelImports: {
    key: string;
    value: ModelImport;
    indexes: { 'by-companyId': string };
  };
}

const DB_NAME = 'basis';
const DB_VERSION = 3;

export const STATEMENT_SCHEMA_KEY = 'default';

let dbPromise: Promise<IDBPDatabase<BasisDb>> | undefined;

export function openBasisDb(): Promise<IDBPDatabase<BasisDb>> {
  if (!dbPromise) {
    dbPromise = openDB<BasisDb>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          const store = db.createObjectStore('companies', { keyPath: 'id' });
          store.createIndex('by-createdAt', 'createdAt');
        }
        if (oldVersion < 2) {
          db.createObjectStore('statementSchema');
        }
        if (oldVersion < 3) {
          const store = db.createObjectStore('modelImports', { keyPath: 'id' });
          store.createIndex('by-companyId', 'companyId');
        }
      },
    });
  }
  return dbPromise;
}
