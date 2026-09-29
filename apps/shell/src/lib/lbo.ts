import type { CreateLboCaseInput, LboCase, LboFinancingInputs, StatementSchema, Timeline, TimelinePeriod } from '../data';
import type { LineValues } from './computedCache';
import { findSummaryLine, type SummaryConcept } from './summaryLines';
import { createLboStatementSchema, findMinCashTargetDriverId } from './lboStatementSchema';
import { extendTimeline } from './periodTimeline';
import { periodsPerYearFor, regenerateDebtSchedule } from './debtSchedule';
import { addChildLine } from './statementLineChildren';

export const DEFAULT_TARGET_IRRS = [0.15, 0.2, 0.25];
export const DEFAULT_HORIZON_YEARS = 5;
const DEFAULT_LEVERAGE_MULTIPLE = 4;
const DEFAULT_TERM_LOAN_COUPON = 0.08;
const DEFAULT_TERM_LOAN_AMORTIZATION = 0.01;
const DEFAULT_REVOLVER_COUPON = 0.06;
const DEFAULT_REVOLVER_COMMITMENT_FEE = 0.005;
/** The Revolver's commitment as a multiple of entry EBITDA — a common sizing convention
 *  (roughly half a turn of undrawn liquidity), unrelated to leverageMultiple (which sizes the
 *  Term Loan only — see seedLboCase). */
const DEFAULT_REVOLVER_COMMITMENT_MULTIPLE = 0.5;

function readConcept(schema: StatementSchema, evaluation: LineValues, concept: SummaryConcept, periodIndex: number): number | null {
  const l = findSummaryLine(schema, concept);
  return l ? evaluation.getValue(l.id, periodIndex) : null;
}

export interface SeedLboCaseParams {
  modelId: string;
  baseSchema: StatementSchema;
  baseTimeline: Timeline;
  baseEvaluation: LineValues;
  entryPeriodIndex: number;
  horizonYears?: number;
}

/**
 * Builds a fresh LboCase from the base model's own already-computed output — the "quick mapping"
 * this analysis needs, per lib/summaryLines.ts's concept resolution (the same mechanism DCF
 * already uses for its own inputs), not a real mapping UI. Only Revenue's own growth rate is
 * seeded as an explicit driver value; every percent-of driver (EBITDA margin, D&A/CapEx/Net
 * Working Capital % of revenue, tax rate) is deliberately left unset, relying on
 * evaluate.ts's own defaultDriverValue fallback (the last-actual-implied ratio) to derive exactly
 * the same "run-rate the entry period's own ratios forward" behavior with no extra computation
 * here — the LBO case's own single actual period (entry) IS lastActualIndex for its own
 * evaluation, so that fallback resolves against precisely the figures just seeded below.
 */
