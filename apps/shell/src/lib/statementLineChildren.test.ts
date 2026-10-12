import { describe, expect, it } from 'vitest';
import {
  addChildLine,
  applyRollOffContra,
  childrenOf,
  effectiveLineKind,
  removeChildLine,
  removeRollOffContra,
  setChildProjection,
} from './statementLineChildren';
import type { ResolvedFormula, StatementLine, StatementSchema } from '../data';

function line(id: string, name: string, opts: Partial<StatementLine> = {}): StatementLine {
  return {
    id,
    name,
    role: 'optional',
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

function ref(lineId: string): ResolvedFormula {
  return { kind: 'ref', lineId };
}

function schemaWith(lines: StatementLine[], drivers: StatementSchema['drivers'] = []): StatementSchema {
  return { id: 's1', name: 'Test', createdAt: '', updatedAt: '', sections: [{ id: 'sec', name: 'Balance Sheet', lines }], drivers };
}

describe('addChildLine / removeChildLine — parent rollup formula', () => {
  it('a parent with no children has no formula, gains sum() on first child, and reverts to no formula once emptied', () => {
    let schema = schemaWith([line('1L', '1L Debt', { allowsSubLines: true, lineKind: 'debt' })]);
    expect(schema.sections[0].lines[0].formula).toBeNull();

    const { schema: withChild, lineId: childId } = addChildLine(schema, { kind: 'line', parentLineId: '1L' }, 'Term Loan B');
    schema = withChild;
    const parent = schema.sections[0].lines.find((l) => l.id === '1L')!;
    expect(parent.formula).toEqual({ kind: 'call', fn: 'sum', args: [ref(childId)] });

    const child = schema.sections[0].lines.find((l) => l.id === childId)!;
    expect(child.parentLineId).toBe('1L');
    expect(child.projection).toEqual({ method: 'flat' });

    schema = removeChildLine(schema, childId);
    expect(schema.sections[0].lines.find((l) => l.id === '1L')!.formula).toBeNull();
    expect(schema.sections[0].lines.some((l) => l.id === childId)).toBe(false);
  });

  it('a second child extends the sum rather than replacing it, in insertion order', () => {
    let schema = schemaWith([line('1L', '1L Debt', { allowsSubLines: true, lineKind: 'debt' })]);
    const r1 = addChildLine(schema, { kind: 'line', parentLineId: '1L' }, 'Tranche A');
    schema = r1.schema;
    const r2 = addChildLine(schema, { kind: 'line', parentLineId: '1L' }, 'Tranche B');
    schema = r2.schema;

    const parent = schema.sections[0].lines.find((l) => l.id === '1L')!;
    expect(parent.formula).toEqual({ kind: 'call', fn: 'sum', args: [ref(r1.lineId), ref(r2.lineId)] });

    // Children are physically inserted right after the parent, in creation order.
    const ids = schema.sections[0].lines.map((l) => l.id);
    expect(ids).toEqual(['1L', r1.lineId, r2.lineId]);
  });

  it('removing one of two children shrinks the sum instead of dropping it entirely', () => {
    let schema = schemaWith([line('1L', '1L Debt', { allowsSubLines: true, lineKind: 'debt' })]);
    const r1 = addChildLine(schema, { kind: 'line', parentLineId: '1L' }, 'Tranche A');
    schema = r1.schema;
    const r2 = addChildLine(schema, { kind: 'line', parentLineId: '1L' }, 'Tranche B');
    schema = r2.schema;

    schema = removeChildLine(schema, r1.lineId);
    const parent = schema.sections[0].lines.find((l) => l.id === '1L')!;
    expect(parent.formula).toEqual({ kind: 'call', fn: 'sum', args: [ref(r2.lineId)] });
  });

  it('a freeform (KPI) child has no parentLineId and does not affect any parent formula', () => {
    let schema = schemaWith([]);
    schema = { ...schema, sections: [{ ...schema.sections[0], allowsFreeformLines: true }] };
    const { schema: withKpi, lineId } = addChildLine(schema, { kind: 'section', sectionId: 'sec' }, 'Monthly Active Users');
    const kpi = withKpi.sections[0].lines.find((l) => l.id === lineId)!;
    expect(kpi.parentLineId).toBeUndefined();
  });
});

describe('effectiveLineKind', () => {
  it('a child inherits its parent kind, never storing its own', () => {
    let schema = schemaWith([line('1L', '1L Debt', { allowsSubLines: true, lineKind: 'debt' })]);
    const { schema: withChild, lineId: childId } = addChildLine(schema, { kind: 'line', parentLineId: '1L' }, 'Term Loan B');
    schema = withChild;
    const child = schema.sections[0].lines.find((l) => l.id === childId)!;
    expect(child.lineKind).toBeUndefined();
    expect(effectiveLineKind(schema, child)).toBe('debt');
  });

  it('a child of a non-debt parent (e.g. a revenue segment) is not debt', () => {
    let schema = schemaWith([line('rev', 'Revenue', { allowsSubLines: true })]);
    const { schema: withChild, lineId: childId } = addChildLine(schema, { kind: 'line', parentLineId: 'rev' }, 'Segment A');
    schema = withChild;
    const child = schema.sections[0].lines.find((l) => l.id === childId)!;
    expect(effectiveLineKind(schema, child)).toBeUndefined();
  });
});

describe('removeChildLine — cleanup of dependents', () => {
  it('a sibling using the removed child as a percent-of basis falls back to flat', () => {
    let schema = schemaWith(
      [line('rev', 'Revenue', { allowsSubLines: true })],
    );
    const a = addChildLine(schema, { kind: 'line', parentLineId: 'rev' }, 'Segment A');
    schema = a.schema;
    schema = setChildProjection(schema, a.lineId, { method: 'flat' }); // stays flat, own revenue driver
    const b = addChildLine(schema, { kind: 'line', parentLineId: 'rev' }, 'Segment A COGS');
    schema = b.schema;
    schema = setChildProjection(schema, b.lineId, { method: 'percent-of', basisLineId: a.lineId });

    const bBefore = schema.sections[0].lines.find((l) => l.id === b.lineId)!;
    expect(bBefore.projection).toMatchObject({ method: 'percent-of' });

    schema = removeChildLine(schema, a.lineId);
    const bAfter = schema.sections[0].lines.find((l) => l.id === b.lineId)!;
    expect(bAfter.projection).toEqual({ method: 'flat' });
    expect(bAfter.formula).toEqual({ kind: 'call', fn: 'priorPeriod', args: [ref(b.lineId)] });
    // The dropped driver shouldn't linger.
    expect(schema.drivers.some((d) => d.basisLineId === a.lineId)).toBe(false);
  });

  it("removing a line drops its own driver too", () => {
    let schema = schemaWith([line('rev', 'Revenue', { allowsSubLines: true })]);
    const a = addChildLine(schema, { kind: 'line', parentLineId: 'rev' }, 'Segment A');
    schema = setChildProjection(a.schema, a.lineId, { method: 'growth' });
    expect(schema.drivers.some((d) => d.targetLineId === a.lineId)).toBe(true);

    schema = removeChildLine(schema, a.lineId);
    expect(schema.drivers.some((d) => d.targetLineId === a.lineId)).toBe(false);
  });
});

describe('roll-off contra — non-destructive wrapping (highest-risk mechanism)', () => {
  it('the first roll-off child wraps the basis line\'s original formula, which is never touched again', () => {
    const originalFormula: ResolvedFormula = { kind: 'ref', lineId: 'ebitda' };
    let schema = schemaWith([
      line('delta', 'Adjusted EBITDA Delta', { allowsSubLines: true }),
      line('ebitda', 'Reported EBITDA', { formula: originalFormula }),
    ]);
    const a = addChildLine(schema, { kind: 'line', parentLineId: 'delta' }, 'One-time cost roll-off');
    schema = a.schema;
    schema = setChildProjection(schema, a.lineId, { method: 'roll-off', basisLineId: 'ebitda' });

    const basis = schema.sections[0].lines.find((l) => l.id === 'ebitda')!;
    expect(basis.formula).toEqual({
      kind: 'bin', op: '-', left: originalFormula,
      right: { kind: 'call', fn: 'sum', args: [ref(a.lineId)] },
    });
  });

  it('a second roll-off child sharing the same basis line extends the sum, not a nested wrapper', () => {
    const originalFormula: ResolvedFormula = { kind: 'ref', lineId: 'ebitda' };
    let schema = schemaWith([
      line('delta', 'Adjusted EBITDA Delta', { allowsSubLines: true }),
      line('ebitda', 'Reported EBITDA', { formula: originalFormula }),
    ]);
    const a = addChildLine(schema, { kind: 'line', parentLineId: 'delta' }, 'Cost A');
    schema = setChildProjection(a.schema, a.lineId, { method: 'roll-off', basisLineId: 'ebitda' });
    const b = addChildLine(schema, { kind: 'line', parentLineId: 'delta' }, 'Cost B');
    schema = setChildProjection(b.schema, b.lineId, { method: 'roll-off', basisLineId: 'ebitda' });

    const basis = schema.sections[0].lines.find((l) => l.id === 'ebitda')!;
    expect(basis.formula).toEqual({
      kind: 'bin', op: '-', left: originalFormula,
      right: { kind: 'call', fn: 'sum', args: [ref(a.lineId), ref(b.lineId)] },
    });
  });

  it('removing one of two roll-off children shrinks the sum, leaving the wrapper and original intact', () => {
    const originalFormula: ResolvedFormula = { kind: 'ref', lineId: 'ebitda' };
    let schema = schemaWith([
      line('delta', 'Adjusted EBITDA Delta', { allowsSubLines: true }),
      line('ebitda', 'Reported EBITDA', { formula: originalFormula }),
    ]);
    const a = addChildLine(schema, { kind: 'line', parentLineId: 'delta' }, 'Cost A');
    schema = setChildProjection(a.schema, a.lineId, { method: 'roll-off', basisLineId: 'ebitda' });
    const b = addChildLine(schema, { kind: 'line', parentLineId: 'delta' }, 'Cost B');
    schema = setChildProjection(b.schema, b.lineId, { method: 'roll-off', basisLineId: 'ebitda' });

    schema = removeChildLine(schema, a.lineId);
    const basis = schema.sections[0].lines.find((l) => l.id === 'ebitda')!;
    expect(basis.formula).toEqual({
      kind: 'bin', op: '-', left: originalFormula,
      right: { kind: 'call', fn: 'sum', args: [ref(b.lineId)] },
    });
  });

  it('removing the last roll-off child fully unwraps back to the original formula', () => {
    const originalFormula: ResolvedFormula = { kind: 'ref', lineId: 'ebitda' };
    let schema = schemaWith([
      line('delta', 'Adjusted EBITDA Delta', { allowsSubLines: true }),
      line('ebitda', 'Reported EBITDA', { formula: originalFormula }),
    ]);
    const a = addChildLine(schema, { kind: 'line', parentLineId: 'delta' }, 'Cost A');
    schema = setChildProjection(a.schema, a.lineId, { method: 'roll-off', basisLineId: 'ebitda' });

    schema = removeChildLine(schema, a.lineId);
    const basis = schema.sections[0].lines.find((l) => l.id === 'ebitda')!;
    expect(basis.formula).toEqual(originalFormula);
  });

  it('a basis line with no formula at all has nothing to wrap — roll-off against it is a no-op, not a crash', () => {
    let schema = schemaWith([
      line('delta', 'Adjusted EBITDA Delta', { allowsSubLines: true }),
      line('cash', 'Cash & Equivalents', { formula: null }),
    ]);
    const a = addChildLine(schema, { kind: 'line', parentLineId: 'delta' }, 'Cost A');
    schema = applyRollOffContra(a.schema, a.lineId, 'cash');
    const basis = schema.sections[0].lines.find((l) => l.id === 'cash')!;
    expect(basis.formula).toBeNull();
  });

  it('switching a roll-off child to a different projection method un-wraps its old basis line', () => {
    const originalFormula: ResolvedFormula = { kind: 'ref', lineId: 'ebitda' };
    let schema = schemaWith([
      line('delta', 'Adjusted EBITDA Delta', { allowsSubLines: true }),
      line('ebitda', 'Reported EBITDA', { formula: originalFormula }),
    ]);
    const a = addChildLine(schema, { kind: 'line', parentLineId: 'delta' }, 'Cost A');
    schema = setChildProjection(a.schema, a.lineId, { method: 'roll-off', basisLineId: 'ebitda' });

    schema = setChildProjection(schema, a.lineId, { method: 'flat' });
    const basis = schema.sections[0].lines.find((l) => l.id === 'ebitda')!;
    expect(basis.formula).toEqual(originalFormula);
  });

  it('removeRollOffContra called directly with no matching wrapper is a harmless no-op', () => {
    const schema = schemaWith([line('ebitda', 'Reported EBITDA', { formula: { kind: 'ref', lineId: 'x' } })]);
    const result = removeRollOffContra(schema, 'nonexistent-child', 'ebitda');
    expect(result).toEqual(schema);
  });
});

describe('childrenOf', () => {
  it('lists children in schema order, across sections if somehow split (defensive, not a real case)', () => {
    let schema = schemaWith([line('1L', '1L Debt', { allowsSubLines: true, lineKind: 'debt' })]);
    const a = addChildLine(schema, { kind: 'line', parentLineId: '1L' }, 'A');
    schema = a.schema;
    const b = addChildLine(schema, { kind: 'line', parentLineId: '1L' }, 'B');
    schema = b.schema;
    expect(childrenOf(schema, '1L').map((l) => l.id)).toEqual([a.lineId, b.lineId]);
  });
});
