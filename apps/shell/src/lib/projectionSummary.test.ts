import { describe, expect, it } from 'vitest';
import { summarizeProjection } from './projectionSummary';
import { buildNameIndex } from './engine/resolve';
import type { DriverDefinition, StatementLine, StatementSchema } from '../data';

function line(id: string, name: string, over: Partial<StatementLine> = {}): StatementLine {
  return {
    id, name, role: 'required', rowFormat: 'normal', numberFormat: 'number', sign: 'natural',
    aggregation: 'sum', formula: null, projection: null, aliases: [], ...over,
  };
}

const drivers: DriverDefinition[] = [
  { id: 'd-pct', name: 'x', unit: '%', targetLineId: 'cogs', method: 'percent-of', basisLineId: 'rev' },
  { id: 'd-days', name: 'y', unit: 'days', targetLineId: 'ar', method: 'days-of', basisLineId: 'rev' },
];

const schema: StatementSchema = {
  id: 's', name: 'S', createdAt: '', updatedAt: '', drivers,
  sections: [
    { id: 'is', name: 'Income Statement', lines: [line('rev', 'Revenue'), line('da-is', 'D&A')] },
    { id: 'cf', name: 'Cash Flow', lines: [line('da-cf', 'D&A')] },
  ],
};
const index = buildNameIndex(schema);
const summary = (l: StatementLine) => summarizeProjection(l, drivers, index);

describe('summarizeProjection', () => {
  it('is null for a Calculated or Check line — there is no projection to describe', () => {
    expect(summary(line('a', 'A', { role: 'calculated' }))).toBeNull();
    expect(summary(line('a', 'A', { role: 'check' }))).toBeNull();
  });

  it('describes the standard methods, naming the basis line for percent-of / days-of', () => {
    expect(summary(line('a', 'A', { projection: { method: 'flat' } }))?.label).toBe('Flat');
    expect(summary(line('a', 'A', { projection: { method: 'growth', driverId: 'g' } }))?.label).toBe('Growth rate');
    expect(summary(line('cogs', 'C', { projection: { method: 'percent-of', driverId: 'd-pct' } }))?.label).toBe('% of Revenue');
    expect(summary(line('ar', 'AR', { projection: { method: 'days-of', driverId: 'd-days' } }))?.label).toBe('Days of Revenue');
  });

  it('describes Link (with flipped sign), Formula and Hardcode', () => {
    expect(summary(line('a', 'A', { projection: { method: 'link', basisLineId: 'rev' } }))?.label).toBe('Linked to Revenue');
    expect(summary(line('a', 'A', { projection: { method: 'link', basisLineId: 'rev', flipSign: true } }))?.label).toBe('Linked to −Revenue');
    expect(summary(line('a', 'A', { projection: { method: 'formula' } }))?.label).toBe('Custom formula');
    expect(summary(line('a', 'A', { projection: { method: 'hardcode', driverId: 'v' } }))?.label).toBe('Hardcoded');
  });

  it('qualifies a basis line only when another line shares its name', () => {
    const shared = summary(line('a', 'A', { projection: { method: 'link', basisLineId: 'da-is' } }));
    expect(shared?.label).toBe('Linked to Income Statement.D&A');
  });

  it('flags a link to a line that no longer exists', () => {
    expect(summary(line('a', 'A', { projection: { method: 'link', basisLineId: 'gone' } }))?.label).toBe('Linked to (missing line)');
  });

  it('reads a parent of sub-lines and a debt line as derived, not chosen', () => {
    expect(summary(line('a', 'A', { allowsSubLines: true }))).toEqual({ label: 'Sum of sub-lines', tone: 'derived' });
    expect(summary(line('a', 'A', { lineKind: 'debt' }))).toEqual({ label: 'Debt schedule', tone: 'derived' });
  });

  it('reads a sub-line inheriting debt as derived even if it still carries a projection', () => {
    const tranche = line('t', 'Revolver', { projection: { method: 'flat' } });
    const index = buildNameIndex({ sections: [{ name: 'S', lines: [tranche] }], drivers: [] });
    expect(summarizeProjection(tranche, [], index, true)).toEqual({ label: 'Debt schedule', tone: 'derived' });
  });

  it('summarizes a Linked line by the line it reads, and flags one that reads nothing yet', () => {
    const b = line('b', 'B');
    const index = buildNameIndex({ sections: [{ name: 'S', lines: [b] }], drivers: [] });
    const linked = (over: Partial<StatementLine>) => summarizeProjection(line('a', 'A', { role: 'linked', ...over }), [], index);
    expect(linked({ projection: { method: 'link', basisLineId: 'b' } })?.label).toBe('Linked to B');
    expect(linked({ projection: { method: 'link', basisLineId: 'b', flipSign: true } })?.label).toBe('Linked to −B');
    expect(linked({ projection: null })).toEqual({ label: 'Not set', tone: 'missing' });
  });

  it('flags a sourced line with no projection at all', () => {
    expect(summary(line('a', 'A'))).toEqual({ label: 'Not set', tone: 'missing' });
  });
});
