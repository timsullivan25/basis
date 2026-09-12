import { describe, expect, it } from 'vitest';
import { findInstanceBasisDependents, findSchemaDependents, hasInstanceBasisDependents, hasSchemaDependents } from './lineDependents';
import type { DriverDefinition, LineInstance, ResolvedFormula, StatementLine, StatementSchema } from '../data';

function line(id: string, name: string, formula: ResolvedFormula | null = null): StatementLine {
  return {
    id,
    name,
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

function driver(id: string, basisLineId?: string): DriverDefinition {
  return { id, name: id, unit: '%', targetLineId: 'target', method: 'percent-of', basisLineId };
}

function instance(id: string, projection: LineInstance['projection'] = { method: 'flat' }): Pick<LineInstance, 'id' | 'name' | 'projection'> {
  return { id, name: id, projection };
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
});

describe('findInstanceBasisDependents', () => {
  it('finds a sibling instance using the deleted instance as its basis', () => {
    const instances = [instance('seg-a'), instance('seg-b', { method: 'percent-of', driverId: 'd1', basisLineId: 'seg-a' })];
    const deps = findInstanceBasisDependents(instances, 'seg-a');
    expect(deps.dependentNames).toEqual(['seg-b']);
    expect(hasInstanceBasisDependents(deps)).toBe(true);
  });

  it('excludes the deleted instance itself from being reported as its own dependent', () => {
    const instances = [instance('seg-a')];
    const deps = findInstanceBasisDependents(instances, 'seg-a');
    expect(deps.dependentNames).toEqual([]);
  });

  it('reports nothing when no sibling references the deleted instance', () => {
    const instances = [instance('seg-a'), instance('seg-b')];
    const deps = findInstanceBasisDependents(instances, 'seg-a');
    expect(hasInstanceBasisDependents(deps)).toBe(false);
  });
});
