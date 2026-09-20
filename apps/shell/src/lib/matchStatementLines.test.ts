import { describe, expect, it } from 'vitest';
import { matchStatementLines } from './matchStatementLines';
import type { LineRole, ParsedSourceLine, StatementLine, StatementSection } from '../data';

function line(name: string, role: LineRole): StatementLine {
  return {
    id: name,
    name,
    role,
    rowFormat: 'normal',
    numberFormat: 'number',
    sign: 'natural',
    aggregation: 'sum',
    formula: null,
    projection: null,
    aliases: [],
  };
}

const source = (name: string): ParsedSourceLine => ({ id: `src-${name}`, section: 'IS', name, values: [1] });

describe('matchStatementLines', () => {
  it('matches a Required or Optional line by name', () => {
    const sections: StatementSection[] = [{ id: 's', name: 'S', lines: [line('Revenue', 'required'), line('Other', 'optional')] }];
    const result = matchStatementLines(sections, [source('Revenue'), source('Other')]);
    expect(result.Revenue.sourceLineIds).toEqual(['src-Revenue']);
    expect(result.Other.sourceLineIds).toEqual(['src-Other']);
  });

  it('never maps a Calculated or Check line, even when the source has a line with its exact name', () => {
    const sections: StatementSection[] = [{ id: 's', name: 'S', lines: [line('Gross Profit', 'calculated'), line('Balance Check', 'check')] }];
    const result = matchStatementLines(sections, [source('Gross Profit'), source('Balance Check')]);
    expect(result['Gross Profit'].sourceLineIds).toEqual([]);
    expect(result['Balance Check'].sourceLineIds).toEqual([]);
  });
});