export function seedLboCase(params: SeedLboCaseParams): CreateLboCaseInput {
  const { modelId, baseSchema, baseTimeline, baseEvaluation, entryPeriodIndex, horizonYears = DEFAULT_HORIZON_YEARS } = params;
  const entryPeriod = baseTimeline[entryPeriodIndex];
  const periodsPerYear = periodsPerYearFor(entryPeriod.type);

  const revenue = readConcept(baseSchema, baseEvaluation, 'revenue', entryPeriodIndex);
  const ebitda = readConcept(baseSchema, baseEvaluation, 'ebitda', entryPeriodIndex);
  const da = readConcept(baseSchema, baseEvaluation, 'da', entryPeriodIndex);
  const capex = readConcept(baseSchema, baseEvaluation, 'capex', entryPeriodIndex);
  const nwc = readConcept(baseSchema, baseEvaluation, 'nwc', entryPeriodIndex);
  const taxRate = readConcept(baseSchema, baseEvaluation, 'taxRate', entryPeriodIndex);
  const ebit = readConcept(baseSchema, baseEvaluation, 'ebit', entryPeriodIndex);
  const existingNetDebt = readConcept(baseSchema, baseEvaluation, 'netDebt', entryPeriodIndex);

  const priorRevenue = entryPeriodIndex > 0 ? readConcept(baseSchema, baseEvaluation, 'revenue', entryPeriodIndex - 1) : null;
  const impliedRevenueGrowth = revenue !== null && priorRevenue !== null && priorRevenue !== 0 ? revenue / priorRevenue - 1 : 0;

  const { schema: builtSchema, lineIds } = createLboStatementSchema(periodsPerYear);

  const entryTimelinePeriod: TimelinePeriod = { ...entryPeriod, kind: 'actual' };
  const periodsToAdd = Math.round(horizonYears * periodsPerYear);
  const timeline = extendTimeline([entryTimelinePeriod], periodsToAdd);
  const periodCount = timeline.length;
  const nullArray = (): (number | null)[] => new Array(periodCount).fill(null);
  /** An index-0-only seed — every projected period stays null, since a sourced line's formula
   *  (the driver-backed projection, or evaluate.ts's own last-actual-implied-ratio default for
   *  an unset percent-of driver) is what fills those in, never a fabricated historical. */
  const seedAtEntry = (value: number | null): (number | null)[] => {
    const arr = nullArray();
    arr[0] = value;
    return arr;
  };

  const historicals: Record<string, (number | null)[]> = {
    [lineIds.revenue]: seedAtEntry(revenue),
    [lineIds.ebitda]: seedAtEntry(ebitda),
    [lineIds.da]: seedAtEntry(da),
    [lineIds.capex]: seedAtEntry(capex),
    [lineIds.nwc]: seedAtEntry(nwc),
    [lineIds.taxExpense]: seedAtEntry(taxRate !== null && ebit !== null ? taxRate * Math.max(ebit, 0) : null),
    [lineIds.cash]: seedAtEntry(0),
  };

  const revenueGrowthValues = nullArray();
  for (let i = 1; i < periodCount; i++) revenueGrowthValues[i] = impliedRevenueGrowth;
  const driverValues: Record<string, (number | null)[]> = { [lineIds.revenueGrowthDriverId]: revenueGrowthValues };

  const leverageMultiple = existingNetDebt !== null && ebitda !== null && ebitda > 0 ? Math.max(existingNetDebt / ebitda, 0) : DEFAULT_LEVERAGE_MULTIPLE;

  const financing: LboFinancingInputs = {
    leverageMultiple,
    targetIrrs: DEFAULT_TARGET_IRRS,
    exitMultiple: null,
    exitPeriodIndex: null,
    transactionExpensesPct: 0.02,
  };

  const { schema, historicals: historicalsWithTranches, driverValues: driverValuesWithMinCash } = addDefaultTranches({
    schema: builtSchema,
    totalDebtLineId: lineIds.totalDebt,
    periodCount,
    periodsPerYear,
    entryEbitda: ebitda,
    leverageMultiple,
    historicals,
    driverValues,
  });

  return {
    modelId,
    entryPeriodLabel: entryPeriod.label,
    schema,
    timeline,
    historicals: historicalsWithTranches,
    driverValues: driverValuesWithMinCash,
    financing,
  };
}

/** Adds the default Term Loan + Revolver tranches under "Total Debt" (per this analysis's own
 *  design decision: a full tranche editor is available, but a freshly-enabled case starts fully
 *  formed so the user never HAS to touch it) — sized off leverageMultiple × entry EBITDA, and
 *  seeds the Minimum Cash Target driver the Debt Schedule only generates once ≥1 tranche exists
 *  (see findMinCashTargetDriverId's own doc comment). Exported separately from seedLboCase so the
 *  financing panel can call this same logic again whenever leverageMultiple changes (see
 *  resizeDefaultTermLoan below) without re-seeding the whole case from the base model. */
