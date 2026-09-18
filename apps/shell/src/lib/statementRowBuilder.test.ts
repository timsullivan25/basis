import { describe, expect, it } from 'vitest';
import { buildSectionRows, resolveFlatRowDropTarget, type FlatRow } from './statementRowBuilder';
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

describe('resolveFlatRowDropTarget', () => {
  // Mirrors exactly how ModelMappingScreen assembles its own single flat table: a `group-<id>`
  // divider row per section, then that section's own buildSectionRows output with sectionId
  // stamped onto each — including a child row, since a drop can land on one of those too.
  const revenue = line('a', 'Revenue');
  const cogs = line('b', 'COGS');
  const tranche = line('t1', 'Term Loan A', { parentLineId: 'c' });
  const cash = line('c', 'Cash & Equivalents', { allowsSubLines: true });
  const sections = [{ id: 'is' }, { id: 'bs' }];
  const rows: FlatRow[] = [
    { id: 'group-is', __group: 'Income Statement' },
    { id: 'a', line: revenue, sectionId: 'is' },
    { id: 'b', line: cogs, sectionId: 'is' },
    { id: 'group-bs', __group: 'Balance Sheet' },
    { id: 'c', line: cash, sectionId: 'bs' },
    { id: 'child-t1', childLine: tranche, sectionId: 'bs' },
    { id: 'add-line-c', addInstanceTarget: { id: 'c', name: 'Cash & Equivalents', kind: 'line' }, sectionId: 'bs' },
  ];

  it('a plain line key resolves to its own section and raw id', () => {
    expect(resolveFlatRowDropTarget(rows, sections, 'b')).toEqual({ toSectionId: 'is', beforeLineId: 'b' });
  });

  it('a child row key resolves to its section and the child\'s own raw id', () => {
    expect(resolveFlatRowDropTarget(rows, sections, 'child-t1')).toEqual({ toSectionId: 'bs', beforeLineId: 't1' });
  });

  it('null resolves to the end of the LAST section', () => {
    expect(resolveFlatRowDropTarget(rows, sections, null)).toEqual({ toSectionId: 'bs', beforeLineId: null });
  });

  it('a group-<id> key resolves to that section\'s current first row, not "the end"', () => {
    expect(resolveFlatRowDropTarget(rows, sections, 'group-bs')).toEqual({ toSectionId: 'bs', beforeLineId: 'c' });
    expect(resolveFlatRowDropTarget(rows, sections, 'group-is')).toEqual({ toSectionId: 'is', beforeLineId: 'a' });
  });

  it('a group-<id> key for a section with nothing after it (empty, or the last group in the table) falls back to null', () => {
    const trailingGroupOnly: FlatRow[] = [...rows, { id: 'group-empty', __group: 'Empty Section' }];
    expect(resolveFlatRowDropTarget(trailingGroupOnly, [...sections, { id: 'empty' }], 'group-empty')).toEqual({
      toSectionId: 'empty',
      beforeLineId: null,
    });
  });

  it('a stale/unknown key falls back to the end of the last section rather than doing nothing', () => {
    expect(resolveFlatRowDropTarget(rows, sections, 'not-a-real-row')).toEqual({ toSectionId: 'bs', beforeLineId: null });
  });

  it('a synthetic "+ Add sub-line" row resolves to its own section with beforeLineId null (append), same as dropping at the end', () => {
    expect(resolveFlatRowDropTarget(rows, sections, 'add-line-c')).toEqual({ toSectionId: 'bs', beforeLineId: null });
  });
});
