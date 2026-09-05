import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Company, StatementSchema } from './types';

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
}

const DB_NAME = 'basis';
const DB_VERSION = 2;

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
      },
    });
  }
  return dbPromise;
}
