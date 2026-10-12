import { describe, expect, it } from 'vitest';
import type { LineMapping, ParsedWorkbook, StatementLine, StatementSchema } from '../../data';
import { FakeLlmProvider } from './fakeLlmProvider';
import { applyStructureOp, proposeStructure, tieOut } from './proposeStructure';

const line = (id: string, name: string, over: Partial<StatementLine> = {}): StatementLine => ({
  id, name, role: 'optional', rowFormat: 'normal', numberFormat: 'number', sign: 'natural', aggregation: 'sum', formula: null, projection: { method: 'flat' }, aliases: [], ...over,
});
const schema: StatementSchema = {
  id: 'x', name: 'x', createdAt: '', updatedAt: '', drivers: [],
  sections: [{ id: 's', name: 'Income Statement', lines: [line('rev', 'Revenue', { allowsSubLines: true }), line('cogs', 'COGS')] }],
};
const withCostParent: StatementSchema = { ...schema, sections: [{ ...schema.sections[0], lines: [schema.sections[0].lines[0], line('cogs', 'Cost of Revenue', { allowsSubLines: true })] }] };
const workbook: ParsedWorkbook = {
  periods: [{ type: 'FY', date: '', name: 'FY24' }],
  lines: [
    { id: 'total', section: 'IS', name: 'Net Sales', values: [100] },
    { id: 'a', section: 'Segments', group: 'Academia', name: 'Revenue', values: [60] },
    { id: 'b', section: 'Segments', group: 'Life Sciences', name: 'Revenue', values: [38] },
  ],
};
const mapped = (id: string, sources: string[]): LineMapping => ({ targetLineId: id, sourceLineIds: sources, method: 'exact', confidence: 1, note: '', approved: false });
const mapping = { rev: mapped('rev', ['total']) };

describe('proposeStructure', () => {
  it('validates ops: eligible parents, unassigned unused sources, fresh names', async () => {
    const provider = new FakeLlmProvider({
      subLines: [
        { parent: 'rev', name: 'Academia', sources: ['a', 'total', 'nope'], confidence: 'high', reason: 'Segment.' },
        { parent: 'rev', name: 'Duplicate use', sources: ['a'], confidence: 'high', reason: 'x' },
        { parent: 'cogs', name: 'Not a parent', sources: ['b'], confidence: 'high', reason: 'x' },
        { parent: 'rev', name: 'Life Sciences', sources: ['b'], confidence: 'medium', reason: 'Segment.' },
        { parent: 'rev', name: 'life sciences', sources: ['b'], confidence: 'medium', reason: 'x' },
      ],
    });
    const ops = await proposeStructure(provider, schema, workbook, mapping);
    expect(ops.map((o) => [o.name, o.sourceLineIds])).toEqual([['Academia', ['a']], ['Life Sciences', ['b']]]);
    expect(provider.requests[0].prompt).toContain('mapped from: Net Sales');
    expect(provider.requests[0].prompt).not.toContain('id=total | section=IS'); // already mapped, not left over
  });

  it('asks nothing when there are no parents or no left-over lines', async () => {
    const provider = new FakeLlmProvider({ subLines: [] });
    expect(await proposeStructure(provider, { ...schema, sections: [{ ...schema.sections[0], lines: [line('cogs', 'COGS')] }] }, workbook, mapping)).toEqual([]);
    expect(await proposeStructure(provider, schema, workbook, { rev: mapped('rev', ['total', 'a', 'b']) })).toEqual([]);
    expect(provider.requests).toHaveLength(0);
  });

  it('reports the sub-line total against the parent, and applies an op as a real child line mapped for review', () => {
    const op = { kind: 'addSubLine' as const, parentLineId: 'rev', name: 'Academia', sourceLineIds: ['a', 'b'], confidence: 'high' as const, reason: 'Segment.' };
    expect(tieOut([op], 'rev', workbook, mapping)).toEqual({ proposed: 98, parent: 100 });
    const applied = applyStructureOp(schema, mapping, op);
    const child = applied.schema.sections[0].lines.find((l) => l.parentLineId === 'rev')!;
    expect(child.name).toBe('Academia');
    expect(applied.mapping[child.id]).toMatchObject({ sourceLineIds: ['a', 'b'], method: 'ai', approved: false });
    expect(applied.mapping[child.id].confidence).toBeLessThan(0.8);
  });

  it("doesn't let a parent's unreviewed AI guess hide the lines its sub-lines would come from", async () => {
    const provider = new FakeLlmProvider({ subLines: [{ parent: 'rev', name: 'Academia', sources: ['a'], confidence: 'high', reason: '' }] });
    const guess = { rev: { ...mapped('rev', ['a']), method: 'ai' as const } };
    expect((await proposeStructure(provider, schema, workbook, guess)).map((o) => o.name)).toEqual(['Academia']);
    const approved = { rev: { ...guess.rev, approved: true } };
    expect(await proposeStructure(new FakeLlmProvider({ subLines: [{ parent: 'rev', name: 'Academia', sources: ['a'], confidence: 'high', reason: '' }] }), schema, workbook, approved)).toEqual([]);
  });

  it('only keeps a cost-of-revenue breakdown when revenue is broken down too', async () => {
    const cost = { parent: 'cogs', name: 'Academia cost', sources: ['b'], confidence: 'high', reason: '' };
    const revenue = { parent: 'rev', name: 'Academia', sources: ['a'], confidence: 'high', reason: '' };
    const alone = await proposeStructure(new FakeLlmProvider({ subLines: [cost] }), withCostParent, workbook, mapping);
    expect(alone).toEqual([]);
    const both = await proposeStructure(new FakeLlmProvider({ subLines: [revenue, cost] }), withCostParent, workbook, mapping);
    expect(both.map((o) => o.name)).toEqual(['Academia', 'Academia cost']);
  });

  it('shows the model leftover lines clustered by group, biggest cluster first', async () => {
    const provider = new FakeLlmProvider({ subLines: [] });
    await proposeStructure(provider, schema, { ...workbook, lines: [...workbook.lines, { id: 'c', section: 'Segments', group: 'Academia', name: 'Costs', values: [20] }] }, mapping);
    const prompt = provider.requests[0].prompt;
    expect(prompt.indexOf('[Segments / Academia] (2 lines)')).toBeGreaterThan(-1);
    expect(prompt.indexOf('[Segments / Academia] (2 lines)')).toBeLessThan(prompt.indexOf('[Segments / Life Sciences] (1 lines)'));
  });
});