export function addDefaultTranches(params: {
  schema: StatementSchema;
  totalDebtLineId: string;
  periodCount: number;
  periodsPerYear: number;
  entryEbitda: number | null;
  leverageMultiple: number;
  historicals: Record<string, (number | null)[]>;
  driverValues: Record<string, (number | null)[]>;
}): { schema: StatementSchema; historicals: Record<string, (number | null)[]>; driverValues: Record<string, (number | null)[]> } {
  const { totalDebtLineId, periodCount, periodsPerYear, entryEbitda, leverageMultiple, historicals, driverValues } = params;
  const termLoanFaceValue = entryEbitda !== null ? leverageMultiple * entryEbitda : 0;
  const revolverCommitment = entryEbitda !== null ? DEFAULT_REVOLVER_COMMITMENT_MULTIPLE * entryEbitda : 0;

  const withTermLoan = addChildLine(params.schema, { kind: 'line', parentLineId: totalDebtLineId }, 'Term Loan');
  const withRevolver = addChildLine(withTermLoan.schema, { kind: 'line', parentLineId: totalDebtLineId }, 'Revolver');

  const nullArray = (): (number | null)[] => new Array(periodCount).fill(null);
  const termLoanHistoricals = nullArray();
  termLoanHistoricals[0] = termLoanFaceValue;
  const revolverHistoricals = nullArray();
  revolverHistoricals[0] = 0;

  let schema: StatementSchema = {
    ...withRevolver.schema,
    sections: withRevolver.schema.sections.map((s) => ({
      ...s,
      lines: s.lines.map((l) => {
        if (l.id === withTermLoan.lineId) {
          return {
            ...l,
            debtProperties: {
              debtType: 'term', couponType: 'fixed', couponRate: DEFAULT_TERM_LOAN_COUPON,
              amortizationRate: DEFAULT_TERM_LOAN_AMORTIZATION, originalFaceValue: termLoanFaceValue,
              frequency: 'quarterly', repayable: true,
            },
          };
        }
        if (l.id === withRevolver.lineId) {
          return {
            ...l,
            debtProperties: {
              debtType: 'revolver', couponType: 'fixed', couponRate: DEFAULT_REVOLVER_COUPON,
              commitmentAmount: revolverCommitment, commitmentFeeRate: DEFAULT_REVOLVER_COMMITMENT_FEE,
              frequency: 'quarterly', repayable: true,
            },
          };
        }
        return l;
      }),
    })),
  };
  schema = regenerateDebtSchedule(schema, periodsPerYear, false);

  const minCashTargetDriverId = findMinCashTargetDriverId(schema);
  const nextDriverValues = { ...driverValues };
  if (minCashTargetDriverId) nextDriverValues[minCashTargetDriverId] = nullArray().fill(0);

  return {
    schema,
    historicals: { ...historicals, [withTermLoan.lineId]: termLoanHistoricals, [withRevolver.lineId]: revolverHistoricals },
    driverValues: nextDriverValues,
  };
}

export interface AbilityToPayRow {
  targetIrr: number;
  /** Null whenever the closed-form solve has no valid answer (see computeAbilityToPay) — never
   *  fabricated by clamping to some arbitrary number. */
  impliedEntryMultiple: number | null;
  impliedEntryEnterpriseValue: number | null;
  sponsorEquityCheck: number | null;
  exitEquityValue: number | null;
  moic: number | null;
}

/**
 * The "ability to pay" back-solve — the whole point of this analysis (see the LBO analysis's own
 * design discussion): rather than assuming an entry multiple and computing a return, this fixes
 * the financing package (leverageMultiple × entry EBITDA — entirely independent of purchase
 * price, which is what breaks the chicken-and-egg problem a %-of-EV leverage target would have)
 * and a target IRR, then solves backward for the maximum entry Enterprise Value/multiple that
 * still clears that return.
 *
 * `exitMultiple: null` ("no multiple expansion") makes the exit multiple equal to the very entry
 * multiple being solved for — genuinely circular algebraically, but still closed-form: the
 * unknown M appears linearly on both sides (exit equity value scales with M, and M is also
 * entryTEV / entryEbitda), so it reduces to one linear equation in M rather than needing an
 * iterative solver. An explicit exitMultiple skips that and plugs directly.
 */
