import type { LlmProvider, StructuredRequest } from './llmProvider';

export interface OpenAiCompatibleOptions {
  /** Full URL of the chat-completions endpoint (in dev, the Vite proxy that adds the API key). */
  endpoint: string;
  model: string;
  /** Provider-specific fields merged into every request body — e.g. OpenRouter's `{ reasoning: { effort: 'none' } }` to skip a reasoning model's slow thinking phase. A null value removes a default field such as `response_format`. */
  extraBody?: Record<string, unknown>;
  /** Extra attempts after the first when the call is rate-limited, fails upstream, or returns unparseable JSON. */
  maxRetries?: number;
  /** Give up on one request after this long (default 4 minutes) and treat it like a failed attempt, so a stalled or runaway generation retries instead of hanging the import. */
  timeoutMs?: number;
  /** Cap on generated tokens per request (default 24,000 — the largest legitimate plan seen is ~13k). A model that loops forever stops here instead of at the provider's own, far larger, limit. Override via extraBody. */
  maxTokens?: number;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
  /** Injectable so tests don't wait on backoff. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Adapter for any OpenAI-compatible chat-completions API — OpenRouter, Ollama, vLLM, Azure OpenAI, most
 * corporate gateways. The schema goes in the prompt (works on every model) and JSON mode is requested;
 * callers still validate the result, so a model that ignores the schema is caught downstream.
 */
export class OpenAiCompatibleProvider implements LlmProvider {
  readonly name: string;

  private readonly options: Required<Pick<OpenAiCompatibleOptions, 'maxRetries' | 'timeoutMs' | 'maxTokens'>> & OpenAiCompatibleOptions;

  constructor(options: OpenAiCompatibleOptions) {
    this.options = { maxRetries: 2, timeoutMs: 240_000, maxTokens: 24_000, ...options };
    this.name = `openai-compatible:${options.model}`;
  }

  async generateStructured(request: StructuredRequest): Promise<unknown> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const sleep = this.options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    const messages: { role: string; content: string }[] = [
      { role: 'system', content: `${request.system}\n\n${schemaInstructions(request)}` },
      { role: 'user', content: request.prompt },
    ];

    let lastError = 'no attempt made';
    for (let attempt = 0; attempt <= this.options.maxRetries; attempt++) {
      if (attempt > 0) await sleep(1000 * 2 ** (attempt - 1));

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
      let response: Response;
      try {
        response = await fetchImpl(this.options.endpoint, {
          signal: controller.signal,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            // A null in extraBody removes that default field (e.g. `"response_format": null` turns JSON mode off).
            Object.fromEntries(
              Object.entries({
                model: this.options.model,
                messages,
                response_format: { type: 'json_object' },
                temperature: 0,
                max_tokens: this.options.maxTokens,
                ...(request.effort ? { reasoning: { effort: request.effort } } : {}),
                ...this.options.extraBody,
              }).filter(
                ([, value]) => value !== null,
              ),
            ),
          ),
        });
      } catch (error) {
        if (!controller.signal.aborted) throw error;
        lastError = `no reply within ${Math.round(this.options.timeoutMs / 1000)}s`;
        continue;
      } finally {
        clearTimeout(timer);
      }

      if (response.status === 429 || response.status >= 500) {
        lastError = `HTTP ${response.status}: ${await errorText(response)}`;
        continue;
      }
      if (!response.ok) throw new Error(`LLM request failed (HTTP ${response.status}): ${await errorText(response)}`);

      const body = await response.json();
      const finish = (body as { choices?: { finish_reason?: string }[] })?.choices?.[0]?.finish_reason;
      if (finish === 'error' || finish === 'length') {
        lastError = `the model stopped early (finish_reason: ${finish})`;
        continue;
      }
      const content = extractContent(body);
      if (content === undefined) {
        lastError = 'response had no message content';
        continue;
      }
      try {
        const parsed = parseJsonLoosely(content);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('expected a JSON object');
        return parsed;
      } catch (error) {
        lastError = `reply was not a valid JSON object (${error instanceof Error ? error.message : String(error)})`;
        // Show the model its own bad output so the retry can correct it.
        messages.push(
          { role: 'assistant', content },
          { role: 'user', content: 'That was not valid JSON. Reply again with ONLY the JSON object — no prose, no code fences.' },
        );
      }
    }
    throw new Error(`LLM call failed after ${this.options.maxRetries + 1} attempts: ${lastError}`);
  }
}

function schemaInstructions(request: StructuredRequest): string {
  return [
    `Reply with ONLY a single JSON object (no prose, no markdown fences) that conforms to this JSON Schema, named "${request.schemaName}":`,
    JSON.stringify(request.schema),
  ].join('\n');
}

async function errorText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 300);
  } catch {
    return response.statusText;
  }
}

function extractContent(body: unknown): string | undefined {
  const content = (body as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]?.message?.content;
  return typeof content === 'string' && content.trim() ? content : undefined;
}

/** Parses JSON from a model reply, tolerating the wrappers models commonly add: <think> blocks, code fences, prose — including a visible "thinking process" before the answer, in which case the last JSON object is the answer. */
export function parseJsonLoosely(text: string): unknown {
  const stripped = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  try {
    return JSON.parse(stripped);
  } catch {
    const fenced = stripped.match(/```(?:json)?\s*([\s\S]*?)```(?![\s\S]*```)/);
    if (fenced) {
      try {
        return JSON.parse(fenced[1].trim());
      } catch {
        // fall through to brace matching
      }
    }
    const last = lastJsonObject(stripped);
    if (last !== undefined) return last;
    throw new Error('no JSON object found');
  }
}

/** The last top-level `{...}` in the text that parses as JSON, found by brace matching from the end. */
function lastJsonObject(text: string): unknown {
  for (let end = text.lastIndexOf('}'); end !== -1; end = text.lastIndexOf('}', end - 1)) {
    let depth = 0;
    for (let i = end; i >= 0; i--) {
      if (text[i] === '}') depth++;
      else if (text[i] === '{' && --depth === 0) {
        try {
          return JSON.parse(text.slice(i, end + 1));
        } catch {
          break;
        }
      }
    }
  }
  return undefined;
}
