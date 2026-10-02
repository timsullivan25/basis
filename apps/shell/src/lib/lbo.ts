import type { CreateLboCaseInput, LboCase, LboFinancingInputs, ScenarioKey, StatementSchema, Timeline, TimelinePeriod } from '../data';
import type { LineValues } from './computedCache';
import { findSummaryLine, type SummaryConcept } from './summaryLines';
import { createLboStatementSchema, findMinCashTargetDriverId } from './lboStatementSchema';
import { extendTimeline } from './periodTimeline';
import { periodsPerYearFor, regenerateDebtSchedule } from './debtSchedule';
import { addChildLine, childrenOf } from './statementLineChildren';

export const DEFAULT_TARGET_IRRS = [0.15, 0.2, 0.25];
export const DEFAULT_HORIZON_YEARS = 5;
const DEFAULT_LEVERAGE_MULTIPLE = 4;
const DEFAULT_TERM_LOAN_COUPON = 0.08;
const DEFAULT_TERM_LOAN_AMORTIZATION = 0.01;
const DEFAULT_REVOLVER_COUPON = 0.06;
const DEFAULT_REVOLVER_COMMITMENT_FEE = 0.005;
/** The Revolver's commitment as a multiple of entry EBITDA — a common sizing convention (roughly
 *  half a turn of undrawn liquidity), unrelated to leverageMultiple (which sizes the Term Loan
 *  only). Set once at creation from whatever EBITDA is live then — same "pick a sensible starting
 *  number" status as the Term Loan's coupon/amort, not re-derived afterward (unlike the Term
 *  Loan's own face value — see buildLboEvaluationInputs). */
const DEFAULT_REVOLVER_COMMITMENT_MULTIPLE = 0.5;

function readConcept(schema: StatementSchema, evaluation: LineValues, concept: SummaryConcept, periodIndex: number): number | null {
  const l = findSummaryLine(schema, concept);
  return l ? evaluation.getValue(l.id, periodIndex) : null;
}

function findDriverIdForLine(schema: StatementSchema, targetLineId: string): string | undefined {
  return (schema.drivers ?? []).find((d) => d.targetLineId === targetLineId)?.id;
}

const DEFAULT_FINANCING: LboFinancingInputs = {
  leverageMultiple: null, targetIrrs: DEFAULT_TARGET_IRRS, exitMultiple: null, exitPeriodIndex: null, transactionExpensesPct: null,
};

/** A scenario's effective financing inputs — 'base' is ground truth, a named scenario's entry is
 *  sparse against it per-field, same shape and reason as lib/dcf.ts's own effectiveDcfInputs. */
