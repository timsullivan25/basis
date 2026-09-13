import { describe, expect, it } from 'vitest';
import { createDefaultStatementSchema } from './defaultStatementSchema';
import { applyDynamicInstances } from '../lib/engine/withDynamicInstances';
import type { LineInstance, TimelinePeriod } from './types';

function period(id: string): TimelinePeriod {
  return { id, type: 'FY', endDate: `${id}-12-31`, label: id, kind: 'actual' };
}

function tranche(id: string, lineId: string, name: string): LineInstance {
  return {
    id,
    modelId: 'm1',
    lineId,
    name,
    sourceLineIds: [],
    projection: { method: 'flat' },
    createdAt: 't0',
    updatedAt: 't0',
  };
}

describe('createDefaultStatementSchema — capital structure', () => {
  const schema = createDefaultStatementSchema();
  const balanceSheet = schema.sections.find((s) => s.name === 'Balance Sheet')!;
  const lineByName = new Map(balanceSheet.lines.map((l) => [l.name, l]));

  it('breaks debt out by seniority tier, each hosting sub-line instances', () => {
    expect(lineByName.get('1L Debt')?.allowsSubLines).toBe(true);
    expect(lineByName.get('2L Debt')?.allowsSubLines).toBe(true);
    expect(lineByName.get('Unsecured Debt')?.allowsSubLines).toBe(true);
    // Tiers are optional (required: false) — a company with no tranches under a tier shouldn't
    // be blocked from mapping/saving.
    expect(lineByName.get('1L Debt')?.required).toBe(false);
  });

  it('marks each tier as subLineKind "debt" — a schema-declared flag, not a hardcoded line-name check — and allows a revolver only on 1L', () => {
    expect(lineByName.get('1L Debt')?.subLineKind).toBe('debt');
    expect(lineByName.get('2L Debt')?.subLineKind).toBe('debt');
    expect(lineByName.get('Unsecured Debt')?.subLineKind).toBe('debt');
    expect(lineByName.get('1L Debt')?.allowsRevolver).toBe(true);
    expect(lineByName.get('2L Debt')?.allowsRevolver).toBeFalsy();
    expect(lineByName.get('Unsecured Debt')?.allowsRevolver).toBeFalsy();
    // A line with no subLineKind at all (an ordinary sub-line-hosting line, e.g. an EBITDA
    // bridge Delta) is not treated as a debt tier.
    const ebitdaSection = schema.sections.find((s) => s.name === 'EBITDA')!;
    const delta = ebitdaSection.lines.find((l) => l.name === 'Adjusted EBITDA Delta')!;
    expect(delta.allowsSubLines).toBe(true);
    expect(delta.subLineKind).toBeUndefined();
  });

  it('Secured Debt and Total Debt are pure subtotal formulas over the tiers', () => {
    const oneL = lineByName.get('1L Debt')!;
    const twoL = lineByName.get('2L Debt')!;
    const secured = lineByName.get('Secured Debt')!;
    const unsecured = lineByName.get('Unsecured Debt')!;
    const totalDebt = lineByName.get('Total Debt')!;

    expect(secured.formula).toEqual({
      kind: 'call',
      fn: 'sum',
      args: [{ kind: 'ref', lineId: oneL.id }, { kind: 'ref', lineId: twoL.id }],
    });
    expect(totalDebt.formula).toEqual({
      kind: 'call',
      fn: 'sum',
      args: [{ kind: 'ref', lineId: secured.id }, { kind: 'ref', lineId: unsecured.id }],
    });
  });

  it('rolls up real tranches across tiers into Secured Debt and Total Debt, feeding Net Debt/Net Leverage unchanged', () => {
    const oneL = lineByName.get('1L Debt')!;
    const unsecured = lineByName.get('Unsecured Debt')!;
    const cash = lineByName.get('Cash & Equivalents')!;
    const ebitdaBridge = schema.sections.find((s) => s.name === 'EBITDA')!;
    const reportedEbitda = ebitdaBridge.lines.find((l) => l.name === 'Reported EBITDA')!;

    const instances: LineInstance[] = [
      tranche('term-loan', oneL.id, 'Term Loan B'),
      tranche('bond', unsecured.id, 'Senior Notes'),
    ];
    const model = {
      timeline: [period('2024')],
      historicals: {
        [cash.id]: [50],
        [reportedEbitda.id]: [100],
        'term-loan': [300],
        bond: [200],
      } as Record<string, (number | null)[]>,
    };

    const { evaluation } = applyDynamicInstances(schema, model, instances);
    const creditMetrics = schema.sections.find((s) => s.name === 'Credit Metrics')!;
    const netDebt = creditMetrics.lines.find((l) => l.name === 'Net Debt')!;
    const netLeverage = creditMetrics.lines.find((l) => l.name === 'Net Leverage')!;

    expect(evaluation.getValue(lineByName.get('1L Debt')!.id, 0)).toBe(300);
    expect(evaluation.getValue(lineByName.get('Secured Debt')!.id, 0)).toBe(300);
    expect(evaluation.getValue(lineByName.get('Total Debt')!.id, 0)).toBe(500);
    expect(evaluation.getValue(netDebt.id, 0)).toBe(450); // 500 total debt - 50 cash
    expect(evaluation.getValue(netLeverage.id, 0)).toBe(4.5); // 450 net debt / 100 EBITDA
  });

  it('a single unused tier does not zero out the total — 2L Debt with no tranches is ignored, not treated as zero', () => {
    const oneL = lineByName.get('1L Debt')!;
    const instances: LineInstance[] = [tranche('term-loan', oneL.id, 'Term Loan B')];
    const model = { timeline: [period('2024')], historicals: { 'term-loan': [300] } as Record<string, (number | null)[]> };

    const { evaluation } = applyDynamicInstances(schema, model, instances);
    expect(evaluation.getValue(lineByName.get('Secured Debt')!.id, 0)).toBe(300);
    expect(evaluation.getValue(lineByName.get('Total Debt')!.id, 0)).toBe(300);
  });
});
