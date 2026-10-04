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

  async getMany(tuples: Array<{ modelId: string; scenarioId: ScenarioKey; analysisId: string }>): Promise<AnalysisResult[]> {
    const db = await openBasisDb();
    const results = await Promise.all(
      tuples.map((t) => db.get('analysisResults', `${t.modelId}:${t.scenarioId}:${t.analysisId}`)),
    );
    return results.filter((r): r is AnalysisResult => r !== undefined);
  }

  async removeForAnalysis(modelId: string, analysisId: string): Promise<void> {
    const db = await openBasisDb();
    const rows = await db.getAllFromIndex('analysisResults', 'by-modelId', modelId);
    await Promise.all(rows.filter((r) => r.analysisId === analysisId).map((r) => db.delete('analysisResults', r.id)));
  }
}
