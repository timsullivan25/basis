import { describe, expect, it } from 'vitest';
import { buildLineGraph } from './graph';
import type { ResolvedFormula, StatementLine, StatementSchema } from '../../data';

function line(id: string, formula: ResolvedFormula | null = null): StatementLine {
  return {
    id,
    name: id,
    required: formula === null,
    rowFormat: 'normal',
    numberFormat: 'number',
    sign: 'natural',
    aggregation: 'sum',
    formula,
    projection: null,
    aliases: [],
  };
}

function ref(lineId: string): ResolvedFormula {
  return { kind: 'ref', lineId };
}

function call(fn: 'priorPeriod' | 'priorYear', args: ResolvedFormula[]): ResolvedFormula {
  return { kind: 'call', fn, args };
}

function driverRef(driverId: string): ResolvedFormula {
  return { kind: 'driverRef', driverId };
}

function schema(lines: StatementLine[]): StatementSchema {
  return { id: 's1', name: 'Test', createdAt: '', updatedAt: '', sections: [{ id: 'sec', name: 'Section', lines }], drivers: [] };
}

describe('buildLineGraph', () => {
  it('wires precedents and dependents for a straight-line chain', () => {
    const g = buildLineGraph(
      schema([
        line('revenue'),
        line('cogs'),
        line('gross-profit', { kind: 'bin', op: '-', left: ref('revenue'), right: ref('cogs') }),
      ]),
    );
    expect(g.precedents.get('gross-profit')?.sort()).toEqual(['cogs', 'revenue']);
    expect(g.precedents.get('revenue')).toEqual([]);
    expect(g.dependents.get('revenue')).toEqual(['gross-profit']);
    expect(g.dependents.get('cogs')).toEqual(['gross-profit']);
  });

  it('orders precedents strictly before their dependents', () => {
    const g = buildLineGraph(
      schema([
        line('revenue'),
        line('cogs'),
        line('gross-profit', { kind: 'bin', op: '-', left: ref('revenue'), right: ref('cogs') }),
      ]),
    );
    const indexOf = (id: string) => g.order.findIndex((group) => group.includes(id));
    expect(indexOf('revenue')).toBeLessThan(indexOf('gross-profit'));
    expect(indexOf('cogs')).toBeLessThan(indexOf('gross-profit'));
  });

  it('handles a chain deeper than one level', () => {
    const g = buildLineGraph(
      schema([
        line('a'),
        line('b', ref('a')),
        line('c', ref('b')),
      ]),
    );
    const indexOf = (id: string) => g.order.findIndex((group) => group.includes(id));
    expect(indexOf('a')).toBeLessThan(indexOf('b'));
    expect(indexOf('b')).toBeLessThan(indexOf('c'));
  });

  it('groups a mutual (circular) dependency into a single order entry', () => {
    const g = buildLineGraph(schema([line('a', ref('b')), line('b', ref('a'))]));
    const group = g.order.find((grp) => grp.includes('a'));
    expect(group).toBeDefined();
    expect(group!.sort()).toEqual(['a', 'b']);
    // The whole schema is one cycle here, so it must be the only group.
    expect(g.order).toHaveLength(1);
  });

  it('ignores a dangling reference rather than breaking the graph', () => {
    const g = buildLineGraph(schema([line('a', ref('deleted-line'))]));
    expect(g.precedents.get('a')).toEqual([]);
    expect(g.order.flat().sort()).toEqual(['a']);
  });

  it('does not treat a priorPeriod-wrapped self-reference as a same-period cycle', () => {
    // A running-total-style formula: this period's value is last period's plus a delta line.
    // The self-reference only ever points at a strictly earlier, already-resolved period, so it
    // must not force this line through the (unnecessary, and here undefined) cycle solver.
    const g = buildLineGraph(
      schema([
        line('delta'),
        line('running-total', { kind: 'bin', op: '+', left: call('priorPeriod', [ref('running-total')]), right: ref('delta') }),
      ]),
    );
    expect(g.precedents.get('running-total')).toEqual(['delta']);
    const group = g.order.find((grp) => grp.includes('running-total'));
    expect(group).toEqual(['running-total']);
  });

  it('still detects a genuine same-period cycle even when one side also uses priorPeriod', () => {
    const g = buildLineGraph(
      schema([
        line('a', { kind: 'bin', op: '+', left: ref('b'), right: call('priorPeriod', [ref('a')]) }),
        line('b', ref('a')),
      ]),
    );
    const group = g.order.find((grp) => grp.includes('a'));
    expect(group?.sort()).toEqual(['a', 'b']);
  });

  it('a driverRef contributes no precedent edge — a driver is always an immediately-available leaf', () => {
    const g = buildLineGraph(
      schema([line('cogs'), line('ar', { kind: 'bin', op: '*', left: driverRef('dso'), right: ref('cogs') })]),
    );
    // Real precedent from the `ref('cogs')` side; the driverRef side contributes nothing.
    expect(g.precedents.get('ar')).toEqual(['cogs']);
  });

  it('a line whose formula is ONLY a driverRef has no precedents at all', () => {
    const g = buildLineGraph(schema([line('constant-ish', driverRef('d1'))]));
    expect(g.precedents.get('constant-ish')).toEqual([]);
    expect(g.order.flat().sort()).toEqual(['constant-ish']);
  });
});
