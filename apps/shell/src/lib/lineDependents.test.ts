import { describe, expect, it } from 'vitest';
import { findSchemaDependents, hasSchemaDependents } from './lineDependents';
import type { DriverDefinition, ResolvedFormula, StatementLine, StatementSchema } from '../data';

function line(id: string, name: string, formula: ResolvedFormula | null = null, parentLineId?: string): StatementLine {
  return {
    id,
    name,
    role: formula === null ? 'required' : 'calculated',
    rowFormat: 'normal',
    numberFormat: 'number',
    sign: 'natural',
    aggregation: 'sum',
    formula,
    projection: null,
    aliases: [],
    parentLineId,
  };
}

function ref(lineId: string): ResolvedFormula {
  return { kind: 'ref', lineId };
}

function driver(id: string, basisLineId?: string): DriverDefinition {
  return { id, name: id, unit: '%', targetLineId: 'target', method: 'percent-of', basisLineId };
}

describe('findSchemaDependents', () => {
  it('finds another line whose formula references the deleted line', () => {
    const schema: StatementSchema = {
      id: 's1', name: 'Test', createdAt: '', updatedAt: '',
      sections: [{ id: 'sec', name: 'Income Statement', lines: [line('rev', 'Revenue'), line('gp', 'Gross Profit', ref('rev'))] }],
      drivers: [],
    };
    const deps = findSchemaDependents(schema, new Set(['rev']));
    expect(deps.formulaLines).toEqual([{ id: 'gp', name: 'Gross Profit' }]);
    expect(deps.driverBases).toEqual([]);
  });

  it('finds a driver using the deleted line as its basis', () => {
    const schema: StatementSchema = {
      id: 's1', name: 'Test', createdAt: '', updatedAt: '',
      sections: [{ id: 'sec', name: 'Income Statement', lines: [line('rev', 'Revenue'), line('cogs', 'Cost of Revenue')] }],
      drivers: [driver('cogs-driver', 'rev')],
    };
    const deps = findSchemaDependents(schema, new Set(['rev']));
    expect(deps.driverBases).toEqual([{ id: 'cogs-driver', name: 'cogs-driver' }]);
    expect(hasSchemaDependents(deps)).toBe(true);
  });

  it('excludes references between two lines that are both being deleted together', () => {
    const schema: StatementSchema = {
      id: 's1', name: 'Test', createdAt: '', updatedAt: '',
      sections: [{ id: 'sec', name: 'Section', lines: [line('a', 'A'), line('b', 'B', ref('a'))] }],
      drivers: [],
    };
    // Deleting the whole section (both a and b) should not report b as a dependent of a.
    const deps = findSchemaDependents(schema, new Set(['a', 'b']));
    expect(deps.formulaLines).toEqual([]);
  });

  it('reports no dependents for an unreferenced line', () => {
    const schema: StatementSchema = {
      id: 's1', name: 'Test', createdAt: '', updatedAt: '',
      sections: [{ id: 'sec', name: 'Section', lines: [line('a', 'A'), line('b', 'B')] }],
      drivers: [],
    };
    const deps = findSchemaDependents(schema, new Set(['a']));
    expect(hasSchemaDependents(deps)).toBe(false);
  });

  it('finds a sibling child line using the deleted child as its driver basis — the same check now covers what a separate instance-basis mechanism used to', () => {
    const schema: StatementSchema = {
      id: 's1', name: 'Test', createdAt: '', updatedAt: '',
      sections: [{
        id: 'sec', name: 'Revenue',
        lines: [
          line('rev', 'Revenue', null),
          line('seg-a', 'Segment A', null, 'rev'),
          line('seg-b', 'Segment B', ref('seg-a'), 'rev'),
        ],
      }],
      drivers: [driver('seg-b-driver', 'seg-a')],
    };
    const deps = findSchemaDependents(schema, new Set(['seg-a']));
    expect(deps.formulaLines).toEqual([{ id: 'seg-b', name: 'Segment B' }]);
    expect(deps.driverBases).toEqual([{ id: 'seg-b-driver', name: 'seg-b-driver' }]);
  });
});
