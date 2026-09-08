import type { CreateModelImportInput, LineMapping, ModelImport, ModelImportRepository } from './types';
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
      statementSchemaId: input.statementSchemaId,
      fileName: input.file.name,
      fileSize: input.file.size,
      uploadedAt: new Date().toISOString(),
      file: input.file,
      ...(input.mapping ? { mapping: input.mapping, mappedAt: new Date().toISOString() } : {}),
    };
    await db.add('modelImports', modelImport);
    return modelImport;
  }

  async saveMapping(id: string, mapping: LineMapping[]): Promise<ModelImport> {
    const db = await openBasisDb();
    const existing = await db.get('modelImports', id);
    if (!existing) throw new Error(`Model import not found: ${id}`);
    const updated: ModelImport = { ...existing, mapping, mappedAt: new Date().toISOString() };
    await db.put('modelImports', updated);
    return updated;
  }

  async remove(id: string): Promise<void> {
    const db = await openBasisDb();
    await db.delete('modelImports', id);
  }
}
