import { describe, expect, it } from 'vitest';
import { applyDynamicInstances } from './withDynamicInstances';
import { evaluateModel } from './evaluate';
import type { LineInstance, ResolvedFormula, StatementLine, StatementSchema, TimelinePeriod } from '../../data';

function line(id: string, name: string, formula: ResolvedFormula | null = null, allowsSubLines = false): StatementLine {
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
    allowsSubLines,
  };
}

function ref(lineId: string): ResolvedFormula {
  return { kind: 'ref', lineId };
}

function period(id: string, kind: TimelinePeriod['kind'] = 'actual'): TimelinePeriod {
  return { id, type: 'FY', endDate: `${id}-12-31`, label: id, kind };
}

function instance(
  id: string,
  overrides: Partial<Pick<LineInstance, 'lineId' | 'sectionId' | 'projection'>> & { name?: string } = {},
): LineInstance {
  return {
    id,
    modelId: 'm1',
    name: overrides.name ?? id,
    lineId: overrides.lineId,
    sectionId: overrides.sectionId,
    sourceLineIds: [],
    projection: overrides.projection ?? { method: 'flat' },
    createdAt: 't0',
    updatedAt: 't0',
  };
}

describe('applyDynamicInstances', () => {
  it('is a pure regression when there are zero instances — identical schema shape and values', () => {
    const schema: StatementSchema = {
      id: 's1',
      name: 'Test',
      createdAt: '',
      updatedAt: '',
      sections: [{ id: 'sec', name: 'Section', lines: [line('rev', 'Revenue', null, true), line('cogs', 'Cost of Revenue')] }],
      drivers: [],
    };
    const model = { timeline: [period('2024')], historicals: { rev: [100], cogs: [40] } };

    const direct = evaluateModel(schema, model);
    const { schema: instancedSchema, evaluation } = applyDynamicInstances(schema, model, []);

    expect(instancedSchema.sections[0].lines.map((l) => l.id)).toEqual(['rev', 'cogs']);
    expect(evaluation.getValue('rev', 0)).toBe(direct.getValue('rev', 0));
    expect(evaluation.getValue('cogs', 0)).toBe(direct.getValue('cogs', 0));
  });

  it('sums two sub-line instances into their allowsSubLines parent, superseding its direct mapping', () => {
    const schema: StatementSchema = {
      id: 's1',
      name: 'Test',
      createdAt: '',
      updatedAt: '',
      sections: [
        {
          id: 'sec',
          name: 'Income Statement',
          lines: [line('rev', 'Revenue', null, true), line('gp', 'Gross Profit', ref('rev'))],
        },
      ],
      drivers: [],
    };
    // A direct mapping on Revenue itself — must be superseded once instances exist.
    const model = { timeline: [period('2024')], historicals: { rev: [999] } as Record<string, (number | null)[]> };
    const instances = [
      instance('seg-a', { lineId: 'rev', name: 'Segment A' }),
      instance('seg-b', { lineId: 'rev', name: 'Segment B' }),
    ];
    model.historicals['seg-a'] = [60];
    model.historicals['seg-b'] = [40];

    const { evaluation } = applyDynamicInstances(schema, model, instances);
    expect(evaluation.getValue('rev', 0)).toBe(100);
    expect(evaluation.getValue('gp', 0)).toBe(100); // formula chained off Revenue picks up the rollup
  });

  it('resolves a sibling-instance basis — a sub-line driven off another sub-line, not the parent total', () => {
    const schema: StatementSchema = {
      id: 's1',
      name: 'Test',
      createdAt: '',
      updatedAt: '',
      sections: [
        {
          id: 'sec',
          name: 'Income Statement',
          lines: [line('rev', 'Revenue', null, true), line('cogs', 'Cost of Revenue', null, true)],
        },
      ],
      drivers: [],
    };
    const model = { timeline: [period('2024')], historicals: {} as Record<string, (number | null)[]>, driverValues: {} as Record<string, (number | null)[]> };
    model.historicals['seg-a-rev'] = [200];
    model.historicals['seg-b-rev'] = [800]; // total revenue 1000 — a % of THIS would be wrong for seg-a's COGS
    model.driverValues['cogs-driver'] = [0.5]; // 50% of segment A's own revenue

    const instances = [
      instance('seg-a-rev', { lineId: 'rev', name: 'Segment A' }),
      instance('seg-b-rev', { lineId: 'rev', name: 'Segment B' }),
      instance('seg-a-cogs', {
        lineId: 'cogs',
        name: 'Segment A COGS',
        projection: { method: 'percent-of', driverId: 'cogs-driver', basisLineId: 'seg-a-rev' },
      }),
    ];

    const { evaluation } = applyDynamicInstances(schema, model, instances);
    expect(evaluation.getValue('rev', 0)).toBe(1000);
    // 50% of Segment A's own 200, not 50% of total 1000 (which would be 500).
    expect(evaluation.getValue('seg-a-cogs', 0)).toBe(100);
    expect(evaluation.getValue('cogs', 0)).toBe(100);
  });

  it('displays a freeform (KPI-style) instance under its section with no rollup injection anywhere', () => {
    const schema: StatementSchema = {
      id: 's1',
      name: 'Test',
      createdAt: '',
      updatedAt: '',
      sections: [{ id: 'kpis', name: 'KPIs', lines: [], allowsFreeformLines: true }],
      drivers: [],
    };
    const model = { timeline: [period('2024')], historicals: { 'kpi-1': [42] } };
    const instances = [instance('kpi-1', { sectionId: 'kpis', name: 'Monthly Active Users' })];

    const { schema: instancedSchema, evaluation } = applyDynamicInstances(schema, model, instances);
    expect(instancedSchema.sections[0].lines.map((l) => l.id)).toEqual(['kpi-1']);
    expect(evaluation.getValue('kpi-1', 0)).toBe(42);
  });

  it('defensively skips an instance whose target line no longer allows sub-lines, without crashing', () => {
    const schema: StatementSchema = {
      id: 's1',
      name: 'Test',
      createdAt: '',
      updatedAt: '',
      sections: [{ id: 'sec', name: 'Section', lines: [line('rev', 'Revenue', null, false)] }], // flag off
      drivers: [],
    };
    const model = { timeline: [period('2024')], historicals: { rev: [500] } as Record<string, (number | null)[]> };
    const instances = [instance('seg-a', { lineId: 'rev', name: 'Segment A' })];
    model.historicals['seg-a'] = [60];

    const { schema: instancedSchema, evaluation } = applyDynamicInstances(schema, model, instances);
    expect(instancedSchema.sections[0].lines.map((l) => l.id)).toEqual(['rev']); // not spliced in
    expect(evaluation.getValue('rev', 0)).toBe(500); // direct mapping intact, not superseded
  });

  it('defensively skips an instance whose lineId/sectionId no longer resolves at all, without crashing', () => {
    const schema: StatementSchema = {
      id: 's1',
      name: 'Test',
      createdAt: '',
      updatedAt: '',
      sections: [{ id: 'sec', name: 'Section', lines: [line('rev', 'Revenue', null, true)] }],
      drivers: [],
    };
    const model = { timeline: [period('2024')], historicals: { rev: [500] } };
    const instances = [instance('orphan', { lineId: 'deleted-line', name: 'Orphaned segment' })];

    expect(() => applyDynamicInstances(schema, model, instances)).not.toThrow();
    const { evaluation } = applyDynamicInstances(schema, model, instances);
    expect(evaluation.getValue('rev', 0)).toBe(500);
  });
});
