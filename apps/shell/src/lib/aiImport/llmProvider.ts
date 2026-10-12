/** A JSON Schema object describing the shape a provider must return. Kept opaque here — each adapter passes it to its own structured-output mechanism. */
export type JsonSchema = Record<string, unknown>;

export interface StructuredRequest {
  system: string;
  prompt: string;
  /** Identifier for the schema (e.g. a tool name), for adapters whose structured-output API wants one. */
  schemaName: string;
  schema: JsonSchema;
  /** How much deliberation the task deserves. Adapters map it to their model's own setting (or ignore it); unset means the adapter's default. */
  effort?: 'none' | 'low' | 'medium' | 'high';
}

/**
 * The one seam between Basis and whichever model does the work. Task logic (prompting, validation,
 * template generation) lives outside this and never imports a vendor SDK, so swapping models or
 * vendors means writing one adapter — same idea as the repositories in `data/`.
 *
 * Returns `unknown` on purpose: providers guarantee JSON, not that it matches the schema, so callers
 * validate before trusting it.
 */
export interface LlmProvider {
  readonly name: string;
  generateStructured(request: StructuredRequest): Promise<unknown>;
}