export function computeAbilityToPay(lboCase: LboCase, evaluation: LineValues, lineIds: { ebitda: string; totalDebt: string; cash: string }): AbilityToPayRow[] {
  const { financing, timeline } = lboCase;
  const periodsPerYear = periodsPerYearFor(timeline[0]?.type ?? 'FY');
  const entryEbitda = evaluation.getValue(lineIds.ebitda, 0);
  const exitIndex = financing.exitPeriodIndex ?? timeline.length - 1;
  const exitEbitda = evaluation.getValue(lineIds.ebitda, exitIndex);
  const exitTotalDebt = evaluation.getValue(lineIds.totalDebt, exitIndex);
  const exitCash = evaluation.getValue(lineIds.cash, exitIndex);
  const exitNetDebt = exitTotalDebt !== null && exitCash !== null ? exitTotalDebt - exitCash : null;
  const debtRaised = entryEbitda !== null && financing.leverageMultiple !== null ? financing.leverageMultiple * entryEbitda : null;
  const transactionExpenses = financing.transactionExpensesPct !== null && entryEbitda !== null ? financing.transactionExpensesPct * entryEbitda : 0;
  const holdingPeriodYears = exitIndex / periodsPerYear;

  return financing.targetIrrs.map((targetIrr): AbilityToPayRow => {
    if (entryEbitda === null || exitEbitda === null || exitNetDebt === null || debtRaised === null) {
      return { targetIrr, impliedEntryMultiple: null, impliedEntryEnterpriseValue: null, sponsorEquityCheck: null, exitEquityValue: null, moic: null };
    }
    const discountFactor = 1 / Math.pow(1 + targetIrr, holdingPeriodYears);
    let impliedEntryMultiple: number | null;
    if (financing.exitMultiple !== null) {
      const exitEquityValue = exitEbitda * financing.exitMultiple - exitNetDebt;
      const entryTev = exitEquityValue * discountFactor + debtRaised - transactionExpenses;
      impliedEntryMultiple = entryTev / entryEbitda;
    } else {
      const denom = entryEbitda - exitEbitda * discountFactor;
      const numer = debtRaised - transactionExpenses - exitNetDebt * discountFactor;
      impliedEntryMultiple = denom !== 0 ? numer / denom : null;
    }
    if (impliedEntryMultiple === null || impliedEntryMultiple <= 0) {
      return { targetIrr, impliedEntryMultiple: null, impliedEntryEnterpriseValue: null, sponsorEquityCheck: null, exitEquityValue: null, moic: null };
    }
    const impliedEntryEnterpriseValue = impliedEntryMultiple * entryEbitda;
    const sponsorEquityCheck = impliedEntryEnterpriseValue - debtRaised + transactionExpenses;
    const exitMultipleUsed = financing.exitMultiple ?? impliedEntryMultiple;
    const exitEquityValue = exitEbitda * exitMultipleUsed - exitNetDebt;
    const moic = sponsorEquityCheck > 0 ? exitEquityValue / sponsorEquityCheck : null;
    return { targetIrr, impliedEntryMultiple, impliedEntryEnterpriseValue, sponsorEquityCheck, exitEquityValue, moic };
  });
}

/**
 * Resizes the default "Term Loan" tranche's face value to leverageMultiple × entry EBITDA and
 * regenerates the Debt Schedule (every debt formula bakes coupon/amort/commitment in as literal
 * constants at regeneration time — see regenerateDebtSchedule's own doc comment — so any
 * debtProperties edit, this one included, needs a fresh regenerate to actually take effect).
 * Finds the tranche by debtType (the first non-revolver debt-kind child of Total Debt), not by
 * name, so a rename doesn't silently break the leverage input; if the user has removed it
 * entirely or restructured to multiple term tranches, this only updates the financing input
 * itself — the panel's own full tranche editor is how they'd size a customized structure instead.
 */
export function applyLeverageMultiple(
  lboCase: Pick<LboCase, 'schema' | 'historicals' | 'timeline'>,
  totalDebtLineId: string,
  ebitdaLineId: string,
  leverageMultiple: number,
): { schema: StatementSchema; historicals: Record<string, (number | null)[]> } {
  const periodsPerYear = periodsPerYearFor(lboCase.timeline[0]?.type ?? 'FY');
  const entryEbitda = lboCase.historicals[ebitdaLineId]?.[0] ?? null;
  const termTranche = lboCase.schema.sections
    .flatMap((s) => s.lines)
    .find((l) => l.parentLineId === totalDebtLineId && l.debtProperties?.debtType !== 'revolver');

  if (!termTranche || entryEbitda === null) return { schema: lboCase.schema, historicals: lboCase.historicals };

  const newFaceValue = leverageMultiple * entryEbitda;
  let schema: StatementSchema = {
    ...lboCase.schema,
    sections: lboCase.schema.sections.map((s) => ({
      ...s,
      lines: s.lines.map((l) => (l.id === termTranche.id ? { ...l, debtProperties: { ...l.debtProperties, originalFaceValue: newFaceValue } } : l)),
    })),
  };
  schema = regenerateDebtSchedule(schema, periodsPerYear, false);

  const historicals = { ...lboCase.historicals, [termTranche.id]: [...(lboCase.historicals[termTranche.id] ?? [])] };
  historicals[termTranche.id][0] = newFaceValue;

  return { schema, historicals };
}
