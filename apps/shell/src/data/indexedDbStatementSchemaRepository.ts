import type { StatementLine, StatementSchema, StatementSchemaRepository, StatementSection } from './types';
import { openBasisDb } from './db';
import { createDefaultStatementSchema } from './defaultStatementSchema';

function cloneSection(section: StatementSection): StatementSection {
  return {
    id: crypto.randomUUID(),
    name: section.name,
    lines: section.lines.map((l): StatementLine => ({ ...l, id: crypto.randomUUID() })),
  };
}

/** First StatementSchemaRepository adapter. Swap for an API-backed one later without touching callers. */
export class IndexedDbStatementSchemaRepository implements StatementSchemaRepository {
  async list(): Promise<StatementSchema[]> {
    const db = await openBasisDb();
    const existing = await db.getAllFromIndex('statementSchema', 'by-createdAt');
    if (existing.length > 0) return existing;

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
    const schema: StatementSchema = {
      id: crypto.randomUUID(),
      name: input.name,
      createdAt: new Date().toISOString(),
      sections: [],
    };
    await db.add('statementSchema', schema);
    return schema;
  }

  async duplicate(id: string, name: string): Promise<StatementSchema> {
    const db = await openBasisDb();
    const source = await db.get('statementSchema', id);
    if (!source) throw new Error(`Statement schema not found: ${id}`);

    const copy: StatementSchema = {
      id: crypto.randomUUID(),
      name,
      copiedFromSchemaId: source.id,
      createdAt: new Date().toISOString(),
      sections: source.sections.map(cloneSection),
    };
    await db.add('statementSchema', copy);
    return copy;
  }

  async save(schema: StatementSchema): Promise<void> {
    const db = await openBasisDb();
    await db.put('statementSchema', schema);
  }

  async remove(id: string): Promise<void> {
    const db = await openBasisDb();
    await db.delete('statementSchema', id);
  }
}
