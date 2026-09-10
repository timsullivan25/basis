import type { CreateModelInput, Model, ModelRepository } from './types';
import { openBasisDb } from './db';

/** First ModelRepository adapter. Swap for an API-backed one later without touching callers. */
export class IndexedDbModelRepository implements ModelRepository {
  async getForCompany(companyId: string): Promise<Model | undefined> {
    const db = await openBasisDb();
    const matches = await db.getAllFromIndex('models', 'by-companyId', companyId);
    return matches[0];
  }

  async create(input: CreateModelInput): Promise<Model> {
    const db = await openBasisDb();
    const existing = await this.getForCompany(input.companyId);
    if (existing) {
      await this.removeScenarios(existing.id);
      await db.delete('mappings', existing.mappingId);
      await db.delete('modelImports', existing.modelImportId);
      await db.delete('models', existing.id);
    }
    const model: Model = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), driverValues: {}, ...input };
    await db.add('models', model);
    return model;
  }

  async update(id: string, patch: Partial<Pick<Model, 'name' | 'timeline' | 'historicals' | 'driverValues'>>): Promise<Model> {
    const db = await openBasisDb();
    const existing = await db.get('models', id);
    if (!existing) throw new Error(`Model not found: ${id}`);
    const updated: Model = { ...existing, ...patch };
    await db.put('models', updated);
    return updated;
  }

  async remove(id: string): Promise<void> {
    const db = await openBasisDb();
    const existing = await db.get('models', id);
    if (existing) {
      await this.removeScenarios(existing.id);
      await db.delete('mappings', existing.mappingId);
      await db.delete('modelImports', existing.modelImportId);
    }
    await db.delete('models', id);
  }

  /** No existing model had scenarios before this field existed, so this is a from-day-one
   *  invariant, not a migration: nothing should ever orphan a model's scenarios in IndexedDB. */
  private async removeScenarios(modelId: string): Promise<void> {
    const db = await openBasisDb();
    const scenarios = await db.getAllFromIndex('scenarios', 'by-modelId', modelId);
    await Promise.all(scenarios.map((s) => db.delete('scenarios', s.id)));
  }
}
