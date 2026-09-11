import type { AnalysisResult, AnalysisResultRepository, ScenarioKey } from './types';
import { openBasisDb } from './db';

export class IndexedDbAnalysisResultRepository implements AnalysisResultRepository {
  async get(modelId: string, scenarioId: ScenarioKey, analysisId: string): Promise<AnalysisResult | undefined> {
    const db = await openBasisDb();
    return db.get('analysisResults', `${modelId}:${scenarioId}:${analysisId}`);
  }

  async set(result: AnalysisResult): Promise<void> {
    const db = await openBasisDb();
    await db.put('analysisResults', result);
  }
}
