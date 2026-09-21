import { describe, expect, it, vi } from 'vitest';
import { OpenAiCompatibleProvider, parseJsonLoosely } from './openAiCompatibleProvider';

const request = { system: 'sys', prompt: 'go', schemaName: 'thing', schema: { type: 'object' } };
const reply = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
const make = (responses: Response[]) => {
  const fetchImpl = vi.fn(async () => responses.shift()!);
  const provider = new OpenAiCompatibleProvider({ endpoint: '/x', model: 'm', fetchImpl: fetchImpl as unknown as typeof fetch, sleep: async () => {} });
  return { provider, fetchImpl };
};

describe('parseJsonLoosely', () => {
  it('handles plain, fenced, think-wrapped and prose-wrapped JSON', () => {
    expect(parseJsonLoosely('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonLoosely('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonLoosely('<think>hmm {x}</think>{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonLoosely('Sure! Here it is: {"a":1} Hope that helps')).toEqual({ a: 1 });
    expect(parseJsonLoosely('Thinking Process:\n1. use {braces} like {"x": [1]}\n\nFinal:\n{"a":{"b":2}}')).toEqual({ a: { b: 2 } });
    expect(() => parseJsonLoosely('nothing here')).toThrow();
  });
});

describe('OpenAiCompatibleProvider request body', () => {
  it('maps the effort hint to a reasoning setting only when given', async () => {
    const fetchImpl = vi.fn(async () => reply('{"ok":true}'));
    const provider = new OpenAiCompatibleProvider({ endpoint: '/x', model: 'm', fetchImpl: fetchImpl as unknown as typeof fetch });
    await provider.generateStructured({ ...request, effort: 'medium' });
    await provider.generateStructured(request);
    const bodies = fetchImpl.mock.calls.map((c) => JSON.parse((c as unknown as [string, { body: string }])[1].body));
    expect(bodies[0].reasoning).toEqual({ effort: 'medium' });
    expect('reasoning' in bodies[1]).toBe(false);
  });

  it('merges extraBody and lets null remove a default field', async () => {
    const fetchImpl = vi.fn(async () => reply('{"ok":true}'));
    const provider = new OpenAiCompatibleProvider({
      endpoint: '/x',
      model: 'm',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      extraBody: { reasoning: { effort: 'none' }, response_format: null },
    });
    await provider.generateStructured(request);
    const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body.reasoning).toEqual({ effort: 'none' });
    expect('response_format' in body).toBe(false);
  });
});

describe('OpenAiCompatibleProvider', () => {
  it('sends the schema in the system prompt and returns parsed JSON', async () => {
    const { provider, fetchImpl } = make([reply('{"ok":true}')]);
    expect(await provider.generateStructured(request)).toEqual({ ok: true });
    const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body.model).toBe('m');
    expect(body.messages[0].content).toContain('"thing"');
    expect(body.messages[0].content).toContain('{"type":"object"}');
  });

  it('retries on rate limit, and on invalid JSON with feedback', async () => {
    const { provider, fetchImpl } = make([new Response('slow down', { status: 429 }), reply('not json'), reply('{"ok":1}')]);
    expect(await provider.generateStructured(request)).toEqual({ ok: 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const last = JSON.parse((fetchImpl.mock.calls[2] as unknown as [string, { body: string }])[1].body);
    expect(last.messages.at(-1).content).toContain('not valid JSON');
  });

  it('retries when the reply is JSON but not an object, or the model stopped with an error', async () => {
    const errored = new Response(JSON.stringify({ choices: [{ finish_reason: 'error', message: { content: '{"a":1}' } }] }), { status: 200 });
    const { provider, fetchImpl } = make([reply('1.0000000000000002e+0000'), errored, reply('{"ok":2}')]);
    expect(await provider.generateStructured(request)).toEqual({ ok: 2 });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('fails fast on client errors (bad key, no credit) and after exhausting retries', async () => {
    const a = make([new Response('{"error":"no credit"}', { status: 402 })]);
    await expect(a.provider.generateStructured(request)).rejects.toThrow(/402/);
    expect(a.fetchImpl).toHaveBeenCalledTimes(1);
    const b = make([reply('x'), reply('x'), reply('x')]);
    await expect(b.provider.generateStructured(request)).rejects.toThrow(/after 3 attempts/);
  });
});

describe('OpenAiCompatibleProvider timeout and token cap', () => {
  it('sends a max_tokens cap, overridable through extraBody', async () => {
    const fetchImpl = vi.fn(async () => reply('{"ok":true}'));
    const provider = new OpenAiCompatibleProvider({ endpoint: '/x', model: 'm', fetchImpl: fetchImpl as unknown as typeof fetch });
    await provider.generateStructured(request);
    expect(JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, { body: string }])[1].body).max_tokens).toBe(24_000);
  });

  it('aborts a stalled request and retries it', async () => {
    let calls = 0;
    const fetchImpl = vi.fn((_url: string, init: { signal: AbortSignal }) => {
      calls++;
      if (calls > 1) return Promise.resolve(reply('{"ok":true}'));
      return new Promise<Response>((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
    });
    const provider = new OpenAiCompatibleProvider({ endpoint: '/x', model: 'm', timeoutMs: 20, fetchImpl: fetchImpl as unknown as typeof fetch, sleep: async () => {} });
    await expect(provider.generateStructured(request)).resolves.toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  it('reports a timeout once retries run out', async () => {
    const fetchImpl = vi.fn((_url: string, init: { signal: AbortSignal }) =>
      new Promise<Response>((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))));
    const provider = new OpenAiCompatibleProvider({ endpoint: '/x', model: 'm', timeoutMs: 10, maxRetries: 1, fetchImpl: fetchImpl as unknown as typeof fetch, sleep: async () => {} });
    await expect(provider.generateStructured(request)).rejects.toThrow(/no reply within/);
  });
});
