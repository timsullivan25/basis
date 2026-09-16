import { describe, expect, it } from 'vitest';
import { createDefaultStatementSchema } from './defaultStatementSchema';
import { evaluateModel } from '../lib/engine/evaluate';
import { addChildLine } from '../lib/statementLineChildren';
import type { TimelinePeriod } from './types';

function period(id: string): TimelinePeriod {
  return { id, type: 'FY', endDate: `${id}-12-31`, label: id, kind: 'actual' };
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

  it('marks each tier as lineKind "debt" — a schema-declared flag, not a hardcoded line-name check', () => {
    expect(lineByName.get('1L Debt')?.lineKind).toBe('debt');
    expect(lineByName.get('2L Debt')?.lineKind).toBe('debt');
    expect(lineByName.get('Unsecured Debt')?.lineKind).toBe('debt');
    // A line with no lineKind at all (an ordinary sub-line-hosting line, e.g. an EBITDA
    // bridge Delta) is not treated as a debt line — and there's no separate schema-level
    // revolver flag at all; Term/Revolver is just part of whichever debt-properties panel a
    // mapping-time tranche gets.
    const ebitdaSection = schema.sections.find((s) => s.name === 'EBITDA')!;
    const delta = ebitdaSection.lines.find((l) => l.name === 'Adjusted EBITDA Delta')!;
    expect(delta.allowsSubLines).toBe(true);
    expect(delta.lineKind).toBeUndefined();
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

    const { schema: withTermLoan, lineId: termLoanId } = addChildLine(schema, { kind: 'line', parentLineId: oneL.id }, 'Term Loan B');
    const { schema: withTranches, lineId: bondId } = addChildLine(withTermLoan, { kind: 'line', parentLineId: unsecured.id }, 'Senior Notes');

    const model = {
      timeline: [period('2024')],
      historicals: {
        [cash.id]: [50],
        [reportedEbitda.id]: [100],
        [termLoanId]: [300],
        [bondId]: [200],
      } as Record<string, (number | null)[]>,
    };

    const evaluation = evaluateModel(withTranches, model);
    const creditMetrics = withTranches.sections.find((s) => s.name === 'Credit Metrics')!;
    const netDebt = creditMetrics.lines.find((l) => l.name === 'Net Debt')!;
    const netLeverage = creditMetrics.lines.find((l) => l.name === 'Net Leverage')!;

    expect(evaluation.getValue(oneL.id, 0)).toBe(300);
    expect(evaluation.getValue(lineByName.get('Secured Debt')!.id, 0)).toBe(300);
    expect(evaluation.getValue(lineByName.get('Total Debt')!.id, 0)).toBe(500);
    expect(evaluation.getValue(netDebt.id, 0)).toBe(450); // 500 total debt - 50 cash
    expect(evaluation.getValue(netLeverage.id, 0)).toBe(4.5); // 450 net debt / 100 EBITDA
  });

  it('a single unused tier does not zero out the total — 2L Debt with no tranches is ignored, not treated as zero', () => {
    const oneL = lineByName.get('1L Debt')!;
    const { schema: withTermLoan, lineId: termLoanId } = addChildLine(schema, { kind: 'line', parentLineId: oneL.id }, 'Term Loan B');
    const model = { timeline: [period('2024')], historicals: { [termLoanId]: [300] } as Record<string, (number | null)[]> };

    const evaluation = evaluateModel(withTermLoan, model);
    expect(evaluation.getValue(lineByName.get('Secured Debt')!.id, 0)).toBe(300);
    expect(evaluation.getValue(lineByName.get('Total Debt')!.id, 0)).toBe(300);
  });
});

describe('createDefaultStatementSchema — Checks', () => {
  const schema = createDefaultStatementSchema();
  const checks = schema.sections.find((s) => s.name === 'Checks')!;
  const balanceSheet = schema.sections.find((s) => s.name === 'Balance Sheet')!;
  const lineByName = new Map(balanceSheet.lines.map((l) => [l.name, l]));

  it('tags both check lines as lineKind "check", not debt', () => {
    expect(checks.lines.map((l) => l.name)).toEqual(['Balance Sheet Check', 'Cash Flow Check']);
    for (const l of checks.lines) expect(l.lineKind).toBe('check');
  });

  it('Balance Sheet Check reads exactly 0 while Total Equity is still a plug', () => {
    // Every source (non-formula) Balance Sheet line needs a real value here — Total
    // Assets/Total Liabilities are built with "+", not sum(), so a single unmapped (null) input
    // anywhere in the chain would make the whole total null rather than the 0 this test needs.
    const model = {
      timeline: [period('2024')],
      historicals: {
        [lineByName.get('Cash & Equivalents')!.id]: [200],
        [lineByName.get('Accounts Receivable')!.id]: [100],
        [lineByName.get('Other Current Assets')!.id]: [0],
        [lineByName.get('Goodwill & Intangibles')!.id]: [50],
        [lineByName.get('Other Long Term Assets')!.id]: [0],
        [lineByName.get('Accounts Payable')!.id]: [40],
        [lineByName.get('Deferred Revenue')!.id]: [0],
        [lineByName.get('Other Current Liabilities')!.id]: [0],
        [lineByName.get('1L Debt')!.id]: [0],
        [lineByName.get('2L Debt')!.id]: [0],
        [lineByName.get('Unsecured Debt')!.id]: [0],
        [lineByName.get('Other Long Term Liabilities')!.id]: [0],
      } as Record<string, (number | null)[]>,
    };
    const evaluation = evaluateModel(schema, model);
    const bsCheck = checks.lines.find((l) => l.name === 'Balance Sheet Check')!;
    expect(evaluation.getValue(lineByName.get('Total Assets')!.id, 0)).toBe(350);
    expect(evaluation.getValue(bsCheck.id, 0)).toBe(0);
  });

  it('Cash Flow Check is null (not a false failure) in the first period — nothing to diff against yet, not an error', () => {
    const model = {
      timeline: [period('2024')],
      historicals: {
        [lineByName.get('Cash & Equivalents')!.id]: [100],
        [lineByName.get('Goodwill & Intangibles')!.id]: [50],
      } as Record<string, (number | null)[]>,
    };
    const evaluation = evaluateModel(schema, model);
    const cfCheck = checks.lines.find((l) => l.name === 'Cash Flow Check')!;
    expect(evaluation.getValue(cfCheck.id, 0)).toBeNull();
  });
});