export function effectiveLboFinancing(financing: Record<ScenarioKey, LboFinancingInputs>, scenarioId: ScenarioKey): LboFinancingInputs {
  const base = financing.base ?? DEFAULT_FINANCING;
  if (scenarioId === 'base') return base;
  const override = financing[scenarioId];
  return {
    leverageMultiple: override?.leverageMultiple ?? base.leverageMultiple,
    targetIrrs: override?.targetIrrs ?? base.targetIrrs,
    exitMultiple: override?.exitMultiple ?? base.exitMultiple,
    exitPeriodIndex: override?.exitPeriodIndex ?? base.exitPeriodIndex,
    transactionExpensesPct: override?.transactionExpensesPct ?? base.transactionExpensesPct,
  };
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
 * Builds a brand-new case's STRUCTURE — the financing package's tranches/terms, the timeline's
 * shape, and a starting 'base' financing entry — from one live read of the base model. That read
 * is used only to choose sensible STARTING numbers (default leverage matching the company's own
 * current Net Debt / EBITDA, the Revolver's commitment) — see LboCase's own doc comment for why
 * none of it is stored as a frozen copy afterward. Every subsequent evaluation re-resolves
 * Revenue/EBITDA/D&A/CapEx/Net Working Capital/tax rate live instead (buildLboEvaluationInputs).
 */
export function seedLboCase(params: SeedLboCaseParams): CreateLboCaseInput {
  const { modelId, baseSchema, baseTimeline, baseEvaluation, entryPeriodIndex, horizonYears = DEFAULT_HORIZON_YEARS } = params;
  const entryPeriod = baseTimeline[entryPeriodIndex];
  const periodsPerYear = periodsPerYearFor(entryPeriod.type);

  const ebitda = readConcept(baseSchema, baseEvaluation, 'ebitda', entryPeriodIndex);
  const existingNetDebt = readConcept(baseSchema, baseEvaluation, 'netDebt', entryPeriodIndex);
  const leverageMultiple =
    existingNetDebt !== null && ebitda !== null && ebitda > 0 ? Math.max(existingNetDebt / ebitda, 0) : DEFAULT_LEVERAGE_MULTIPLE;
  const revolverCommitment = ebitda !== null ? DEFAULT_REVOLVER_COMMITMENT_MULTIPLE * ebitda : 0;

  const { schema: builtSchema, lineIds } = createLboStatementSchema(periodsPerYear);
  const entryTimelinePeriod: TimelinePeriod = { ...entryPeriod, kind: 'actual' };
  const timeline = extendTimeline([entryTimelinePeriod], Math.round(horizonYears * periodsPerYear));

  const withTermLoan = addChildLine(builtSchema, { kind: 'line', parentLineId: lineIds.totalDebt }, 'Term Loan');
  const withRevolver = addChildLine(withTermLoan.schema, { kind: 'line', parentLineId: lineIds.totalDebt }, 'Revolver');
  let schema: StatementSchema = {
    ...withRevolver.schema,
    sections: withRevolver.schema.sections.map((s) => ({
      ...s,
      lines: s.lines.map((l) => {
        // No originalFaceValue set here for the Term Loan — it's the leverage-linked tranche,
        // whose effective face value buildLboEvaluationInputs derives live every evaluation
        // (leverageMultiple × that scenario's own entry EBITDA), never read from storage.
        if (l.id === withTermLoan.lineId) {
          return {
            ...l,
            debtProperties: {
              debtType: 'term', couponType: 'fixed', couponRate: DEFAULT_TERM_LOAN_COUPON,
              amortizationRate: DEFAULT_TERM_LOAN_AMORTIZATION, frequency: 'quarterly', repayable: true,
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

  const financing: LboFinancingInputs = {
    leverageMultiple, targetIrrs: DEFAULT_TARGET_IRRS, exitMultiple: null, exitPeriodIndex: null, transactionExpensesPct: 0.02,
  };

  return { modelId, entryPeriodIndex, horizonYears, schema, timeline, financing: { base: financing } };
}

export interface LboEvaluationInputs {
  /** lboCase.schema with the leverage-linked tranche's own debtProperties.originalFaceValue
   *  live-patched to leverageMultiple × this scenario's own entry EBITDA, and the Debt Schedule
   *  regenerated to bake that in (every debt formula embeds coupon/amort/commitment as literal
   *  constants at regeneration time — see regenerateDebtSchedule's own doc comment, which is why
   *  this always re-regenerates rather than only when something changed; it's idempotent and
   *  cheap at this scale). Never persisted back — this is a read-time view, not a new source of
   *  truth. */
  schema: StatementSchema;
  timeline: Timeline;
  historicals: Record<string, (number | null)[]>;
  driverValues: Record<string, (number | null)[]>;
}

/**
 * Assembles everything evaluateModel needs for one (LboCase, scenario) pair — resolving
 * Revenue/EBITDA/D&A/CapEx/Net Working Capital/tax rate LIVE off the base model's own evaluation
 * for that scenario, every call, rather than reading a stored copy. This is the one place an
 * LboCase's entry-period numbers and leverage-linked face value come from — see LboCase's own doc
 * comment for why nothing here is persisted. Called fresh on every render (same cost class as
 * evaluateModel itself at this schema's scale), the same way DCF's computeUfcf reads EBIT/D&A/
 * CapEx/NWC live rather than storing them.
 *
 * Every OTHER tranche (added via the panel's own tranche editor) keeps its own stored
 * debtProperties.originalFaceValue as a genuine, user-set deal term — only the first non-revolver
 * tranche (the one `leverageMultiple` controls) is treated as derived rather than stored; every
 * revolver always draws 0 at entry (undrawn at close, a structural certainty with nothing to look
 * up).
 */
export function buildLboEvaluationInputs(
  lboCase: Pick<LboCase, 'schema' | 'timeline' | 'entryPeriodIndex' | 'financing'>,
  scenarioId: ScenarioKey,
  baseSchema: StatementSchema,
  baseEvaluation: LineValues,
  baseTimeline: Timeline,
): LboEvaluationInputs {
  const financing = effectiveLboFinancing(lboCase.financing, scenarioId);
  const entryIndex = Math.min(lboCase.entryPeriodIndex, baseTimeline.length - 1);

  const revenue = readConcept(baseSchema, baseEvaluation, 'revenue', entryIndex);
  const ebitda = readConcept(baseSchema, baseEvaluation, 'ebitda', entryIndex);
  const da = readConcept(baseSchema, baseEvaluation, 'da', entryIndex);
  const capex = readConcept(baseSchema, baseEvaluation, 'capex', entryIndex);
  const nwc = readConcept(baseSchema, baseEvaluation, 'nwc', entryIndex);
  const taxRate = readConcept(baseSchema, baseEvaluation, 'taxRate', entryIndex);
  const ebit = readConcept(baseSchema, baseEvaluation, 'ebit', entryIndex);
  const priorRevenue = entryIndex > 0 ? readConcept(baseSchema, baseEvaluation, 'revenue', entryIndex - 1) : null;
  const impliedRevenueGrowth = revenue !== null && priorRevenue !== null && priorRevenue !== 0 ? revenue / priorRevenue - 1 : 0;

  const totalDebtLine = findSummaryLine(lboCase.schema, 'totalDebt');
  const children = totalDebtLine ? childrenOf(lboCase.schema, totalDebtLine.id) : [];
  const termTranche = children.find((l) => l.debtProperties?.debtType !== 'revolver');
  const termLoanFaceValue = ebitda !== null && financing.leverageMultiple !== null ? financing.leverageMultiple * ebitda : null;

  let schema = lboCase.schema;
  if (termTranche && termLoanFaceValue !== null) {
    schema = {
      ...schema,
      sections: schema.sections.map((s) => ({
        ...s,
        lines: s.lines.map((l) => (l.id === termTranche.id ? { ...l, debtProperties: { ...l.debtProperties, originalFaceValue: termLoanFaceValue } } : l)),
      })),
    };
  }
  const periodsPerYear = periodsPerYearFor(lboCase.timeline[0]?.type ?? 'FY');
  schema = regenerateDebtSchedule(schema, periodsPerYear, false);

  const periodCount = lboCase.timeline.length;
  const nullArray = (): (number | null)[] => new Array(periodCount).fill(null);
  const seedAtEntry = (value: number | null): (number | null)[] => {
    const arr = nullArray();
    arr[0] = value;
    return arr;
  };

  const historicals: Record<string, (number | null)[]> = {};
  const setIfResolved = (concept: SummaryConcept, value: number | null) => {
    const line = findSummaryLine(schema, concept);
    if (line) historicals[line.id] = seedAtEntry(value);
  };
  setIfResolved('revenue', revenue);
  setIfResolved('ebitda', ebitda);
  setIfResolved('da', da);
  setIfResolved('capex', capex);
  setIfResolved('nwc', nwc);
  setIfResolved('cash', 0);
  const taxExpenseLine = schema.sections.flatMap((s) => s.lines).find((l) => l.name === 'Income Tax Expense');
  if (taxExpenseLine) historicals[taxExpenseLine.id] = seedAtEntry(taxRate !== null && ebit !== null ? taxRate * Math.max(ebit, 0) : null);

  for (const child of children) {
    if (child.debtProperties?.debtType === 'revolver') {
      historicals[child.id] = seedAtEntry(0);
    } else if (child.id === termTranche?.id) {
      historicals[child.id] = seedAtEntry(termLoanFaceValue);
    } else {
      // A tranche the user added directly (see LboPanel's tranche editor) — its own
      // debtProperties.originalFaceValue is a genuine, user-set deal term, not derived.
      historicals[child.id] = seedAtEntry(child.debtProperties?.originalFaceValue ?? null);
    }
  }

  const driverValues: Record<string, (number | null)[]> = {};
  const revenueLine = findSummaryLine(schema, 'revenue');
  const revenueGrowthDriverId = revenueLine ? findDriverIdForLine(schema, revenueLine.id) : undefined;
  if (revenueGrowthDriverId) {
    const arr = nullArray();
    for (let i = 1; i < periodCount; i++) arr[i] = impliedRevenueGrowth;
    driverValues[revenueGrowthDriverId] = arr;
  }
  const minCashTargetDriverId = findMinCashTargetDriverId(schema);
  if (minCashTargetDriverId) driverValues[minCashTargetDriverId] = nullArray().fill(0);

  return { schema, timeline: lboCase.timeline, historicals, driverValues };
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
 * The "ability to pay" back-solve — the whole point of this analysis: rather than assuming an
 * entry multiple and computing a return, this fixes the financing package (leverageMultiple ×
 * entry EBITDA — entirely independent of purchase price, which is what breaks the chicken-and-egg
 * problem a %-of-EV leverage target would have) and a target IRR, then solves backward for the
 * maximum entry Enterprise Value/multiple that still clears that return. Takes the scenario's
 * already-resolved financing (see effectiveLboFinancing) rather than a whole LboCase, so it has no
 * opinion on which scenario is active — that's the caller's job.
 *
 * `exitMultiple: null` ("no multiple expansion") makes the exit multiple equal to the very entry
 * multiple being solved for — genuinely circular algebraically, but still closed-form: the unknown
 * M appears linearly on both sides (exit equity value scales with M, and M is also entryTEV /
 * entryEbitda), so it reduces to one linear equation in M rather than needing an iterative solver.
 * An explicit exitMultiple skips that and plugs directly.
 */
export function computeAbilityToPay(
  financing: LboFinancingInputs,
  timeline: Timeline,
  evaluation: LineValues,
  lineIds: { ebitda: string; totalDebt: string; cash: string },
): AbilityToPayRow[] {
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
