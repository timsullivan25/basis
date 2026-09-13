import type { StatementSchema, StatementSchemaRepository } from './types';
import { openBasisDb } from './db';
import { createDefaultStatementSchema } from './defaultStatementSchema';
import { cloneStatementSchemaStructure } from '../lib/statementSchemaClone';

/** First StatementSchemaRepository adapter. Swap for an API-backed one later without touching callers. */
export class IndexedDbStatementSchemaRepository implements StatementSchemaRepository {
  /** Real templates only — every model forks its own private copy at creation (see
   *  ModelMappingScreen), so the store fills up with one `copiedFromSchemaId`-set row per model
   *  over time. Those are never meant to be picked as a starting point for another model, or
   *  managed from the template library (StatementDefinitionsScreen) — a model's own copy is
   *  only ever edited from within that model's own screen. Filtered out here, the one place
   *  both current callers read the list from, rather than in each caller. */
  async list(): Promise<StatementSchema[]> {
    const db = await openBasisDb();
    const existing = await db.getAllFromIndex('statementSchema', 'by-createdAt');
    if (existing.length > 0) return existing.filter((s) => !s.copiedFromSchemaId);

    // put (not add): concurrent calls on an empty store (e.g. two screens mounting at once)
    // all seed the same fixed id, so they converge on one row instead of racing to add duplicates.
    const seeded = createDefaultStatementSchema();
    await db.put('statementSchema', seeded);
    return [seeded];
  }

  async get(id: string): Promise<StatementSchema | undefined> {
    const db = await openBasisDb();
    return db.get('statementSchema', id);
  }

  async create(input: { name: string }): Promise<StatementSchema> {
    const db = await openBasisDb();
    const now = new Date().toISOString();
    const schema: StatementSchema = {
      id: crypto.randomUUID(),
      name: input.name,
      createdAt: now,
      updatedAt: now,
      sections: [],
      drivers: [],
    };
    await db.add('statementSchema', schema);
    return schema;
  }

  /** Persists immediately — for the template library's explicit "Duplicate" action. See
   *  cloneStatementSchemaStructure for the (pure, no-DB) cloning logic itself, which
   *  ModelMappingScreen also uses directly (without persisting) to fork a new model's schema
   *  in-memory the moment a template is chosen. */
  async duplicate(id: string, name: string): Promise<{ schema: StatementSchema; idMap: Map<string, string> }> {
    const db = await openBasisDb();
    const source = await db.get('statementSchema', id);
    if (!source) throw new Error(`Statement schema not found: ${id}`);
    const { schema, idMap } = cloneStatementSchemaStructure(source, crypto.randomUUID(), name);
    await db.add('statementSchema', schema);
    return { schema, idMap };
  }

  async save(schema: StatementSchema): Promise<StatementSchema> {
    const db = await openBasisDb();
    const updated: StatementSchema = { ...schema, updatedAt: new Date().toISOString() };
    await db.put('statementSchema', updated);
    return updated;
  }

  async remove(id: string): Promise<void> {
    const db = await openBasisDb();
    await db.delete('statementSchema', id);
  }
}
