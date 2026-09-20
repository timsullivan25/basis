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
    expect(() => parseJsonLoosely('nothing here')).toThrow();
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

  it('fails fast on client errors (bad key, no credit) and after exhausting retries', async () => {
    const a = make([new Response('{"error":"no credit"}', { status: 402 })]);
    await expect(a.provider.generateStructured(request)).rejects.toThrow(/402/);
    expect(a.fetchImpl).toHaveBeenCalledTimes(1);
    const b = make([reply('x'), reply('x'), reply('x')]);
    await expect(b.provider.generateStructured(request)).rejects.toThrow(/after 3 attempts/);
  });
});
