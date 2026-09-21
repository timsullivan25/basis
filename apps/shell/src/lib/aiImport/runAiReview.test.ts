import { describe, expect, it } from 'vitest';
import type { LineMapping, ParsedWorkbook, StatementLine, StatementSchema } from '../../data';
import { FakeLlmProvider } from './fakeLlmProvider';
import { closingSubsets } from './reviewChecks';
import { runAiReview } from './runAiReview';

const line = (id: string, name: string, over: Partial<StatementLine> = {}): StatementLine => ({
  id, name, role: 'optional', rowFormat: 'normal', numberFormat: 'number', sign: 'natural', aggregation: 'sum', formula: null, projection: null, aliases: [], ...over,
});
const check = line('chk', 'Check', {
  role: 'check',
  formula: { kind: 'bin', op: '-', left: { kind: 'ref', lineId: 'assets' }, right: { kind: 'ref', lineId: 'liab' } },
});
const schema: StatementSchema = {
  id: 's', name: 's', createdAt: '', updatedAt: '', drivers: [],
  sections: [{ id: 'bs', name: 'Balance Sheet', lines: [line('assets', 'Assets'), line('liab', 'Liabilities'), check] }],
};
const targets = schema.sections[0].lines.filter((l) => l.role !== 'check').map((l) => ({ line: l, section: schema.sections[0] }));
const workbook: ParsedWorkbook = {
  periods: [{ type: 'FY', date: '2023-12-31T00:00:00.000Z', name: 'FY23' }, { type: 'FY', date: '2024-12-31T00:00:00.000Z', name: 'FY24' }],
  lines: [
    { id: 'a', section: 'Balance Sheet', name: 'Total Assets', values: [100, 120] },
    { id: 'l', section: 'Balance Sheet', name: 'Total Liabilities', values: [60, 70] },
    { id: 'x', section: 'Balance Sheet', name: 'Equity', values: [40, 50] },
    { id: 'noise', section: 'Balance Sheet', name: 'Other', values: [7, 3] },
  ],
};
const mapped = (id: string, sources: string[]): LineMapping => ({ targetLineId: id, sourceLineIds: sources, method: 'exact', confidence: 1, note: '', approved: false });
const settled = (m?: LineMapping) => (m?.sourceLineIds.length ?? 0) > 0;

describe('closingSubsets', () => {
  it('finds unmapped lines whose values equal the gap in every period, either sign', () => {
    const c = { line: check, section: schema.sections[0], values: [40, 50] };
    expect(closingSubsets(c, workbook.lines.filter((l) => l.id !== 'a' && l.id !== 'l'))).toEqual([{ lineIds: ['x'], sign: 1 }]);
    expect(closingSubsets({ ...c, values: [-40, -50] }, [workbook.lines[2]])).toEqual([{ lineIds: ['x'], sign: -1 }]);
    expect(closingSubsets({ ...c, values: [1, 2] }, workbook.lines)).toEqual([]);
  });
});

describe('runAiReview', () => {
  it('fills, then finds nothing to consolidate, then uses the failing check to add the missing line', async () => {
    const provider = new FakeLlmProvider((req: { schemaName: string; prompt: string }) => {
      if (req.schemaName === 'mapping_suggestions') return { matches: [] };
      return req.prompt.includes('CHECK FAILING')
        ? { additions: [{ target: 'liab', sources: ['x'], confidence: 'high', reason: 'Equity is part of liabilities and equity.' }] }
        : { additions: [] };
    });
    const steps: string[] = [];
    const result = await runAiReview({ provider, schema, targets, workbook, mapping: { assets: mapped('assets', ['a']), liab: mapped('liab', ['l']) }, isSettled: settled, onStep: (s) => steps.push(s) });
    expect(steps).toEqual(['fill', 'consolidate', 'checks']);
    expect(result.mapping.liab.sourceLineIds).toEqual(['l', 'x']);
    expect(result.checks).toEqual([{ name: 'Check', section: 'Balance Sheet', status: 'resolved', latest: 0 }]);
    expect(provider.requests.at(-1)?.prompt).toContain('Equity [id=x]');
  });

  it('reports a check that is still failing instead of hiding it', async () => {
    const provider = new FakeLlmProvider((req: { schemaName: string }) => (req.schemaName === 'mapping_suggestions' ? { matches: [] } : { additions: [] }));
    const result = await runAiReview({ provider, schema, targets, workbook, mapping: { assets: mapped('assets', ['a']), liab: mapped('liab', ['l']) }, isSettled: settled });
    expect(result.checks).toEqual([{ name: 'Check', section: 'Balance Sheet', status: 'unresolved', latest: 50 }]);
  });

  it('undoes consolidation in a section whose check the additions made worse', async () => {
    const provider = new FakeLlmProvider((req: { schemaName: string; prompt: string }) => {
      if (req.schemaName === 'mapping_suggestions') return { matches: [] };
      return req.prompt.includes('CHECK FAILING') ? { additions: [] } : { additions: [{ target: 'assets', sources: ['noise'], confidence: 'high', reason: 'Other assets.' }] };
    });
    const balanced = { ...workbook, lines: workbook.lines.map((l) => (l.id === 'l' ? { ...l, values: [100 - 40, 120 - 50] } : l)) };
    const start = { assets: { ...mapped('assets', ['a']), method: 'fuzzy' as const, confidence: 0.7 }, liab: mapped('liab', ['l', 'x']) };
    const result = await runAiReview({ provider, schema, targets, workbook: balanced, mapping: start, isSettled: settled });
    expect(result.reverted).toEqual(['Balance Sheet']);
    expect(result.mapping.assets.sourceLineIds).toEqual(['a']);
    expect(result.checks).toEqual([]);
  });
});
