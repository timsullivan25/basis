import { describe, expect, it } from 'vitest';
import type { LineMapping, ParsedWorkbook, StatementLine, StatementSection } from '../../data';
import { FakeLlmProvider } from './fakeLlmProvider';
import { suggestConsolidations } from './suggestConsolidations';

const line = (id: string, name: string): StatementLine => ({
  id, name, role: 'optional', rowFormat: 'normal', numberFormat: 'number', sign: 'natural', aggregation: 'sum', formula: null, projection: null, aliases: [],
});
const bs: StatementSection = { id: 'bs', name: 'Balance Sheet', lines: [line('gi', 'Goodwill & Intangibles'), line('cash', 'Cash')] };
const targets = bs.lines.map((l) => ({ line: l, section: bs }));
const workbook: ParsedWorkbook = {
  periods: [{ type: 'FY', date: '', name: 'FY24' }],
  lines: [
    { id: 'intang', section: 'Balance Sheet', name: 'Intangible Assets', values: [500] },
    { id: 'gw', section: 'Balance Sheet', name: 'Goodwill', values: [8000] },
    { id: 'zero', section: 'Balance Sheet', name: 'Inventory', values: [0] },
    { id: 'kpi', section: 'KPIs', name: 'Users', values: [9] },
    { id: 'cashsrc', section: 'Balance Sheet', name: 'Cash', values: [50] },
  ],
};
const m = (id: string, sources: string[], over: Partial<LineMapping> = {}): LineMapping => ({ targetLineId: id, sourceLineIds: sources, method: 'fuzzy', confidence: 0.7, note: '', approved: false, ...over });

describe('suggestConsolidations', () => {
  it('adds an unmapped same-section line onto an existing match, flagged, keeping the old source', async () => {
    const provider = new FakeLlmProvider({ additions: [{ target: 'gi', sources: ['gw', 'kpi', 'nope'], confidence: 'high', reason: 'Goodwill is part of it.' }] });
    const result = await suggestConsolidations(provider, targets, workbook, { gi: m('gi', ['intang']), cash: m('cash', ['cashsrc']) });
    expect(result.gi).toMatchObject({ sourceLineIds: ['intang', 'gw'], method: 'ai', approved: false });
    expect(result.gi.confidence).toBeLessThan(0.8);
    const prompt = provider.requests[0].prompt;
    expect(prompt).toContain('mapped to: Intangible Assets (500)');
    expect(prompt).toContain('id=gw');
    expect(prompt).not.toContain('id=zero'); // all-zero lines carry nothing
    expect(prompt).not.toContain('id=kpi'); // other sections are never offered to Balance Sheet targets
  });

  it('leaves manual and approved targets alone, and asks nothing when nothing is unmapped', async () => {
    const provider = new FakeLlmProvider({ additions: [{ target: 'gi', sources: ['gw'], confidence: 'high', reason: '' }] });
    const manual = await suggestConsolidations(provider, targets, workbook, { gi: m('gi', ['intang'], { method: 'manual' }) });
    expect(manual).toEqual({});
    const allMapped = { gi: m('gi', ['intang', 'gw']), cash: m('cash', ['cashsrc']) };
    const quiet = new FakeLlmProvider({ additions: [] });
    expect(await suggestConsolidations(quiet, targets, workbook, allMapped)).toEqual({});
    expect(quiet.requests).toHaveLength(0);
  });

  it('shows the model check evidence for a section and can be limited to failing sections', async () => {
    const provider = new FakeLlmProvider({ additions: [] });
    await suggestConsolidations(provider, targets, workbook, { gi: m('gi', ['intang']) }, { onlySectionIds: new Set(['bs']), evidenceBySectionId: new Map([['bs', 'CHECK FAILING: gap 8000']]) });
    expect(provider.requests[0].prompt).toContain('CHECK FAILING: gap 8000');
    const none = new FakeLlmProvider({ additions: [] });
    await suggestConsolidations(none, targets, workbook, {}, { onlySectionIds: new Set(['other']) });
    expect(none.requests).toHaveLength(0);
  });

  it('leaves settled matches alone unless asked, but offers unmapped and weak ones', async () => {
    const settledAll = { gi: m('gi', ['intang'], { method: 'exact', confidence: 1 }), cash: m('cash', ['cashsrc'], { method: 'ai', confidence: 0.75 }) };
    const quiet = new FakeLlmProvider({ additions: [] });
    await suggestConsolidations(quiet, targets, workbook, settledAll);
    expect(quiet.requests).toHaveLength(0);
    const forced = new FakeLlmProvider({ additions: [] });
    await suggestConsolidations(forced, targets, workbook, settledAll, { includeSettled: true });
    expect(forced.requests[0].prompt).toContain('name=Goodwill & Intangibles');
    const weak = new FakeLlmProvider({ additions: [] });
    await suggestConsolidations(weak, targets, workbook, { gi: m('gi', ['intang']), cash: m('cash', ['cashsrc'], { method: 'ai', confidence: 0.6 }) });
    const prompt = weak.requests[0].prompt;
    expect(prompt).toContain('name=Goodwill & Intangibles');
    expect(prompt).toContain('name=Cash');
  });
});
