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
    return this.updateWith(modelId, () => patch);
  }

  async updateWith(
    modelId: string,
    buildPatch: (existing: LboCase) => Partial<Pick<LboCase, 'schema' | 'financing' | 'leverageLinkedTrancheId'>>,
  ): Promise<LboCase> {
    const db = await openBasisDb();
    // One readwrite transaction for the read and the write, so IndexedDB serializes concurrent
    // updates instead of letting them interleave.
    const tx = db.transaction('lboCases', 'readwrite');
    const existing = await tx.store.get(modelId);
    if (!existing) throw new Error(`LboCase not found for model: ${modelId}`);
    const updated: LboCase = { ...existing, ...buildPatch(existing), updatedAt: new Date().toISOString() };
    await tx.store.put(updated);
    await tx.done;
    return updated;
  }

  async remove(modelId: string): Promise<void> {
    const db = await openBasisDb();
    await db.delete('lboCases', modelId);
  }
}
