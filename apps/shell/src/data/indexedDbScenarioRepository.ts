import type { CreateScenarioInput, Scenario, ScenarioRepository } from './types';
import { openBasisDb } from './db';

export class IndexedDbScenarioRepository implements ScenarioRepository {
  async list(modelId: string): Promise<Scenario[]> {
    const db = await openBasisDb();
    const matches = await db.getAllFromIndex('scenarios', 'by-modelId', modelId);
    // by-modelId alone gives no stable order — sort by createdAt in JS, same as every other
    // list in this app that needs creation order (companies, statement schemas).
    return matches.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async get(id: string): Promise<Scenario | undefined> {
    const db = await openBasisDb();
    return db.get('scenarios', id);
  }

  async create(input: CreateScenarioInput): Promise<Scenario> {
    const db = await openBasisDb();
    const now = new Date().toISOString();
    const scenario: Scenario = { id: crypto.randomUUID(), createdAt: now, updatedAt: now, driverValues: {}, ...input };
    await db.add('scenarios', scenario);
    return scenario;
  }

  async update(id: string, patch: Partial<Pick<Scenario, 'name' | 'driverValues'>>): Promise<Scenario> {
    const db = await openBasisDb();
    const existing = await db.get('scenarios', id);
    if (!existing) throw new Error(`Scenario not found: ${id}`);
    const updated: Scenario = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    await db.put('scenarios', updated);
    return updated;
  }

  async remove(id: string): Promise<void> {
    const db = await openBasisDb();
    await db.delete('scenarios', id);
  }
}
