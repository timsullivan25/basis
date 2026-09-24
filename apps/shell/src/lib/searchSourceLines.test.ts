import { describe, expect, it } from 'vitest';
import type { ParsedSourceLine } from '../data';
import { searchSourceLines } from './searchSourceLines';

const l = (id: string, section: string, name: string, group?: string): ParsedSourceLine => ({ id, section, name, ...(group ? { group } : {}), values: [1] });
const lines = [
  l('sec', 'Revenue Build', 'Units'),
  l('grp', 'Segments', 'Units', 'Net Revenue'),
  l('has', 'Income Statement', 'Total Revenue'),
  l('starts', 'Income Statement', 'Revenue'),
  l('other', 'Balance Sheet', 'Cash'),
];

describe('searchSourceLines', () => {
  it('ranks name-starts-with, then name-contains, then group, then section', () => {
    expect(searchSourceLines(lines, 'revenue', 'Balance Sheet').map((x) => x.id)).toEqual(['starts', 'has', 'grp', 'sec']);
  });
  it('is case-insensitive and drops non-matches', () => {
    expect(searchSourceLines(lines, ' CASH ', '').map((x) => x.id)).toEqual(['other']);
  });
  it('without a query returns everything, the preferred section first', () => {
    expect(searchSourceLines(lines, '', 'income statement').map((x) => x.id)).toEqual(['has', 'starts', 'sec', 'grp', 'other']);
  });
});
