import { DemoLlmProvider } from './demoProvider';
import type { LlmProvider } from './llmProvider';

/** The one place that picks which model backs the AI importer — same role as `data/index.ts` for storage. Swap the demo for a real adapter here. */
export function getLlmProvider(): LlmProvider {
  return new DemoLlmProvider();
}
