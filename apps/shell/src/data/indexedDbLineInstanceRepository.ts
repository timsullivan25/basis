import type { CreateLineInstanceInput, LineInstance, LineInstanceContent, LineInstanceRepository } from './types';
import { openBasisDb } from './db';

export class IndexedDbLineInstanceRepository implements LineInstanceRepository {
  async list(modelId: string): Promise<LineInstance[]> {
    const db = await openBasisDb();
    const matches = await db.getAllFromIndex('lineInstances', 'by-modelId', modelId);
    // by-modelId alone gives no stable order — sort by createdAt in JS, same convention as
    // every other list in this app that needs creation order (companies, scenarios).
    return matches.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async get(id: string): Promise<LineInstance | undefined> {
    const db = await openBasisDb();
    return db.get('lineInstances', id);
  }

  async create(input: CreateLineInstanceInput): Promise<LineInstance> {
    const db = await openBasisDb();
    const now = new Date().toISOString();
    const instance: LineInstance = { id: crypto.randomUUID(), createdAt: now, updatedAt: now, ...input };
    await db.add('lineInstances', instance);
    await this.touchModel(input.modelId);
    return instance;
  }

  async update(id: string, patch: Partial<LineInstanceContent>): Promise<LineInstance> {
    const db = await openBasisDb();
    const existing = await db.get('lineInstances', id);
    if (!existing) throw new Error(`LineInstance not found: ${id}`);
    const updated: LineInstance = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    await db.put('lineInstances', updated);
    await this.touchModel(existing.modelId);
    return updated;
  }

  async remove(id: string): Promise<void> {
    const db = await openBasisDb();
    const existing = await db.get('lineInstances', id);
    await db.delete('lineInstances', id);
    // Bump the owning model's instancesUpdatedAt even on removal — a stored aggregate, not one
    // derived from the surviving instances' own updatedAt fields, precisely because removing an
    // instance changes the model's computed output without necessarily changing the max
    // updatedAt among what's left. See Model.instancesUpdatedAt's own doc comment.
    if (existing) await this.touchModel(existing.modelId);
  }

  /** Reaches directly into the models store rather than going through ModelRepository.update()
   *  (whose patch type deliberately excludes this field) — the same cross-store-write pattern
   *  IndexedDbModelRepository's own cascade deletes already use elsewhere in this file's sibling
   *  repositories. */
  private async touchModel(modelId: string): Promise<void> {
    const db = await openBasisDb();
    const model = await db.get('models', modelId);
    if (!model) return;
    await db.put('models', { ...model, instancesUpdatedAt: new Date().toISOString() });
  }
}
