import { describe, expect, it } from 'vitest';
import { buildSectionRows } from './statementRowBuilder';
import type { StatementLine, StatementSchema, StatementSection } from '../data';

function line(id: string, name: string, opts: Partial<StatementLine> = {}): StatementLine {
  return {
    id,
    name,
    required: false,
    rowFormat: 'normal',
    numberFormat: 'number',
    sign: 'natural',
    aggregation: 'sum',
    formula: null,
    projection: null,
    aliases: [],
    ...opts,
  };
}

function schemaWith(sections: StatementSection[]): StatementSchema {
  return { id: 's1', name: 'Test', createdAt: '', updatedAt: '', sections, drivers: [] };
}

describe('buildSectionRows — ordinary section', () => {
  it('lists top-level lines only, in order, when none allow sub-lines', () => {
    const section: StatementSection = { id: 'sec', name: 'Income Statement', lines: [line('a', 'Revenue'), line('b', 'COGS')] };
    const rows = buildSectionRows(schemaWith([section]), section);
    expect(rows.map((r) => r.id)).toEqual(['a', 'b']);
    expect(rows[0].line?.id).toBe('a');
  });

  it('inserts a line\'s children and an add-line row right after it, before the next top-level line', () => {
    const parent = line('1L', '1L Debt', { allowsSubLines: true });
    const child = line('t1', 'Term Loan A', { parentLineId: '1L' });
    const other = line('other', 'Other Debt');
    const section: StatementSection = { id: 'sec', name: 'Balance Sheet', lines: [parent, child, other] };
    const rows = buildSectionRows(schemaWith([section]), section);
    expect(rows.map((r) => r.id)).toEqual(['1L', 'child-t1', 'add-line-1L', 'other']);
    expect(rows[1].childLine?.id).toBe('t1');
    expect(rows[1].isKpi).toBe(false);
    expect(rows[2].addInstanceTarget).toEqual({ id: '1L', name: '1L Debt', kind: 'line' });
  });

  it('a line with allowsSubLines but no children yet still gets an add-line row', () => {
    const parent = line('1L', '1L Debt', { allowsSubLines: true });
    const section: StatementSection = { id: 'sec', name: 'Balance Sheet', lines: [parent] };
    const rows = buildSectionRows(schemaWith([section]), section);
    expect(rows.map((r) => r.id)).toEqual(['1L', 'add-line-1L']);
  });

  it('filter narrows top-level lines but never hides a visible line\'s own children/add row', () => {
    const parent = line('1L', '1L Debt', { allowsSubLines: true });
    const child = line('t1', 'Term Loan A', { parentLineId: '1L' });
    const hidden = line('h', 'Hidden Line');
    const section: StatementSection = { id: 'sec', name: 'Balance Sheet', lines: [parent, child, hidden] };
    const rows = buildSectionRows(schemaWith([section]), section, (l) => l.id !== 'h');
    expect(rows.map((r) => r.id)).toEqual(['1L', 'child-t1', 'add-line-1L']);
  });
});

describe('buildSectionRows — freeform (KPI) section', () => {
  it('every line is a KPI child, followed by one add-section row', () => {
    const kpi1 = line('k1', 'MAU');
    const kpi2 = line('k2', 'ARPU');
    const section: StatementSection = { id: 'sec', name: 'KPIs', lines: [kpi1, kpi2], allowsFreeformLines: true };
    const rows = buildSectionRows(schemaWith([section]), section);
    expect(rows.map((r) => r.id)).toEqual(['child-k1', 'child-k2', 'add-section-sec']);
    expect(rows[0].isKpi).toBe(true);
    expect(rows[2].addInstanceTarget).toEqual({ id: 'sec', name: 'KPIs', kind: 'section' });
  });

  it('filter narrows which KPI lines show, add-section row always present', () => {
    const kpi1 = line('k1', 'MAU');
    const kpi2 = line('k2', 'ARPU');
    const section: StatementSection = { id: 'sec', name: 'KPIs', lines: [kpi1, kpi2], allowsFreeformLines: true };
    const rows = buildSectionRows(schemaWith([section]), section, (l) => l.id === 'k2');
    expect(rows.map((r) => r.id)).toEqual(['child-k2', 'add-section-sec']);
  });
});
