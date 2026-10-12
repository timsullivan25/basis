import type { ComputedResult, ComputedResultRepository, ScenarioKey } from './types';
import { openBasisDb } from './db';

export class IndexedDbComputedResultRepository implements ComputedResultRepository {
  async get(modelId: string, scenarioId: ScenarioKey): Promise<ComputedResult | undefined> {
    const db = await openBasisDb();
    return db.get('computedResults', `${modelId}:${scenarioId}`);
  }

  async set(result: ComputedResult): Promise<void> {
    const db = await openBasisDb();
    await db.put('computedResults', result);
  }
}
