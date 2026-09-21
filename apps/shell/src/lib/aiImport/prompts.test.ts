import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadAiSettings, setPassEnabled, setPromptOverride } from './aiSettings';
import { getPrompt, PROMPTS } from './prompts';

function stubStorage() {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) });
}

describe('prompt registry and AI settings', () => {
  beforeEach(stubStorage);
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

  it('falls back to defaults when storage is unavailable', () => {
    vi.unstubAllGlobals();
    expect(loadAiSettings().prompts).toEqual({});
  });
});
