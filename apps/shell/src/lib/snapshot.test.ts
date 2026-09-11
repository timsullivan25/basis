import { describe, expect, it } from 'vitest';
import { buildSnapshot, defaultSnapshotLabel } from './snapshot';
import type {
  Company,
  DriverDefinition,
  Mapping,
  Model,
  ModelImport,
  ResolvedFormula,
  Scenario,
  StatementLine,
  StatementSchema,
  TimelinePeriod,
} from '../data';

function num(value: number): ResolvedFormula {
  return { kind: 'num', value };
}
function bin(op: '+' | '-' | '*' | '/' | '^', left: ResolvedFormula, right: ResolvedFormula): ResolvedFormula {
  return { kind: 'bin', op, left, right };
}
function driverRef(driverId: string): ResolvedFormula {
  return { kind: 'driverRef', driverId };
}

function line(id: string, name: string, formula: ResolvedFormula | null = null): StatementLine {
  return {
    id, name, required: false, rowFormat: 'normal', numberFormat: 'number', sign: 'natural', aggregation: 'sum',
    formula, projection: null, aliases: [],
  };
}

function driver(id: string): DriverDefinition {
  return { id, name: 'Growth', unit: '%', targetLineId: 'rev', method: 'growth' };
}

function period(id: string, kind: TimelinePeriod['kind']): TimelinePeriod {
  return { id, type: 'FY', endDate: `${id}-12-31`, label: id, kind };
}

function schema(): StatementSchema {
  return {
    id: 's1', name: 'Test', createdAt: 't0', updatedAt: 't0',
    sections: [{ id: 'sec', name: 'Section', lines: [line('rev', 'Revenue', bin('+', num(100), driverRef('d1')))] }],
    drivers: [driver('d1')],
  };
}

function model(driverValues: Record<string, (number | null)[]> = {}): Model {
  return {
    id: 'm1', companyId: 'c1', name: 'Model', statementSchemaId: 's1', modelImportId: 'mi1', mappingId: 'map1',
    timeline: [period('2023', 'actual'), period('2024', 'actual'), period('2025', 'projected')],
    historicals: {}, driverValues, createdAt: 't0', updatedAt: 't0', instancesUpdatedAt: 't0',
  };
}

function scenario(driverValues: Record<string, (number | null)[]>): Scenario {
  return { id: 'sc1', modelId: 'm1', name: 'Downside', driverValues, createdAt: 't0', updatedAt: 't0' };
}

function company(): Company {
  return { id: 'c1', name: 'Acme Co', createdAt: 't0' };
}

function mapping(): Mapping {
  return {
    id: 'map1', modelImportId: 'mi1', statementSchemaId: 's1',
    lines: [{ targetLineId: 'rev', sourceLineIds: ['src1'], method: 'exact', confidence: 1, note: '', approved: true }],
    mappedAt: 't0',
  };
}

function modelImport(): ModelImport {
  return {
    id: 'mi1', companyId: 'c1', templateType: 'basis-template', statementSchemaId: 's1',
    fileName: 'model.xlsx', fileSize: 100, uploadedAt: 't0', file: new Blob(),
  };
}

describe('defaultSnapshotLabel', () => {
  it('combines the last actual period label with today\'s date', () => {
    const label = defaultSnapshotLabel(model());
    expect(label.startsWith('2024 · ')).toBe(true);
  });

  it('falls back to just the date when the timeline is empty', () => {
    const empty: Model = { ...model(), timeline: [] };
    const label = defaultSnapshotLabel(empty);
    expect(label).not.toContain('·');
  });
});

