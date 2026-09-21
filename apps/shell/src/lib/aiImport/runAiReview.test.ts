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
const mapped = (id: string, sources: string[], over: Partial<LineMapping> = {}): LineMapping => ({ targetLineId: id, sourceLineIds: sources, method: 'exact', confidence: 1, note: '', approved: false, ...over });
const settled = (m?: LineMapping) => (m?.sourceLineIds.length ?? 0) > 0;
type Req = { schemaName: string; prompt: string };
const noFillNoConsolidation = (req: Req) => (req.schemaName === 'mapping_suggestions' ? { matches: [] } : req.schemaName === 'mapping_consolidations' ? { additions: [] } : undefined);
const start = { assets: mapped('assets', ['a']), liab: mapped('liab', ['l']) };

describe('closingSubsets', () => {
  it('finds unmapped lines whose values equal the gap in every period, either sign', () => {
    const c = { line: check, section: schema.sections[0], values: [40, 50] };
    expect(closingSubsets(c, workbook.lines.filter((l) => l.id !== 'a' && l.id !== 'l'))).toEqual([{ lineIds: ['x'], sign: 1 }]);
    expect(closingSubsets({ ...c, values: [-40, -50] }, [workbook.lines[2]])).toEqual([{ lineIds: ['x'], sign: -1 }]);
    expect(closingSubsets({ ...c, values: [1, 2] }, workbook.lines)).toEqual([]);
  });
});

describe('runAiReview — checks pass', () => {
  it('shows the model the gap and closing line, tests its change in memory, keeps it, and records what it replaced', async () => {
    const provider = new FakeLlmProvider((req: Req) => noFillNoConsolidation(req) ?? { changes: [{ target: 'liab', add: ['x'], remove: [], confidence: 'high', reason: 'Equity is part of liabilities and equity.' }] });
    const steps: string[] = [];
    const result = await runAiReview({ provider, schema, targets, workbook, mapping: start, isSettled: settled, onStep: (s) => steps.push(s) });
    expect(steps).toEqual(['fill', 'consolidate', 'checks']);
    expect(result.mapping.liab.sourceLineIds).toEqual(['l', 'x']);
    expect(result.mapping.liab.previous).toMatchObject({ sourceLineIds: ['l'], method: 'exact' });
    expect(result.checks).toEqual([{ name: 'Check', section: 'Balance Sheet', status: 'resolved', latest: 0 }]);
    expect(result.fixed).toBe(1);
    const prompt = provider.requests.at(-1)!.prompt;
    expect(prompt).toContain('CHECK: "Check" = Assets - Liabilities');
    expect(prompt).toContain('Equity [id=x]');
  });

  it('rejects a change that does not shrink the gap, tells the model on the next round, and stops after three rounds', async () => {
    const provider = new FakeLlmProvider((req: Req) => noFillNoConsolidation(req) ?? { changes: [{ target: 'assets', add: ['noise'], remove: [], confidence: 'medium', reason: 'Other.' }] });
    const result = await runAiReview({ provider, schema, targets, workbook, mapping: start, isSettled: settled });
    const fixes = provider.requests.filter((r) => r.schemaName === 'mapping_check_changes');
    expect(fixes).toHaveLength(3);
    expect(fixes[1].prompt).toContain('Round 1: add Other to Assets');
    expect(fixes[1].prompt).toContain('rejected, did not help');
    expect(result.mapping.assets.sourceLineIds).toEqual(['a']);
    expect(result.checks[0]).toMatchObject({ status: 'unresolved', latest: 50 });
  });

  it('can take a wrongly placed line back out, but only from a weak or AI mapping', async () => {
    const wb = { ...workbook, lines: workbook.lines.map((l) => (l.id === 'l' ? { ...l, values: [60, 70] } : l)) };
    const overloaded = { assets: mapped('assets', ['a']), liab: mapped('liab', ['l', 'x', 'noise'], { method: 'ai', confidence: 0.6 }) };
    const provider = new FakeLlmProvider((req: Req) => noFillNoConsolidation(req) ?? { changes: [{ target: 'liab', add: [], remove: ['noise'], confidence: 'high', reason: 'Other is not a liability.' }] });
    // start with the check off by exactly noise's values (7, 3)
    const result = await runAiReview({ provider, schema, targets, workbook: wb, mapping: overloaded, isSettled: settled });
    expect(result.mapping.liab.sourceLineIds).toEqual(['l', 'x']);
    const protectedMapping = { assets: mapped('assets', ['a']), liab: mapped('liab', ['l', 'x', 'noise'], { method: 'exact' }) };
    const blocked = await runAiReview({ provider, schema, targets, workbook: wb, mapping: protectedMapping, isSettled: settled });
    expect(blocked.mapping.liab.sourceLineIds).toEqual(['l', 'x', 'noise']);
  });

  it('undoes everything after Fill in a section whose check ended worse than it started', async () => {
    const balanced = { ...workbook, lines: workbook.lines.map((l) => (l.id === 'l' ? { ...l, values: [60, 70] } : l)) };
    const both = { assets: { ...mapped('assets', ['a']), method: 'fuzzy' as const, confidence: 0.7 }, liab: mapped('liab', ['l', 'x']) };
    const provider = new FakeLlmProvider((req: Req) => (req.schemaName === 'mapping_suggestions' ? { matches: [] } : req.schemaName === 'mapping_consolidations' ? { additions: [{ target: 'assets', sources: ['noise'], confidence: 'high', reason: 'Other assets.' }] } : { changes: [] }));
    const result = await runAiReview({ provider, schema, targets, workbook: balanced, mapping: both, isSettled: settled });
    expect(result.reverted).toEqual(['Balance Sheet']);
    expect(result.mapping.assets.sourceLineIds).toEqual(['a']);
    expect(result.checks).toEqual([]);
  });
});
