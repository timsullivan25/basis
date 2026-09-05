import type { StatementSchema, StatementSchemaRepository } from './types';
import { openBasisDb, STATEMENT_SCHEMA_KEY } from './db';
import { createDefaultStatementSchema } from './defaultStatementSchema';

/** First StatementSchemaRepository adapter. Swap for an API-backed one later without touching callers. */
export class IndexedDbStatementSchemaRepository implements StatementSchemaRepository {
  async get(): Promise<StatementSchema> {
    const db = await openBasisDb();
    const existing = await db.get('statementSchema', STATEMENT_SCHEMA_KEY);
    return existing ?? createDefaultStatementSchema();
  }

  async save(schema: StatementSchema): Promise<void> {
    const db = await openBasisDb();
    await db.put('statementSchema', schema, STATEMENT_SCHEMA_KEY);
  }
}
