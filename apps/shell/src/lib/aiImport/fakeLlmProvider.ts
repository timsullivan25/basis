import type { LlmProvider, StructuredRequest } from './llmProvider';

/** Test double: returns a canned (or computed) response and records every request it was sent. */
export class FakeLlmProvider implements LlmProvider {
  readonly name = 'fake';
  readonly requests: StructuredRequest[] = [];

  private readonly respond: unknown | ((request: StructuredRequest) => unknown);

  constructor(respond: unknown | ((request: StructuredRequest) => unknown)) {
    this.respond = respond;
  }

  async generateStructured(request: StructuredRequest): Promise<unknown> {
    this.requests.push(request);
    return typeof this.respond === 'function'
      ? (this.respond as (request: StructuredRequest) => unknown)(request)
      : this.respond;
  }
}
