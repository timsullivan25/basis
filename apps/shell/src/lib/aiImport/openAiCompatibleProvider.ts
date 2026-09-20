import type { LlmProvider, StructuredRequest } from './llmProvider';

export interface OpenAiCompatibleOptions {
  /** Full URL of the chat-completions endpoint (in dev, the Vite proxy that adds the API key). */
  endpoint: string;
  model: string;
  /** Provider-specific fields merged into every request body — e.g. OpenRouter's `{ reasoning: { enabled: false } }` to skip a reasoning model's slow thinking phase. */
  extraBody?: Record<string, unknown>;
  /** Extra attempts after the first when the call is rate-limited, fails upstream, or returns unparseable JSON. */
  maxRetries?: number;
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

  private readonly options: Required<Pick<OpenAiCompatibleOptions, 'maxRetries'>> & OpenAiCompatibleOptions;

  constructor(options: OpenAiCompatibleOptions) {
    this.options = { maxRetries: 2, ...options };
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

      const response = await fetchImpl(this.options.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.options.model,
          messages,
          response_format: { type: 'json_object' },
          temperature: 0,
          ...this.options.extraBody,
        }),
      });

      if (response.status === 429 || response.status >= 500) {
        lastError = `HTTP ${response.status}: ${await errorText(response)}`;
        continue;
      }
      if (!response.ok) throw new Error(`LLM request failed (HTTP ${response.status}): ${await errorText(response)}`);

      const content = extractContent(await response.json());
      if (content === undefined) {
        lastError = 'response had no message content';
        continue;
      }
      try {
        return parseJsonLoosely(content);
      } catch (error) {
        lastError = `reply was not valid JSON (${error instanceof Error ? error.message : String(error)})`;
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

/** Parses JSON from a model reply, tolerating the wrappers models commonly add: <think> blocks, code fences, surrounding prose. */
export function parseJsonLoosely(text: string): unknown {
  const stripped = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  try {
    return JSON.parse(stripped);
  } catch {
    const fenced = stripped.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) return JSON.parse(fenced[1].trim());
    const start = stripped.indexOf('{');
    const end = stripped.lastIndexOf('}');
    if (start !== -1 && end > start) return JSON.parse(stripped.slice(start, end + 1));
    throw new Error('no JSON object found');
  }
}
