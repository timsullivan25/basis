import { describe, expect, it } from 'vitest';
import { matchStatementLines, normalize } from './matchStatementLines';
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

describe('normalize', () => {
  it('ignores case, whitespace and most symbols', () => {
    expect(normalize('  Property, Plant, & Equipment ')).toBe(normalize('property plant equipment'));
  });

  it('keeps % and / because they change what a line is', () => {
    expect(normalize('% Revenue')).not.toBe(normalize('Revenue'));
    expect(normalize('EV / EBITDA')).not.toBe(normalize('EV EBITDA'));
    expect(normalize('EV/EBITDA')).toBe(normalize('EV / EBITDA'));
  });

  it('does not join hyphenated words', () => {
    expect(normalize('Non-Current Assets')).not.toBe(normalize('Noncurrent Assets'));
  });
});

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

  describe('lines under a group', () => {
    const grouped = (group: string | undefined, name: string): ParsedSourceLine => ({ id: `src-${group}-${name}`, section: 'IS', group, name, values: [1] });
    const sections = (l: StatementLine): StatementSection[] => [{ id: 's', name: 'S', lines: [l] }];

    it('matches on the line name alone, whatever its group', () => {
      const result = matchStatementLines(sections(line('Revenue', 'required')), [grouped('Segment A', 'Revenue')]);
      expect(result.Revenue.sourceLineIds).toEqual(['src-Segment A-Revenue']);
      expect(result.Revenue.method).toBe('exact');
      expect(result.Revenue.alternativeSourceLineIds).toBeUndefined();
    });

    it('matches an alias on the line name, ignoring the group', () => {
      const target = { ...line('Cash', 'required'), aliases: ['Cash & Equivalents'] };
      const result = matchStatementLines(sections(target), [grouped('Assets', 'Cash & Equivalents')]);
      expect(result.Cash.method).toBe('alias');
    });

    it('proposes the first of several equally good matches and lists the rest as alternatives', () => {
      const result = matchStatementLines(sections(line('Revenue', 'required')), [grouped('Segment A', 'Revenue'), grouped('Segment B', 'Revenue')]);
      expect(result.Revenue.sourceLineIds).toEqual(['src-Segment A-Revenue']);
      expect(result.Revenue.alternativeSourceLineIds).toEqual(['src-Segment B-Revenue']);
    });

    it('flags equally good fuzzy matches too, but not a clear best one', () => {
      const tie = matchStatementLines(sections(line('Revenues', 'required')), [grouped('A', 'Revenue'), grouped('B', 'Revenue')]);
      expect(tie.Revenues.method).toBe('fuzzy');
      expect(tie.Revenues.alternativeSourceLineIds).toHaveLength(1);
      const clear = matchStatementLines(sections(line('Revenues', 'required')), [grouped('A', 'Revenue'), grouped('B', 'Revenu')]);
      expect(clear.Revenues.alternativeSourceLineIds).toBeUndefined();
    });
  });
});
