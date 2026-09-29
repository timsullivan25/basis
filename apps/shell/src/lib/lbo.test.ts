import { describe, expect, it } from 'vitest';
import { addDefaultTranches, computeAbilityToPay, seedLboCase, type SeedLboCaseParams } from './lbo';
import { createLboStatementSchema } from './lboStatementSchema';
import { findSummaryLine } from './summaryLines';
import { evaluateModel } from './engine/evaluate';
import type { LboCase, LboFinancingInputs, StatementLine, StatementSchema, Timeline } from '../data';
import type { LineValues } from './computedCache';

function line(id: string, name: string, opts: Partial<StatementLine> = {}): StatementLine {
  return {
    id, name, role: 'optional', rowFormat: 'normal', numberFormat: 'number', sign: 'natural',
    aggregation: 'sum', formula: null, projection: null, aliases: [], ...opts,
  };
}

function baseSchema(): StatementSchema {
  return {
    id: 'base', name: 'Base', createdAt: '', updatedAt: '',
    sections: [{
      id: 'sec', name: 'Income Statement',
      lines: [
        line('rev', 'Revenue'), line('ebitda', 'EBITDA'), line('da', 'D&A'), line('ebit', 'EBIT'),
        line('capex', 'Capex'), line('nwc', 'Net Working Capital'), line('taxRate', 'Tax Rate'), line('netDebt', 'Net Debt'),
      ],
    }],
    drivers: [],
  };
}

function lineValues(values: Record<string, (number | null)[]>): LineValues {
  return { getValue: (lineId, periodIndex) => values[lineId]?.[periodIndex] ?? null, getError: () => undefined };
}

const BASE_TIMELINE: Timeline = [
  { id: 'p0', type: 'FY', endDate: '2023-12-31', label: 'FY23', kind: 'actual' },
  { id: 'p1', type: 'FY', endDate: '2024-12-31', label: 'FY24', kind: 'actual' },
];

describe('createLboStatementSchema', () => {
  it('builds a schema whose concept lines all resolve', () => {
    const { schema } = createLboStatementSchema(1);
    expect(findSummaryLine(schema, 'ebitda')).toBeDefined();
    expect(findSummaryLine(schema, 'fcf')).toBeDefined();
    expect(findSummaryLine(schema, 'cash')).toBeDefined();
    expect(findSummaryLine(schema, 'totalDebt')).toBeDefined();
    expect(findSummaryLine(schema, 'netDebt')).toBeDefined();
  });

  it('EBIT resolves against the Income Statement\'s own D&A, not the Cash Flow Statement pull-through (no ambiguity error)', () => {
    const { schema, lineIds } = createLboStatementSchema(1);
    const ebit = schema.sections.flatMap((s) => s.lines).find((l) => l.name === 'EBIT')!;
    expect(ebit.formula).toEqual({ kind: 'bin', op: '-', left: { kind: 'ref', lineId: lineIds.ebitda }, right: { kind: 'ref', lineId: lineIds.da } });
  });

  it('starts with zero tranches — Total Debt has no formula yet', () => {
    const { schema, lineIds } = createLboStatementSchema(1);
    const totalDebt = schema.sections.flatMap((s) => s.lines).find((l) => l.id === lineIds.totalDebt)!;
    expect(totalDebt.formula).toBeNull();
  });
});

describe('seedLboCase', () => {
  function seed(overrides: Partial<SeedLboCaseParams> = {}) {
    const schema = baseSchema();
    const evaluation = lineValues({
      rev: [1000, 1100],
      ebitda: [400, 440],
      da: [50, 55],
      capex: [40, 44],
      nwc: [100, 110],
      taxRate: [0.25, 0.25],
      ebit: [350, 385],
      netDebt: [800, 800],
    });
    return seedLboCase({
      modelId: 'model-1', baseSchema: schema, baseTimeline: BASE_TIMELINE, baseEvaluation: evaluation,
      entryPeriodIndex: 1, horizonYears: 3, ...overrides,
    });
  }

  it('seeds entry-period historicals from the base model\'s resolved concepts', () => {
    const result = seed();
    expect(result.historicals[result.schema.sections.flatMap((s) => s.lines).find((l) => l.name === 'Revenue')!.id][0]).toBe(1100);
  });

  it('sizes the default Term Loan at leverageMultiple × entry EBITDA, with the Revolver undrawn', () => {
    const result = seed();
    const termLoan = result.schema.sections.flatMap((s) => s.lines).find((l) => l.name === 'Term Loan')!;
    const revolver = result.schema.sections.flatMap((s) => s.lines).find((l) => l.name === 'Revolver')!;
    // existing Net Debt (800) / entry EBITDA (440) seeds leverageMultiple
    expect(result.financing.leverageMultiple).toBeCloseTo(800 / 440);
    expect(result.historicals[termLoan.id][0]).toBeCloseTo((800 / 440) * 440);
    expect(result.historicals[revolver.id][0]).toBe(0);
  });

  it('extends the timeline horizonYears beyond the single entry period, all marked projected', () => {
    const result = seed({ horizonYears: 4 });
    expect(result.timeline).toHaveLength(5);
    expect(result.timeline[0].kind).toBe('actual');
    expect(result.timeline.slice(1).every((p) => p.kind === 'projected')).toBe(true);
  });

  it('evaluates end to end: Revenue grows at the implied entry-period rate, and positive FCF sweeps the Term Loan down over time', () => {
    const result = seed({ horizonYears: 3 });
    const evaluation = evaluateModel(result.schema, { timeline: result.timeline, historicals: result.historicals, driverValues: result.driverValues });
    const revenueId = result.schema.sections.flatMap((s) => s.lines).find((l) => l.name === 'Revenue')!.id;
    const totalDebtId = result.schema.sections.flatMap((s) => s.lines).find((l) => l.name === 'Total Debt')!.id;

    // implied growth = 1100/1000 - 1 = 10%
    expect(evaluation.getValue(revenueId, 0)).toBe(1100);
    expect(evaluation.getValue(revenueId, 1)).toBeCloseTo(1210);
    expect(evaluation.getValue(revenueId, 2)).toBeCloseTo(1331);

    const entryDebt = evaluation.getValue(totalDebtId, 0)!;
    const laterDebt = evaluation.getValue(totalDebtId, 3)!;
    expect(laterDebt).toBeLessThan(entryDebt);
  });
});