describe('buildSnapshot', () => {
  it('freezes exactly one case (Base) when no scenarios exist, with correctly evaluated values', () => {
    const input = buildSnapshot({
      company: company(), model: model({ d1: [null, null, 0.1] }), schema: schema(), mapping: mapping(),
      modelImport: modelImport(), scenarios: [], instances: [], label: 'FY2024 · Test', note: '',
    });
    expect(input.scenarios).toHaveLength(1);
    expect(input.scenarios[0].scenarioId).toBe('base');
    expect(input.scenarios[0].values.rev).toEqual([100, 100, 100.1]);
  });

  it('freezes each named scenario with its own merged, independently-correct values', () => {
    const input = buildSnapshot({
      company: company(), model: model({ d1: [null, null, 0.1] }), schema: schema(), mapping: mapping(),
      modelImport: modelImport(), scenarios: [scenario({ d1: [null, null, 0.5] })], instances: [], label: 'FY2024 · Test', note: '',
    });
    expect(input.scenarios).toHaveLength(2);
    const base = input.scenarios.find((s) => s.scenarioId === 'base')!;
    const downside = input.scenarios.find((s) => s.scenarioId === 'sc1')!;
    expect(base.values.rev[2]).toBe(100.1);
    expect(downside.values.rev[2]).toBe(100.5);
    expect(downside.name).toBe('Downside');
  });

  it('deep-copies the schema — mutating the live schema afterward never changes the snapshot', () => {
    const liveSchema = schema();
    const input = buildSnapshot({
      company: company(), model: model({ d1: [null, null, 0.1] }), schema: liveSchema, mapping: mapping(),
      modelImport: modelImport(), scenarios: [], instances: [], label: 'FY2024 · Test', note: '',
    });
    liveSchema.sections[0].lines[0].name = 'Renamed live';
    expect(input.schema.sections[0].lines[0].name).toBe('Revenue');
  });

  it('deep-copies instances — mutating the live array afterward never changes the snapshot', () => {
    const liveInstances = [
      { id: 'li1', modelId: 'm1', lineId: 'rev', name: 'Segment A', projection: { method: 'flat' as const }, createdAt: 't0', updatedAt: 't0' },
    ];
    const input = buildSnapshot({
      company: company(), model: model(), schema: schema(), mapping: mapping(), modelImport: modelImport(),
      scenarios: [], instances: liveInstances, label: 'FY2024 · Test', note: '',
    });
    liveInstances[0].name = 'Renamed live';
    expect(input.instances).toHaveLength(1);
    expect(input.instances[0].name).toBe('Segment A');
  });

  it('embeds only the mapping\'s reviewed content, not its live id/foreign-keys', () => {
    const input = buildSnapshot({
      company: company(), model: model(), schema: schema(), mapping: mapping(), modelImport: modelImport(),
      scenarios: [], instances: [], label: 'FY2024 · Test', note: '',
    });
    expect(input.mapping).toEqual({ lines: mapping().lines, mappedAt: 't0' });
    expect(input.mapping).not.toHaveProperty('id');
    expect(input.mapping).not.toHaveProperty('modelImportId');
  });

  it('carries the label and note through verbatim, note defaulting to an empty string when left blank', () => {
    const blank = buildSnapshot({
      company: company(), model: model(), schema: schema(), mapping: mapping(), modelImport: modelImport(),
      scenarios: [], instances: [], label: 'FY2024 · Test', note: '',
    });
    expect(blank.note).toBe('');

    const withNote = buildSnapshot({
      company: company(), model: model(), schema: schema(), mapping: mapping(), modelImport: modelImport(),
      scenarios: [], instances: [], label: 'FY2024 · Test', note: 'Completed earnings update',
    });
    expect(withNote.note).toBe('Completed earnings update');
    expect(withNote.label).toBe('FY2024 · Test');
  });

  it('carries modelId/companyId and source-file provenance without embedding the file itself', () => {
    const input = buildSnapshot({
      company: company(), model: model(), schema: schema(), mapping: mapping(), modelImport: modelImport(),
      scenarios: [], instances: [], label: 'FY2024 · Test', note: '',
    });
    expect(input.modelId).toBe('m1');
    expect(input.companyId).toBe('c1');
    expect(input.sourceFileName).toBe('model.xlsx');
    expect(input.sourceUploadedAt).toBe('t0');
    expect(input).not.toHaveProperty('file');
  });
});
