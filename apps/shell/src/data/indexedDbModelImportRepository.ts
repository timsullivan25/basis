import type { CreateModelImportInput, ModelImport, ModelImportRepository } from './types';
import { openBasisDb } from './db';

/** First ModelImportRepository adapter. Swap for an API-backed one later without touching callers. */
export class IndexedDbModelImportRepository implements ModelImportRepository {
  async getForCompany(companyId: string): Promise<ModelImport | undefined> {
    const db = await openBasisDb();
    const matches = await db.getAllFromIndex('modelImports', 'by-companyId', companyId);
    return matches[0];
  }

  async create(input: CreateModelImportInput): Promise<ModelImport> {
    const db = await openBasisDb();
    const existing = await this.getForCompany(input.companyId);
    if (existing) await db.delete('modelImports', existing.id);

    const modelImport: ModelImport = {
      id: crypto.randomUUID(),
      companyId: input.companyId,
      templateType: input.templateType,
      fileName: input.file.name,
      fileSize: input.file.size,
      uploadedAt: new Date().toISOString(),
      file: input.file,
    };
    await db.add('modelImports', modelImport);
    return modelImport;
  }

  async remove(id: string): Promise<void> {
    const db = await openBasisDb();
    await db.delete('modelImports', id);
  }
}
