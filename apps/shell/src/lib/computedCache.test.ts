import { describe, expect, it } from 'vitest';
import { buildComputedResult, computeVersionStamp, materializeEvaluation, toLineValues, versionStampMatches } from './computedCache';
import type { EvaluationResult } from './engine/evaluate';
import type { Model, Scenario, StatementLine, StatementSchema, TimelinePeriod } from '../data';

function line(id: string, name: string): StatementLine {
  return {
    id, name, required: true, rowFormat: 'normal', numberFormat: 'number', sign: 'natural', aggregation: 'sum',
    formula: null, projection: null, aliases: [],
  };
}

function schema(updatedAt: string): StatementSchema {
  return {
    id: 's1', name: 'Test', createdAt: updatedAt, updatedAt,
    sections: [{ id: 'sec', name: 'Section', lines: [line('rev', 'Revenue'), line('cogs', 'Cost of Revenue')] }],
    drivers: [],
  };
}

function period(id: string): TimelinePeriod {
  return { id, type: 'FY', endDate: `${id}-12-31`, label: id, kind: 'actual' };
}

function model(updatedAt: string): Model {
  return {
    id: 'm1', companyId: 'c1', name: 'Model', statementSchemaId: 's1', modelImportId: 'mi1', mappingId: 'map1',
    timeline: [period('2023'), period('2024')], historicals: {}, driverValues: {}, createdAt: updatedAt, updatedAt,
  };
}

function scenario(updatedAt: string): Scenario {
  return { id: 'sc1', modelId: 'm1', name: 'Downside', driverValues: {}, createdAt: updatedAt, updatedAt };
}

function fakeEvaluation(values: Record<string, (number | null)[]>, errors: Record<string, string> = {}): EvaluationResult {
  return {
    getValue: (lineId, periodIndex) => values[lineId]?.[periodIndex] ?? null,
    getError: (lineId) => errors[lineId],
    getDriverValue: () => null,
  };
}

describe('computeVersionStamp / versionStampMatches', () => {
  it('stamps scenarioUpdatedAt as null for Base (no scenario)', () => {
    const stamp = computeVersionStamp(model('t1'), null, schema('t1'));
    expect(stamp).toEqual({ modelUpdatedAt: 't1', scenarioUpdatedAt: null, schemaUpdatedAt: 't1' });
  });

  it('stamps scenarioUpdatedAt from the scenario when one is active', () => {
    const stamp = computeVersionStamp(model('t1'), scenario('t2'), schema('t1'));
    expect(stamp.scenarioUpdatedAt).toBe('t2');
  });

  it('matches when all three fields agree, including a null scenario stamp for Base', () => {
    const stamp = computeVersionStamp(model('t1'), null, schema('t1'));
    expect(versionStampMatches(stamp, model('t1'), null, schema('t1'))).toBe(true);
  });

  it('mismatches when the model has moved on', () => {
    const stamp = computeVersionStamp(model('t1'), null, schema('t1'));
    expect(versionStampMatches(stamp, model('t2'), null, schema('t1'))).toBe(false);
  });

  it('mismatches when the scenario has moved on', () => {
    const stamp = computeVersionStamp(model('t1'), scenario('t2'), schema('t1'));
    expect(versionStampMatches(stamp, model('t1'), scenario('t3'), schema('t1'))).toBe(false);
  });

  it('mismatches when the schema has moved on', () => {
    const stamp = computeVersionStamp(model('t1'), null, schema('t1'));
    expect(versionStampMatches(stamp, model('t1'), null, schema('t2'))).toBe(false);
  });

  it('mismatches when a dynamic child line (segment, EBITDA adjustment, KPI, debt tranche) was added/edited/removed after the stamp was taken — a schema save, same as any other structural change', () => {
    const stamp = computeVersionStamp(model('t1'), null, schema('t1'));
    expect(versionStampMatches(stamp, model('t1'), null, schema('t2'))).toBe(false);
  });

  it('mismatches when Base (no scenario) is compared against a stamp taken with a scenario active', () => {
    const stamp = computeVersionStamp(model('t1'), scenario('t2'), schema('t1'));
    expect(versionStampMatches(stamp, model('t1'), null, schema('t1'))).toBe(false);
  });

  it('falls back to createdAt for a record saved before updatedAt existed', () => {
    const legacyModel = { ...model('t1'), updatedAt: undefined as unknown as string };
    const stamp = computeVersionStamp(legacyModel, null, schema('t1'));
    expect(stamp.modelUpdatedAt).toBe(legacyModel.createdAt);
    expect(versionStampMatches(stamp, legacyModel, null, schema('t1'))).toBe(true);
  });

});

describe('materializeEvaluation', () => {
  it('round-trips every schema line across every period, index-aligned to the timeline', () => {
    const s = schema('t1');
    const m = model('t1');
    const evaluation = fakeEvaluation({ rev: [100, 120], cogs: [40, 50] });
    const { values, errors } = materializeEvaluation(s, m, evaluation);
    expect(values).toEqual({ rev: [100, 120], cogs: [40, 50] });
    expect(errors).toEqual({});
  });

  it('captures a per-line error only when one exists', () => {
    const s = schema('t1');
    const m = model('t1');
    const evaluation = fakeEvaluation({ rev: [100, null], cogs: [null, null] }, { cogs: "didn't converge" });
    const { errors } = materializeEvaluation(s, m, evaluation);
    expect(errors).toEqual({ cogs: "didn't converge" });
  });
});

describe('buildComputedResult / toLineValues', () => {
  it('builds a stable composite id from modelId and scenarioId', () => {
    const result = buildComputedResult('m1', 'base', { modelUpdatedAt: 't1', scenarioUpdatedAt: null, schemaUpdatedAt: 't1' }, {
      values: { rev: [100] },
      errors: {},
    });
    expect(result.id).toBe('m1:base');
    expect(result.modelId).toBe('m1');
    expect(result.scenarioId).toBe('base');
  });

  it('adapts a stored result back to the LineValues shape, missing cells resolving to null/undefined', () => {
    const result = buildComputedResult('m1', 'sc1', { modelUpdatedAt: 't1', scenarioUpdatedAt: 't1', schemaUpdatedAt: 't1' }, {
      values: { rev: [100, 120] },
      errors: { cogs: 'bad' },
    });
    const lineValues = toLineValues(result);
    expect(lineValues.getValue('rev', 0)).toBe(100);
    expect(lineValues.getValue('rev', 5)).toBe(null);
    expect(lineValues.getValue('unknown', 0)).toBe(null);
    expect(lineValues.getError('cogs')).toBe('bad');
    expect(lineValues.getError('rev')).toBeUndefined();
  });
});
