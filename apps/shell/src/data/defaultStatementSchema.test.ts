import { describe, expect, it } from 'vitest';
import { createDefaultStatementSchema } from './defaultStatementSchema';
import { evaluateModel } from '../lib/engine/evaluate';
import { addChildLine } from '../lib/statementLineChildren';
import { setLineRole } from '../lib/statementSchemaEdit';
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
    // Tiers are optional — a company with no tranches under a tier shouldn't be blocked from
    // mapping/saving.
    expect(lineByName.get('1L Debt')?.role).toBe('optional');
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

  it('makes both check lines the Check role, not debt', () => {
    expect(checks.lines.map((l) => l.name)).toEqual(['Balance Sheet Check', 'Cash Flow Check']);
    for (const l of checks.lines) {
      expect(l.role).toBe('check');
      expect(l.lineKind).toBeUndefined();
    }
  });

  // Every source (non-formula) Balance Sheet line needs a real value here — Total
  // Assets/Total Liabilities are built with "+", not sum(), so a single unmapped (null) input
  // anywhere in the chain would make the whole total null rather than the real number either
  // test below needs. Equity components ARE mapped directly (same "required, mapped-actual-wins"
  // convention as Cash & Equivalents) rather than left to Retained Earnings' roll-forward
  // formula, which is null in a first period with no prior period to roll forward from.
  function fullyMappedBalanceSheetHistoricals(equity: { commonStock?: number; retainedEarnings: number }) {
    return {
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
      ...(equity.commonStock !== undefined ? { [lineByName.get('Common Stock & APIC')!.id]: [equity.commonStock] } : {}),
      [lineByName.get('Retained Earnings')!.id]: [equity.retainedEarnings],
    } as Record<string, (number | null)[]>;
  }

  it('Balance Sheet Check reads 0 when mapped equity actually explains Assets − Liabilities', () => {
    // Total Assets (350) − Total Liabilities (40) = 310, matched exactly by the two equity
    // components below (10 + 300) — the real-tie-out case the Checks section exists to confirm.
    const model = {
      timeline: [period('2024')],
      historicals: fullyMappedBalanceSheetHistoricals({ commonStock: 10, retainedEarnings: 300 }),
    };
    const evaluation = evaluateModel(schema, model);
    const bsCheck = checks.lines.find((l) => l.name === 'Balance Sheet Check')!;
    expect(evaluation.getValue(lineByName.get('Total Assets')!.id, 0)).toBe(350);
    expect(evaluation.getValue(bsCheck.id, 0)).toBe(0);
  });

  it('Balance Sheet Check flags a real gap when mapped equity does not explain the balance sheet', () => {
    // Same 350/40 Assets/Liabilities as above, but equity is under-mapped (no Common Stock &
    // APIC, Retained Earnings short by 110) — exactly the kind of real setup gap (an equity
    // component the default schema doesn't capture, or a mapping error) this check exists to
    // surface, not an engine limitation.
    const model = {
      timeline: [period('2024')],
      historicals: fullyMappedBalanceSheetHistoricals({ retainedEarnings: 200 }),
    };
    const evaluation = evaluateModel(schema, model);
    const bsCheck = checks.lines.find((l) => l.name === 'Balance Sheet Check')!;
    expect(evaluation.getValue(bsCheck.id, 0)).toBeCloseTo(110 / 350, 10);
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

describe('createDefaultStatementSchema — Equity roll-forward and Change in NWC', () => {
  const schema = createDefaultStatementSchema();
  const incomeStatement = schema.sections.find((s) => s.name === 'Income Statement')!;
  const balanceSheet = schema.sections.find((s) => s.name === 'Balance Sheet')!;
  const cashFlow = schema.sections.find((s) => s.name === 'Cash Flow Statement')!;
  const bsByName = new Map(balanceSheet.lines.map((l) => [l.name, l]));
  const cfByName = new Map(cashFlow.lines.map((l) => [l.name, l]));
  const netIncomeLine = incomeStatement.lines.find((l) => l.name === 'Net Income')!;

  it('rolls Retained Earnings forward as prior + Net Income − Dividends once a period is unmapped', () => {
    const retainedEarnings = bsByName.get('Retained Earnings')!;
    const dividendsPaid = cfByName.get('Dividends Paid')!;
    const model = {
      timeline: [period('2024'), period('2025')],
      historicals: {
        [retainedEarnings.id]: [500, null],
        [netIncomeLine.id]: [null, 80],
        [dividendsPaid.id]: [null, 20],
      } as Record<string, (number | null)[]>,
    };
    // Net Income is Calculated in the template (never mapped); this test is about the roll-forward
    // itself, so feed it directly by treating that one line as sourced.
    const evaluation = evaluateModel(setLineRole(schema, netIncomeLine.id, 'optional'), model);
    expect(evaluation.getValue(retainedEarnings.id, 0)).toBe(500);
    expect(evaluation.getValue(retainedEarnings.id, 1)).toBe(560); // 500 + 80 − 20
  });

  it('Total Equity sums Common Stock & APIC and Retained Earnings — no longer a Total Assets − Total Liabilities plug', () => {
    const totalEquity = bsByName.get('Total Equity')!;
    expect(totalEquity.formula).toEqual({
      kind: 'call',
      fn: 'sum',
      args: [
        { kind: 'ref', lineId: bsByName.get('Common Stock & APIC')!.id },
        { kind: 'ref', lineId: bsByName.get('Retained Earnings')!.id },
      ],
    });
  });

  it('Change in Net Working Capital nets AP/Deferred Revenue increases against an AR increase', () => {
    const ar = bsByName.get('Accounts Receivable')!;
    const ap = bsByName.get('Accounts Payable')!;
    const deferredRevenue = bsByName.get('Deferred Revenue')!;
    const changeInNwc = cfByName.get('Change in Net Working Capital')!;
    const model = {
      timeline: [period('2024'), period('2025')],
      historicals: {
        [ar.id]: [100, 130], // +30 — a cash outflow
        [ap.id]: [40, 55], // +15 — a cash inflow
        [deferredRevenue.id]: [10, 20], // +10 — a cash inflow
      } as Record<string, (number | null)[]>,
    };
    const evaluation = evaluateModel(schema, model);
    expect(evaluation.getValue(changeInNwc.id, 0)).toBeNull(); // no prior period yet
    expect(evaluation.getValue(changeInNwc.id, 1)).toBe(15 + 10 - 30);
  });

  it('Net Cash from Financing Activities folds in Dividends Paid alongside debt', () => {
    const financing = cfByName.get('Net Cash from Financing Activities')!;
    const dividendsPaid = cfByName.get('Dividends Paid')!;
    const model = {
      timeline: [period('2024')],
      historicals: { [dividendsPaid.id]: [20] } as Record<string, (number | null)[]>,
    };
    const evaluation = evaluateModel(schema, model);
    // Debt Borrowings/Repayments are both null (zero tranches) — "-" propagates null, so only
    // Dividends Paid's own sign shows through here.
    expect(evaluation.getValue(financing.id, 0)).toBeNull();
    const withZeroDebt = {
      timeline: [period('2024')],
      historicals: {
        [dividendsPaid.id]: [20],
        [cfByName.get('Debt Borrowings')!.id]: [0],
        [cfByName.get('Debt Repayments')!.id]: [0],
      } as Record<string, (number | null)[]>,
    };
    const evaluationWithDebt = evaluateModel(schema, withZeroDebt);
    expect(evaluationWithDebt.getValue(financing.id, 0)).toBe(-20);
  });
});

describe('createDefaultStatementSchema — roles and projections', () => {
  const template = createDefaultStatementSchema();
  const allLines = template.sections.flatMap((s) => s.lines);
  const find = (sectionName: string, lineName: string) => template.sections.find((s) => s.name === sectionName)!.lines.find((l) => l.name === lineName)!;

  it('links Net Interest Expense, Debt Borrowings and Debt Repayments to the Debt Schedule totals', () => {
    const cases: Array<[string, string, string]> = [
      ['Income Statement', 'Net Interest Expense', 'Interest Expense'],
      ['Cash Flow Statement', 'Debt Borrowings', 'Borrowings'],
      ['Cash Flow Statement', 'Debt Repayments', 'Repayments'],
    ];
    for (const [sectionName, lineName, scheduleLineName] of cases) {
      const target = find(sectionName, lineName);
      const scheduleLine = find('Debt Schedule', scheduleLineName);
      expect(target.projection).toEqual({ method: 'link', basisLineId: scheduleLine.id });
      expect(target.formula).toEqual({ kind: 'ref', lineId: scheduleLine.id });
    }
  });

  it('gives every sourced line a projection, except a debt line or a parent that sums sub-lines', () => {
    const missing = allLines
      .filter((l) => (l.role === 'required' || l.role === 'optional') && l.projection === null && l.lineKind !== 'debt' && !l.allowsSubLines)
      .map((l) => l.name);
    expect(missing).toEqual([]);
  });

  it('never gives a Calculated or Check line a projection', () => {
    const withProjection = allLines.filter((l) => (l.role === 'calculated' || l.role === 'check') && l.projection !== null && !l.debtScheduleRole).map((l) => l.name);
    expect(withProjection).toEqual([]);
  });
});
