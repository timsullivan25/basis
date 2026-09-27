import { ANALYSIS_CATALOG } from './analysisCatalog';
import type { AnalysisSettings, AnalysisSettingsRepository } from './types';
import { openBasisDb } from './db';

export class IndexedDbAnalysisSettingsRepository implements AnalysisSettingsRepository {
  async get(modelId: string): Promise<AnalysisSettings | undefined> {
    const db = await openBasisDb();
    return db.get('analysisSettings', modelId);
  }

  async create(modelId: string): Promise<AnalysisSettings> {
    const db = await openBasisDb();
    const now = new Date().toISOString();
    const settings: AnalysisSettings = {
      id: modelId,
      modelId,
      enabledAnalysisIds: ANALYSIS_CATALOG.filter((entry) => entry.defaultEnabled).map((entry) => entry.id),
      dcfInputs: { base: { wacc: null, terminalGrowth: null } },
      recoveryInputs: { base: { method: null, multiple: null, periodIndex: null, directValue: null } },
      createdAt: now,
      updatedAt: now,
    };
    await db.add('analysisSettings', settings);
    return settings;
  }

  async update(
    modelId: string,
    patch: Partial<Pick<AnalysisSettings, 'enabledAnalysisIds' | 'dcfInputs' | 'recoveryInputs'>>,
  ): Promise<AnalysisSettings> {
    const db = await openBasisDb();
    const existing = await db.get('analysisSettings', modelId);
    if (!existing) throw new Error(`AnalysisSettings not found for model: ${modelId}`);
    const updated: AnalysisSettings = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    await db.put('analysisSettings', updated);
    return updated;
  }
}
