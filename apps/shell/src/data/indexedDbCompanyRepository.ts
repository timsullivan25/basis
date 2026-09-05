import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Company, CompanyRepository, CreateCompanyInput } from './types';

interface BasisDb extends DBSchema {
  companies: {
    key: string;
    value: Company;
    indexes: { 'by-createdAt': string };
  };
}

const DB_NAME = 'basis';
const DB_VERSION = 1;

function openBasisDb(): Promise<IDBPDatabase<BasisDb>> {
  return openDB<BasisDb>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      const store = db.createObjectStore('companies', { keyPath: 'id' });
      store.createIndex('by-createdAt', 'createdAt');
    },
  });
}

/** First CompanyRepository adapter. Swap for an API-backed one later without touching callers. */
export class IndexedDbCompanyRepository implements CompanyRepository {
  private dbPromise: Promise<IDBPDatabase<BasisDb>>;

  constructor() {
    this.dbPromise = openBasisDb();
  }

  async list(): Promise<Company[]> {
    const db = await this.dbPromise;
    const companies = await db.getAllFromIndex('companies', 'by-createdAt');
    return companies.reverse();
  }

  async get(id: string): Promise<Company | undefined> {
    const db = await this.dbPromise;
    return db.get('companies', id);
  }

  async create(input: CreateCompanyInput): Promise<Company> {
    const db = await this.dbPromise;
    const company: Company = {
      id: crypto.randomUUID(),
      name: input.name.trim(),
      createdAt: new Date().toISOString(),
    };
    await db.add('companies', company);
    return company;
  }

  async update(id: string, patch: Partial<Omit<Company, 'id'>>): Promise<Company> {
    const db = await this.dbPromise;
    const existing = await db.get('companies', id);
    if (!existing) throw new Error(`Company not found: ${id}`);
    const updated: Company = { ...existing, ...patch };
    await db.put('companies', updated);
    return updated;
  }

  async remove(id: string): Promise<void> {
    const db = await this.dbPromise;
    await db.delete('companies', id);
  }
}
