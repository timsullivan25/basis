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
      await this.removeComputedResults(existing.id);
      await this.removeAnalysisSettings(existing.id);
      await this.removeAnalysisResults(existing.id);
      await db.delete('mappings', existing.mappingId);
      await db.delete('modelImports', existing.modelImportId);
      // Every model owns a private schema fork (see ModelMappingScreen/cloneStatementSchemaStructure)
      // — nobody else references it, so it's an orphan the instant this model is replaced.
      await db.delete('statementSchema', existing.statementSchemaId);
      await db.delete('models', existing.id);
    }
    const now = new Date().toISOString();
    const model: Model = { id: crypto.randomUUID(), createdAt: now, updatedAt: now, driverValues: {}, ...input };
    await db.add('models', model);
    return model;
  }

  async update(id: string, patch: Partial<Pick<Model, 'name' | 'timeline' | 'historicals' | 'driverValues' | 'circularCalcsEnabled'>>): Promise<Model> {
    const db = await openBasisDb();
    const existing = await db.get('models', id);
    if (!existing) throw new Error(`Model not found: ${id}`);
    const updated: Model = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    await db.put('models', updated);
    return updated;
  }

  async remove(id: string): Promise<void> {
    const db = await openBasisDb();
    const existing = await db.get('models', id);
    if (existing) {
      await this.removeScenarios(existing.id);
      await this.removeComputedResults(existing.id);
      await this.removeAnalysisSettings(existing.id);
      await this.removeAnalysisResults(existing.id);
      await db.delete('mappings', existing.mappingId);
      await db.delete('modelImports', existing.modelImportId);
      await db.delete('statementSchema', existing.statementSchemaId);
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

  /** Same from-day-one invariant as removeScenarios — no computed result should ever outlive the
   *  model it was computed for. */
  private async removeComputedResults(modelId: string): Promise<void> {
    const db = await openBasisDb();
    const results = await db.getAllFromIndex('computedResults', 'by-modelId', modelId);
    await Promise.all(results.map((r) => db.delete('computedResults', r.id)));
  }

  /** Same from-day-one invariant, at analysisSettings' own primary key (id === modelId, no index
   *  scan needed). */
  private async removeAnalysisSettings(modelId: string): Promise<void> {
    const db = await openBasisDb();
    await db.delete('analysisSettings', modelId);
  }

  /** Same from-day-one invariant as removeScenarios/removeComputedResults — no cached analysis
   *  output should ever outlive the model it was computed for. */
  private async removeAnalysisResults(modelId: string): Promise<void> {
    const db = await openBasisDb();
    const results = await db.getAllFromIndex('analysisResults', 'by-modelId', modelId);
    await Promise.all(results.map((r) => db.delete('analysisResults', r.id)));
  }
}
