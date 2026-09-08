import type { CreateMappingInput, LineMapping, Mapping, MappingRepository } from './types';
import { openBasisDb } from './db';

/** First MappingRepository adapter. Swap for an API-backed one later without touching callers. */
export class IndexedDbMappingRepository implements MappingRepository {
  async get(id: string): Promise<Mapping | undefined> {
    const db = await openBasisDb();
    return db.get('mappings', id);
  }

  async create(input: CreateMappingInput): Promise<Mapping> {
    const db = await openBasisDb();
    const mapping: Mapping = { id: crypto.randomUUID(), mappedAt: new Date().toISOString(), ...input };
    await db.add('mappings', mapping);
    return mapping;
  }

  async save(id: string, lines: LineMapping[]): Promise<Mapping> {
    const db = await openBasisDb();
    const existing = await db.get('mappings', id);
    if (!existing) throw new Error(`Mapping not found: ${id}`);
    const updated: Mapping = { ...existing, lines, mappedAt: new Date().toISOString() };
    await db.put('mappings', updated);
    return updated;
  }
}
