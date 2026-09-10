import { describe, expect, it } from 'vitest';
import { findSummaryLine } from './summaryLines';
import type { StatementLine, StatementSchema } from '../data';

function line(id: string, name: string, aliases: string[] = []): StatementLine {
  return {
    id, name, required: true, rowFormat: 'normal', numberFormat: 'number', sign: 'natural', aggregation: 'sum',
    formula: null, projection: null, aliases,
  };
}

function schema(lines: StatementLine[]): StatementSchema {
  return { id: 's1', name: 'Test', createdAt: '', updatedAt: '', sections: [{ id: 'sec', name: 'Section', lines }], drivers: [] };
}

describe('findSummaryLine', () => {
  it('resolves a concept by exact line name', () => {
    const s = schema([line('rev', 'Revenue')]);
    expect(findSummaryLine(s, 'revenue')?.id).toBe('rev');
  });

  it('resolves case-insensitively and ignoring punctuation, matching normalize()', () => {
    const s = schema([line('rev', '  revenue  ')]);
    expect(findSummaryLine(s, 'revenue')?.id).toBe('rev');
  });

  it('resolves by alias when the line itself has a different name', () => {
    const s = schema([line('td', 'Total borrowings', ['Total Debt'])]);
    expect(findSummaryLine(s, 'totalDebt')?.id).toBe('td');
  });

  it('prefers the first candidate name ("Adjusted EBITDA") over a later one ("EBITDA") when both exist', () => {
    const s = schema([line('e1', 'EBITDA'), line('e2', 'Adjusted EBITDA')]);
    expect(findSummaryLine(s, 'ebitda')?.id).toBe('e2');
  });

  it('falls back to the later candidate when the preferred one is absent', () => {
    const s = schema([line('e1', 'EBITDA')]);
    expect(findSummaryLine(s, 'ebitda')?.id).toBe('e1');
  });

  it('resolves to undefined, never throws, when the schema has no matching line', () => {
    const s = schema([line('rev', 'Revenue')]);
    expect(findSummaryLine(s, 'netDebt')).toBeUndefined();
  });

  it('resolves to undefined on a schema with no lines at all', () => {
    expect(findSummaryLine(schema([]), 'revenue')).toBeUndefined();
  });
});
