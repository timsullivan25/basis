import { describe, expect, it } from 'vitest';
import type { LineMapping, ParsedWorkbook, StatementLine, StatementSection } from '../../data';
import { FakeLlmProvider } from './fakeLlmProvider';
import { suggestMappings } from './suggestMappings';

const line = (id: string, name: string): StatementLine => ({
  id, name, role: 'required', rowFormat: 'normal', numberFormat: 'number', sign: 'natural', aggregation: 'sum', formula: null, projection: null, aliases: [],
});
const section: StatementSection = { id: 's', name: 'Income Statement', lines: [line('rev', 'Revenue'), line('cogs', 'Cost of Goods Sold'), line('ebit', 'EBIT')] };
const workbook: ParsedWorkbook = {
  periods: [{ type: 'FY', date: '', name: 'FY24' }],
  lines: [
    { id: 'a', section: 'IS', name: 'Net Sales', values: [100] },
    { id: 'b', section: 'IS', name: 'Cost of Sales', values: [60] },
    { id: 'c', section: 'IS', name: 'Operating Income', values: [40] },
  ],
};
const unmapped = (id: string): LineMapping => ({ targetLineId: id, sourceLineIds: [], method: 'none', confidence: 0, note: '', approved: false });
const settled = (m?: LineMapping) => (m?.sourceLineIds.length ?? 0) > 0;
const targets = section.lines.map((l) => ({ line: l, section }));

describe('suggestMappings', () => {
  it('turns valid suggestions into review-flagged ai mappings and drops invented ids and unknown targets', async () => {
    const provider = new FakeLlmProvider({
      matches: [
        { target: 'rev', sources: ['a'], confidence: 'high', reason: 'Net sales is revenue.' },
        { target: 'cogs', sources: ['nope'], confidence: 'high', reason: 'x' },
        { target: 'ghost', sources: ['c'], confidence: 'high', reason: 'x' },
        { target: 'ebit', sources: [], confidence: 'low', reason: 'unsure' },
      ],
    });
    const result = await suggestMappings(provider, targets, workbook, { rev: unmapped('rev'), cogs: unmapped('cogs'), ebit: unmapped('ebit') }, settled);
    expect(Object.keys(result)).toEqual(['rev']);
    expect(result.rev).toMatchObject({ sourceLineIds: ['a'], method: 'ai', confidence: 0.75, approved: false });
    expect(result.rev.confidence).toBeLessThan(0.8);
  });

  it('only asks about unresolved targets, marks lines used by settled ones, and sends latest values', async () => {
    const provider = new FakeLlmProvider({ matches: [{ target: 'cogs', sources: ['a'], confidence: 'high', reason: 'x' }] });
    const current = { rev: { ...unmapped('rev'), sourceLineIds: ['a'], method: 'exact' as const }, cogs: unmapped('cogs'), ebit: unmapped('ebit') };
    const result = await suggestMappings(provider, targets, workbook, current, settled);
    const prompt = provider.requests[0].prompt;
    expect(prompt).toContain('name=Cost of Goods Sold');
    expect(prompt).not.toContain('name=Revenue');
    expect(prompt).toContain('latest=100 | (already used by "Revenue")');
    expect(result).toEqual({}); // 'a' is already used, so that suggestion is dropped
  });

  it('makes no request when everything is settled', async () => {
    const provider = new FakeLlmProvider({ matches: [] });
    const all = Object.fromEntries(section.lines.map((l) => [l.id, { ...unmapped(l.id), sourceLineIds: ['a'] }]));
    expect(await suggestMappings(provider, targets, workbook, all, settled)).toEqual({});
    expect(provider.requests).toHaveLength(0);
  });
});
