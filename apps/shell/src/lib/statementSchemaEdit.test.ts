import { describe, expect, it } from 'vitest';
import {
  addLine,
  addSection,
  moveSection,
  removeLine,
  removeSection,
  renameSection,
  reorderLine,
  setLineProjection,
  setLineRole,
  setSectionAllowsFreeformLines,
  updateLine,
} from './statementSchemaEdit';
import type { StatementLine, StatementSchema } from '../data';

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

function schemaWith(sections: StatementSchema['sections'], drivers: StatementSchema['drivers'] = []): StatementSchema {
  return { id: 's1', name: 'Test', createdAt: '', updatedAt: '', sections, drivers };
}

describe('section mutations', () => {
  it('addSection appends an empty, unnamed section', () => {
    const schema = addSection(schemaWith([]));
    expect(schema.sections).toHaveLength(1);
    expect(schema.sections[0]).toMatchObject({ name: '', lines: [] });
  });

  it('renameSection only touches the matching section', () => {
    const schema = schemaWith([
      { id: 'a', name: 'Old', lines: [] },
      { id: 'b', name: 'Other', lines: [] },
    ]);
    const renamed = renameSection(schema, 'a', 'New');
    expect(renamed.sections.find((s) => s.id === 'a')?.name).toBe('New');
    expect(renamed.sections.find((s) => s.id === 'b')?.name).toBe('Other');
  });

  it('setSectionAllowsFreeformLines toggles the flag', () => {
    const schema = schemaWith([{ id: 'a', name: 'KPIs', lines: [] }]);
    expect(setSectionAllowsFreeformLines(schema, 'a', true).sections[0].allowsFreeformLines).toBe(true);
  });

  it('moveSection swaps with its neighbor, and is a no-op at the boundary', () => {
    const schema = schemaWith([
      { id: 'a', name: 'A', lines: [] },
      { id: 'b', name: 'B', lines: [] },
    ]);
    const moved = moveSection(schema, 'b', 'up');
    expect(moved.sections.map((s) => s.id)).toEqual(['b', 'a']);
    expect(moveSection(schema, 'a', 'up').sections.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('removeSection drops the section and any driver targeting one of its lines', () => {
    const schema = schemaWith(
      [{ id: 'a', name: 'A', lines: [line('l1', 'Revenue')] }, { id: 'b', name: 'B', lines: [] }],
      [{ id: 'd1', name: 'Revenue Growth', unit: '%', targetLineId: 'l1', method: 'growth' }],
    );
    const next = removeSection(schema, 'a');
    expect(next.sections.map((s) => s.id)).toEqual(['b']);
    expect(next.drivers).toEqual([]);
  });
});

describe('line mutations', () => {
  it('addLine appends an empty line to the right section', () => {
    const schema = schemaWith([{ id: 'a', name: 'A', lines: [] }]);
    const next = addLine(schema, 'a');
    expect(next.sections[0].lines).toHaveLength(1);
    // Required, and carried forward flat — a sourced line always has a projection.
    expect(next.sections[0].lines[0]).toMatchObject({ name: '', role: 'required', projection: { method: 'flat' } });
    expect(next.sections[0].lines[0].formula).not.toBeNull();
  });

  it('updateLine patches only the matching line, wherever it lives', () => {
    const schema = schemaWith([{ id: 'a', name: 'A', lines: [line('l1', 'Old')] }]);
    const next = updateLine(schema, 'l1', { name: 'New' });
    expect(next.sections[0].lines[0].name).toBe('New');
  });

  it('removeLine drops the line and its own driver, leaving other drivers untouched', () => {
    const schema = schemaWith(
      [{ id: 'a', name: 'A', lines: [line('l1', 'Revenue'), line('l2', 'COGS')] }],
      [
        { id: 'd1', name: 'Revenue Growth', unit: '%', targetLineId: 'l1', method: 'growth' },
        { id: 'd2', name: 'COGS Growth', unit: '%', targetLineId: 'l2', method: 'growth' },
      ],
    );
    const next = removeLine(schema, 'a', 'l1');
    expect(next.sections[0].lines.map((l) => l.id)).toEqual(['l2']);
    expect(next.drivers.map((d) => d.id)).toEqual(['d2']);
  });

  it('reorderLine moves a line before another within the same section', () => {
    const schema = schemaWith([{ id: 'a', name: 'A', lines: [line('l1', 'One'), line('l2', 'Two'), line('l3', 'Three')] }]);
    const next = reorderLine(schema, 'l3', 'a', 'l1');
    expect(next.sections[0].lines.map((l) => l.id)).toEqual(['l3', 'l1', 'l2']);
  });

  it('reorderLine with beforeLineId null appends to the end of the target section', () => {
    const schema = schemaWith([{ id: 'a', name: 'A', lines: [line('l1', 'One'), line('l2', 'Two')] }]);
    const next = reorderLine(schema, 'l1', 'a', null);
    expect(next.sections[0].lines.map((l) => l.id)).toEqual(['l2', 'l1']);
  });

  it('reorderLine relocates a line to a different section, preserving it exactly', () => {
    const schema = schemaWith([
      { id: 'a', name: 'A', lines: [line('l1', 'Revenue')] },
      { id: 'b', name: 'B', lines: [] },
    ]);
    const next = reorderLine(schema, 'l1', 'b', null);
    expect(next.sections.find((s) => s.id === 'a')?.lines).toEqual([]);
    expect(next.sections.find((s) => s.id === 'b')?.lines.map((l) => l.id)).toEqual(['l1']);
  });

  it('reorderLine can relocate a line to a specific position in a different section', () => {
    const schema = schemaWith([
      { id: 'a', name: 'A', lines: [line('l1', 'Revenue')] },
      { id: 'b', name: 'B', lines: [line('l2', 'Two'), line('l3', 'Three')] },
    ]);
    const next = reorderLine(schema, 'l1', 'b', 'l3');
    expect(next.sections.find((s) => s.id === 'a')?.lines).toEqual([]);
    expect(next.sections.find((s) => s.id === 'b')?.lines.map((l) => l.id)).toEqual(['l2', 'l1', 'l3']);
  });

  it('reorderLine is a no-op for a lineId that does not exist anywhere', () => {
    const schema = schemaWith([{ id: 'a', name: 'A', lines: [line('l1', 'One')] }]);
    expect(reorderLine(schema, 'missing', 'a', null)).toBe(schema);
  });
});

describe('setLineProjection', () => {
  it('"hardcode" clears the formula and any existing driver, and is stored as its own type', () => {
    const schema = schemaWith(
      [{ id: 'a', name: 'A', lines: [line('l1', 'Revenue', { projection: { method: 'growth', driverId: 'd1' } })] }],
      [{ id: 'd1', name: 'Revenue Growth', unit: '%', targetLineId: 'l1', method: 'growth' }],
    );
    const next = setLineProjection(schema, 'l1', { method: 'hardcode' });
    const l1 = next.sections[0].lines[0];
    expect(l1.formula).toBeNull();
    expect(l1.projection).toEqual({ method: 'hardcode' });
    expect(next.drivers).toEqual([]);
  });

  it('"link" reads the basis line period for period and drops any prior driver', () => {
    const schema = schemaWith(
      [{ id: 'a', name: 'A', lines: [line('l1', 'D&A CF', { projection: { method: 'growth', driverId: 'd1' } }), line('l2', 'D&A IS')] }],
      [{ id: 'd1', name: 'Growth', unit: '%', targetLineId: 'l1', method: 'growth' }],
    );
    const l1 = setLineProjection(schema, 'l1', { method: 'link', basisLineId: 'l2' });
    expect(l1.sections[0].lines[0].projection).toEqual({ method: 'link', basisLineId: 'l2' });
    expect(l1.sections[0].lines[0].formula).toEqual({ kind: 'ref', lineId: 'l2' });
    expect(l1.drivers).toEqual([]);
  });

  it('"formula" keeps an existing hand-written formula but discards a generated one', () => {
    const handWritten = { kind: 'num', value: 7 } as const;
    const keeps = schemaWith([{ id: 'a', name: 'A', lines: [line('l1', 'X', { projection: { method: 'formula' }, formula: handWritten })] }]);
    expect(setLineProjection(keeps, 'l1', { method: 'formula' }).sections[0].lines[0].formula).toEqual(handWritten);

    const generated = schemaWith([{ id: 'a', name: 'A', lines: [line('l1', 'X', { projection: { method: 'flat' }, formula: handWritten })] }]);
    const next = setLineProjection(generated, 'l1', { method: 'formula' }).sections[0].lines[0];
    expect(next.formula).toBeNull();
    expect(next.projection).toEqual({ method: 'formula' });
  });

  it('"growth" writes a formula and creates a fresh driver, replacing any prior one', () => {
    const schema = schemaWith([{ id: 'a', name: 'A', lines: [line('l1', 'Revenue')] }]);
    const next = setLineProjection(schema, 'l1', { method: 'growth' });
    const l1 = next.sections[0].lines[0];
    expect(l1.projection).toMatchObject({ method: 'growth' });
    expect(l1.formula).not.toBeNull();
    expect(next.drivers).toHaveLength(1);
    expect(next.drivers[0].targetLineId).toBe('l1');
  });

  it('"percent-of" names the driver after both the line and its basis', () => {
    const schema = schemaWith([{ id: 'a', name: 'A', lines: [line('l1', 'COGS'), line('l2', 'Revenue')] }]);
    const next = setLineProjection(schema, 'l1', { method: 'percent-of', basisLineId: 'l2' });
    expect(next.drivers[0].name).toBe('COGS % of Revenue');
    expect(next.drivers[0].basisLineId).toBe('l2');
  });
});

describe('setLineRole', () => {
  const hand = { kind: 'num', value: 7 } as const;
  const roleOf = (schema: StatementSchema, id: string) => schema.sections[0].lines.find((l) => l.id === id)!;

  it('Required <-> Optional only flips the role', () => {
    const schema = schemaWith([{ id: 'a', name: 'A', lines: [line('l1', 'X', { role: 'required', projection: { method: 'flat' } })] }]);
    const next = setLineRole(schema, 'l1', 'optional');
    expect(roleOf(next, 'l1')).toMatchObject({ role: 'optional', projection: { method: 'flat' } });
  });

  it('to Calculated drops the projection, its driver and a generated formula', () => {
    const schema = schemaWith(
      [{ id: 'a', name: 'A', lines: [line('l1', 'X', { role: 'required', projection: { method: 'growth', driverId: 'd1' }, formula: hand })] }],
      [{ id: 'd1', name: 'g', unit: '%', targetLineId: 'l1', method: 'growth' }],
    );
    const next = setLineRole(schema, 'l1', 'calculated');
    expect(roleOf(next, 'l1')).toMatchObject({ role: 'calculated', projection: null, formula: null });
    expect(next.drivers).toEqual([]);
  });

  it('to Calculated keeps a hand-written formula', () => {
    const schema = schemaWith([{ id: 'a', name: 'A', lines: [line('l1', 'X', { role: 'optional', projection: { method: 'formula' }, formula: hand })] }]);
    expect(roleOf(setLineRole(schema, 'l1', 'calculated'), 'l1').formula).toEqual(hand);
  });

  it('Calculated <-> Check keeps the formula and adds no projection', () => {
    const schema = schemaWith([{ id: 'a', name: 'A', lines: [line('l1', 'X', { role: 'calculated', formula: hand })] }]);
    const next = setLineRole(schema, 'l1', 'check');
    expect(roleOf(next, 'l1')).toMatchObject({ role: 'check', projection: null, formula: hand });
  });

  it('to Required keeps an existing formula as a Formula projection', () => {
    const schema = schemaWith([{ id: 'a', name: 'A', lines: [line('l1', 'X', { role: 'calculated', formula: hand })] }]);
    expect(roleOf(setLineRole(schema, 'l1', 'required'), 'l1')).toMatchObject({ role: 'required', projection: { method: 'formula' }, formula: hand });
  });

  it('to Required with no formula starts on Flat', () => {
    const schema = schemaWith([{ id: 'a', name: 'A', lines: [line('l1', 'X', { role: 'calculated' })] }]);
    expect(roleOf(setLineRole(schema, 'l1', 'optional'), 'l1')).toMatchObject({ role: 'optional', projection: { method: 'flat' } });
  });

  it('going formula-only clears debt kind and sub-line permission', () => {
    const schema = schemaWith([{ id: 'a', name: 'A', lines: [line('l1', 'Debt', { role: 'optional', lineKind: 'debt', allowsSubLines: true, debtProperties: {} })] }]);
    expect(roleOf(setLineRole(schema, 'l1', 'calculated'), 'l1')).toMatchObject({ lineKind: undefined, allowsSubLines: false, debtProperties: undefined });
  });

  it('refuses to make a line with real sub-lines Calculated', () => {
    const schema = schemaWith([{ id: 'a', name: 'A', lines: [line('p', 'Parent', { role: 'optional' }), line('c', 'Child', { parentLineId: 'p' })] }]);
    expect(setLineRole(schema, 'p', 'calculated')).toBe(schema);
  });

  it('leaves a Debt Schedule line alone', () => {
    const schema = schemaWith([{ id: 'a', name: 'A', lines: [line('g', 'Gen', { role: 'calculated', debtScheduleRole: { role: 'totalInterestExpense' } })] }]);
    expect(setLineRole(schema, 'g', 'required')).toBe(schema);
  });
});
