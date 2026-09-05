import type { Company, CompanyRepository, CreateCompanyInput } from './types';
import { openBasisDb } from './db';

/** First CompanyRepository adapter. Swap for an API-backed one later without touching callers. */
export class IndexedDbCompanyRepository implements CompanyRepository {
  async list(): Promise<Company[]> {
    const db = await openBasisDb();
    const companies = await db.getAllFromIndex('companies', 'by-createdAt');
    return companies.reverse();
  }

  async get(id: string): Promise<Company | undefined> {
    const db = await openBasisDb();
    return db.get('companies', id);
  }

  async create(input: CreateCompanyInput): Promise<Company> {
    const db = await openBasisDb();
    const company: Company = {
      id: crypto.randomUUID(),
      name: input.name.trim(),
      createdAt: new Date().toISOString(),
    };
    await db.add('companies', company);
    return company;
  }

  async update(id: string, patch: Partial<Omit<Company, 'id'>>): Promise<Company> {
    const db = await openBasisDb();
    const existing = await db.get('companies', id);
    if (!existing) throw new Error(`Company not found: ${id}`);
    const updated: Company = { ...existing, ...patch };
    await db.put('companies', updated);
    return updated;
  }

  async remove(id: string): Promise<void> {
    const db = await openBasisDb();
    await db.delete('companies', id);
  }
}
