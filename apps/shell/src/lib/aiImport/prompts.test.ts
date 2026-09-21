import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initAiSettings, loadAiSettings, resetAiSettingsForTests, setPassEnabled, setPromptOverride } from './aiSettings';
import { getPrompt, PROMPTS } from './prompts';

const puts: string[] = [];
function stubEndpoint(saved: unknown = {}) {
  vi.stubGlobal('fetch', async (_url: string, init?: { method?: string; body?: string }) => {
    if (init?.method === 'PUT') { puts.push(init.body ?? ''); return { ok: true, json: async () => ({}) }; }
    return { ok: true, json: async () => saved };
  });
}

describe('prompt registry and AI settings', () => {
  beforeEach(() => { puts.length = 0; resetAiSettingsForTests(); stubEndpoint(); });
  afterEach(() => vi.unstubAllGlobals());

  it('has a non-empty default for every prompt, with unique ids', () => {
    expect(new Set(PROMPTS.map((p) => p.id)).size).toBe(PROMPTS.length);
    for (const p of PROMPTS) expect(p.defaultText.length).toBeGreaterThan(200);
  });

  it('uses an edited prompt until it is reset, and ignores a blank edit', () => {
    const fill = PROMPTS.find((p) => p.id === 'fill')!;
    expect(getPrompt('fill')).toBe(fill.defaultText);
    setPromptOverride('fill', 'Custom instructions');
    expect(getPrompt('fill')).toBe('Custom instructions');
    setPromptOverride('fill', '   ');
    expect(getPrompt('fill')).toBe(fill.defaultText);
    setPromptOverride('fill', 'Custom instructions');
    setPromptOverride('fill', null);
    expect(getPrompt('fill')).toBe(fill.defaultText);
  });

  it('stores pass switches, defaulting every pass on', () => {
    expect(loadAiSettings().passes).toEqual({ fill: true, consolidate: true, checks: true, subLines: true });
    setPassEnabled('checks', false);
    expect(loadAiSettings().passes.checks).toBe(false);
  });

  it('writes every change to the project file through the endpoint', () => {
    setPromptOverride('fill', 'Custom');
    setPassEnabled('fill', false);
    expect(JSON.parse(puts.at(-1)!)).toEqual({ prompts: { fill: 'Custom' }, passes: { fill: false, consolidate: true, checks: true, subLines: true } });
  });

  it('loads the saved file at startup, and keeps the defaults when the endpoint is missing', async () => {
    stubEndpoint({ prompts: { fill: 'Saved' }, passes: { checks: false } });
    await initAiSettings();
    expect(getPrompt('fill')).toBe('Saved');
    expect(loadAiSettings().passes.checks).toBe(false);
    resetAiSettingsForTests();
    vi.stubGlobal('fetch', async () => { throw new Error('no server'); });
    await initAiSettings();
    expect(loadAiSettings().prompts).toEqual({});
  });
});
