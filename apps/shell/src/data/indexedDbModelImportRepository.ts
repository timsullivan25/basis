import type { CreateModelImportInput, ModelImport, ModelImportRepository } from './types';
import { openBasisDb } from './db';

/** First ModelImportRepository adapter. Swap for an API-backed one later without touching callers. */
export class IndexedDbModelImportRepository implements ModelImportRepository {
  async get(id: string): Promise<ModelImport | undefined> {
    const db = await openBasisDb();
    return db.get('modelImports', id);
  }

  async create(input: CreateModelImportInput): Promise<ModelImport> {
    const db = await openBasisDb();
    const modelImport: ModelImport = {
      id: crypto.randomUUID(),
      companyId: input.companyId,
      templateType: input.templateType,
      statementSchemaId: input.statementSchemaId,
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
