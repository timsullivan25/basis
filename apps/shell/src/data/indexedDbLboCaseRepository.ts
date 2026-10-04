import type { CreateLboCaseInput, LboCase, LboCaseRepository } from './types';
import { openBasisDb } from './db';

export class IndexedDbLboCaseRepository implements LboCaseRepository {
  async get(modelId: string): Promise<LboCase | undefined> {
    const db = await openBasisDb();
    return db.get('lboCases', modelId);
  }

  async create(input: CreateLboCaseInput): Promise<LboCase> {
    const db = await openBasisDb();
    const now = new Date().toISOString();
    const lboCase: LboCase = { ...input, id: input.modelId, createdAt: now, updatedAt: now };
    await db.put('lboCases', lboCase);
    return lboCase;
  }

  async update(modelId: string, patch: Partial<Pick<LboCase, 'schema' | 'financing' | 'leverageLinkedTrancheId'>>): Promise<LboCase> {
    const db = await openBasisDb();
    const existing = await db.get('lboCases', modelId);
    if (!existing) throw new Error(`LboCase not found for model: ${modelId}`);
    const updated: LboCase = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    await db.put('lboCases', updated);
    return updated;
  }

  async remove(modelId: string): Promise<void> {
    const db = await openBasisDb();
    await db.delete('lboCases', modelId);
  }
}
