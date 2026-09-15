import { describe, expect, it } from 'vitest';
import {
  addLine,
  addSection,
  moveLine,
  moveLineToSection,
  moveSection,
  removeLine,
  removeSection,
  renameSection,
  setLineProjection,
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
    expect(next.sections[0].lines[0]).toMatchObject({ name: '', formula: null, projection: null });
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

  it('moveLine reorders within its section only', () => {
    const schema = schemaWith([{ id: 'a', name: 'A', lines: [line('l1', 'One'), line('l2', 'Two')] }]);
    const next = moveLine(schema, 'a', 'l2', 'up');
    expect(next.sections[0].lines.map((l) => l.id)).toEqual(['l2', 'l1']);
  });

  it('moveLineToSection relocates the line and preserves it exactly', () => {
    const schema = schemaWith([
      { id: 'a', name: 'A', lines: [line('l1', 'Revenue')] },
      { id: 'b', name: 'B', lines: [] },
    ]);
    const next = moveLineToSection(schema, 'a', 'l1', 'b');
    expect(next.sections.find((s) => s.id === 'a')?.lines).toEqual([]);
    expect(next.sections.find((s) => s.id === 'b')?.lines.map((l) => l.id)).toEqual(['l1']);
  });
});

describe('setLineProjection', () => {
  it('"none" clears the formula, projection, and any existing driver', () => {
    const schema = schemaWith(
      [{ id: 'a', name: 'A', lines: [line('l1', 'Revenue', { projection: { method: 'growth', driverId: 'd1' } })] }],
      [{ id: 'd1', name: 'Revenue Growth', unit: '%', targetLineId: 'l1', method: 'growth' }],
    );
    const next = setLineProjection(schema, 'l1', { method: 'none' });
    const l1 = next.sections[0].lines[0];
    expect(l1.formula).toBeNull();
    expect(l1.projection).toBeNull();
    expect(next.drivers).toEqual([]);
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
