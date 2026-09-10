import type { CreateSnapshotInput, Snapshot, SnapshotRepository } from './types';
import { openBasisDb } from './db';

export class IndexedDbSnapshotRepository implements SnapshotRepository {
  async list(companyId: string): Promise<Snapshot[]> {
    const db = await openBasisDb();
    const matches = await db.getAllFromIndex('snapshots', 'by-companyId', companyId);
    // Newest first — a History list is read chronologically backwards, unlike every other list
    // in this app (companies, schemas, scenarios), which reads forward by createdAt.
    return matches.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async get(id: string): Promise<Snapshot | undefined> {
    const db = await openBasisDb();
    return db.get('snapshots', id);
  }

  async create(input: CreateSnapshotInput): Promise<Snapshot> {
    const db = await openBasisDb();
    const snapshot: Snapshot = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...input };
    await db.add('snapshots', snapshot);
    return snapshot;
  }
}
