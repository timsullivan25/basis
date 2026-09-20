import { DemoLlmProvider } from './demoProvider';
import type { LlmProvider } from './llmProvider';
import { OpenAiCompatibleProvider } from './openAiCompatibleProvider';

/**
 * The one place that picks which model backs the AI importer — same role as `data/index.ts` for storage.
 * With LLM_* set in `.env.local` the dev server proxies to that OpenAI-compatible API (key stays
 * server-side); otherwise the demo provider is used. A corporate deployment points `endpoint` at its own
 * backend, or swaps in a different adapter here.
 */
export function getLlmProvider(): LlmProvider {
  if (__LLM_MODEL__) {
    const extraBody = __LLM_EXTRA_BODY__ ? (JSON.parse(__LLM_EXTRA_BODY__) as Record<string, unknown>) : undefined;
    return new OpenAiCompatibleProvider({ endpoint: '/api/llm/chat/completions', model: __LLM_MODEL__, extraBody });
  }
  return new DemoLlmProvider();
}