describe('addDefaultTranches', () => {
  it('is safe to call again with a different leverageMultiple — resizes the Term Loan face value', () => {
    const { schema } = createLboStatementSchema(1);
    const totalDebtId = schema.sections.flatMap((s) => s.lines).find((l) => l.name === 'Total Debt')!.id;
    const result = addDefaultTranches({
      schema, totalDebtLineId: totalDebtId, periodCount: 2, periodsPerYear: 1,
      entryEbitda: 500, leverageMultiple: 5, historicals: {}, driverValues: {},
    });
    const termLoan = result.schema.sections.flatMap((s) => s.lines).find((l) => l.name === 'Term Loan')!;
    expect(result.historicals[termLoan.id][0]).toBe(2500);
    expect(termLoan.debtProperties?.originalFaceValue).toBe(2500);
  });
});

describe('computeAbilityToPay', () => {
  function lboCase(financing: Partial<LboFinancingInputs> = {}): LboCase {
    return {
      id: 'm1', modelId: 'm1', entryPeriodLabel: 'FY24',
      schema: { id: 's', name: 'LBO', createdAt: '', updatedAt: '', sections: [], drivers: [] },
      timeline: Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, type: 'FY' as const, endDate: `${2024 + i}-12-31`, label: `FY${24 + i}`, kind: i === 0 ? ('actual' as const) : ('projected' as const) })),
      historicals: {}, driverValues: {},
      financing: { leverageMultiple: 4, targetIrrs: [0.2], exitMultiple: null, exitPeriodIndex: null, transactionExpensesPct: null, ...financing },
      createdAt: '', updatedAt: '',
    };
  }

  const evaluation = lineValues({
    ebitda: [100, null, null, null, null, 150],
    totalDebt: [400, null, null, null, null, 50],
    cash: [0, null, null, null, null, 10],
  });
  const lineIds = { ebitda: 'ebitda', totalDebt: 'totalDebt', cash: 'cash' };

  it('MOIC always equals (1 + target IRR) ^ holding years — the solve is self-consistent by construction', () => {
    for (const exitMultiple of [null, 8, 10]) {
      const rows = computeAbilityToPay(lboCase({ exitMultiple }), evaluation, lineIds);
      expect(rows[0].moic).toBeCloseTo(Math.pow(1.2, 5), 6);
    }
  });

  it('matches a hand-computed entry multiple for an explicit (non-expanding-assumption) exit multiple', () => {
    // exitEquity = 150*8 - (50-10) = 1160; entryTEV = 1160/1.2^5 + 400 - 0 = 866.16...; multiple = /100
    const rows = computeAbilityToPay(lboCase({ exitMultiple: 8, transactionExpensesPct: null }), evaluation, lineIds);
    const expectedEntryTev = 1160 / Math.pow(1.2, 5) + 400;
    expect(rows[0].impliedEntryEnterpriseValue).toBeCloseTo(expectedEntryTev, 6);
    expect(rows[0].impliedEntryMultiple).toBeCloseTo(expectedEntryTev / 100, 6);
  });

  it('propagates null, never a fabricated number, when the exit period has no resolved data', () => {
    const sparse = lineValues({ ebitda: [100], totalDebt: [400], cash: [0] });
    const rows = computeAbilityToPay(lboCase(), sparse, lineIds);
    expect(rows[0].impliedEntryMultiple).toBeNull();
    expect(rows[0].moic).toBeNull();
  });

  it('one row per target IRR, in the order given', () => {
    const rows = computeAbilityToPay(lboCase({ targetIrrs: [0.15, 0.2, 0.25] }), evaluation, lineIds);
    expect(rows.map((r) => r.targetIrr)).toEqual([0.15, 0.2, 0.25]);
    // A higher bar for return means a lower price can be paid today.
    expect(rows[0].impliedEntryMultiple!).toBeGreaterThan(rows[1].impliedEntryMultiple!);
    expect(rows[1].impliedEntryMultiple!).toBeGreaterThan(rows[2].impliedEntryMultiple!);
  });
});
