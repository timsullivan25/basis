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
    const root = input.originalFile ?? input.file;
    const modelImport: ModelImport = {
      id: crypto.randomUUID(),
      companyId: input.companyId,
      templateType: input.templateType,
      statementSchemaId: input.statementSchemaId,
      fileName: root.name,
      fileSize: root.size,
      uploadedAt: new Date().toISOString(),
      file: input.file,
      ...(input.originalFile ? { originalFile: input.originalFile } : {}),
    };
    await db.add('modelImports', modelImport);
    return modelImport;
  }

  async remove(id: string): Promise<void> {
    const db = await openBasisDb();
    await db.delete('modelImports', id);
  }
}
