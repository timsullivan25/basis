import type { DebtScheduleRole, DriverDefinition, PeriodType, ResolvedFormula, StatementLine, StatementSchema, StatementSection } from '../data/types';
import { childrenOf, effectiveLineKind } from './statementLineChildren';
import { findSummaryLine } from './summaryLines';
import {
  buildHardcodeFormula,
  buildCashAvailableForRepaymentFormula,
  buildCashShortfallFormula,
  buildDebtAmortizationFormula,
  buildDebtBeginningBalanceFormula,
  buildDebtCommitmentFeeFormula,
  buildDebtEndingBalanceFormula,
  buildDebtInterestFormula,
  buildDebtRepaymentFormula,
  buildRevolverBorrowingFormula,
  buildRevolverBreachFormula,
} from './engine/resolve';

/** How many of the model's own timeline periods make up a year — the proration divisor every
 *  per-period rate (coupon, commitment fee, amortization) needs. Assumes a uniform period type
 *  across the timeline, same assumption lib/engine/evaluate.ts's findPriorYear already makes. */
export function periodsPerYearFor(type: PeriodType): number {
  return type === 'Quarter' ? 4 : type === 'Semi-Annual' ? 2 : 1;
}

/** Builds (and fully rebuilds, every call — see below) the "Debt Schedule" section from every
 *  current debt tranche, the direct descendant of the old LineInstance for this one purpose:
 *  something that needs to exist per-tranche, only known at model time, now a real StatementLine
 *  in the model's own schema instead of a separate entity (see lib/statementLineChildren.ts,
 *  which this module deliberately does NOT reuse for the generated lines themselves — see
 *  StatementLine.debtScheduleRole's own doc comment for why that's a different relationship than
 *  parentLineId/allowsSubLines).
 *
 *  Every PER-TRANCHE line's id is deterministic, derived from its tranche's own id (see roleId
 *  below) — safe because a tranche's own id is already final by the time this function ever runs
 *  against it. A tranche (a debt-kind line, with or without children) can now be authored directly
 *  on a template too (see SchemaStructureEditor's own Debt tranche section) — but this function
 *  itself is still only ever called in a model's own context (see ModelMappingScreen's
 *  applyDebtSchedule/changeSchema), never against a bare template, which has no timeline to run it
 *  against. A template-authored tranche's id is simply re-keyed like every other line the moment a
 *  model forks its own private copy (see cloneStatementSchemaStructure), so it's already final by
 *  the time regeneration first sees it. The seven SCHEDULE-LEVEL lines (not tied to a tranche) are
 *  different: they're
 *  seeded once inside the default TEMPLATE (see defaultStatementSchema.ts), and a template gets
 *  re-keyed with fresh ids every time a model forks its own private copy (see
 *  cloneStatementSchemaStructure) — so this function never assumes one of *those* ids by a fixed
 *  constant. It looks each one up by its stable `debtScheduleRole.role` tag instead (plain data,
 *  copied verbatim by any clone) and reuses whatever id it already has; the DEFAULT_* constants
 *  below are only ever the id actually assigned the first time a given role has never existed in
 *  this schema before — see resolveScheduleLevelId.
 *
 *  Three schedule-level totals — Interest Expense, Borrowings, Repayments — always exist here,
 *  even with zero tranches (an empty sum() is null, per evaluate.ts). No other line is ever
 *  hunted down and overwritten to "feed" from them: a line that wants the schedule's total
 *  (Net Interest Expense, say) just carries an ordinary formula referencing it by name —
 *  "Debt Schedule.Interest Expense" — the exact same qualified-reference mechanism every other
 *  cross-section pull-through in this schema already uses (see defaultStatementSchema.ts). That
 *  formula, once compiled to a specific line id, gets remapped consistently by the SAME clone
 *  that re-keys the Debt Schedule's own lines — so it stays correct with no extra effort, as
 *  long as this function keeps reusing the post-clone id rather than a stale constant. */
export function regenerateDebtSchedule(
  schema: StatementSchema,
  periodsPerYear: number,
  circularCalcsEnabled: boolean,
): StatementSchema {
  const tranches = orderedTranches(schema);
  const cashLine = findSummaryLine(schema, 'cash');
  const fcfLine = findSummaryLine(schema, 'fcf');
  // Without a recognizable Cash & Equivalents / Free Cash Flow line (see lib/summaryLines.ts),
  // a tranche still gets its own roll-forward/interest/amortization — only the cash-driven
  // repayment sweep and revolver draw, which need somewhere to read cash from, are skipped.
  const canRunCashLogic = cashLine !== undefined && fcfLine !== undefined && tranches.length > 0;

  // Resolved once, up front — see this function's own doc comment for why these can't be bare
  // constants.
  const sectionId = schema.sections.find((s) => s.name === SECTION_NAME)?.id ?? DEFAULT_SECTION_ID;
  const minCashTargetId = resolveScheduleLevelId(schema, 'minimumCashTarget', DEFAULT_MIN_CASH_TARGET_ID);
  const cashAvailableId = resolveScheduleLevelId(schema, 'cashAvailableForRepayment', DEFAULT_CASH_AVAILABLE_ID);
  const cashShortfallId = resolveScheduleLevelId(schema, 'cashShortfall', DEFAULT_CASH_SHORTFALL_ID);
  const revolverBreachId = resolveScheduleLevelId(schema, 'revolverBreach', DEFAULT_REVOLVER_BREACH_ID);
  const totalInterestId = resolveScheduleLevelId(schema, 'totalInterestExpense', TOTAL_INTEREST_ID);
  const totalBorrowingsId = resolveScheduleLevelId(schema, 'totalBorrowings', TOTAL_BORROWINGS_ID);
  const totalRepaymentsId = resolveScheduleLevelId(schema, 'totalRepayments', TOTAL_REPAYMENTS_ID);
  const minCashTargetProjection = allLines(schema).find((l) => l.id === minCashTargetId)?.projection;
  const minCashTargetDriverId =
    (minCashTargetProjection && 'driverId' in minCashTargetProjection ? minCashTargetProjection.driverId : undefined) ??
    DEFAULT_MIN_CASH_TARGET_DRIVER_ID;

  const generatedLines: StatementLine[] = [];
  const interestFeedIds: string[] = [];
  const borrowingFeedIds: string[] = [];
  const repaymentFeedIds: string[] = [];
  // Grows as tranches are walked in seniority order (revolver(s) first, then schema order) —
  // this running list IS the seniority waterfall: each tranche's own Repayment formula
  // subtracts every id already in it from the shared cash pool before taking its own share.
  const seniorRepaymentIds: string[] = [];

  let minCashTargetDriver: DriverDefinition | undefined;
  if (canRunCashLogic) {
    minCashTargetDriver = {
      id: minCashTargetDriverId,
      name: 'Minimum Cash Target',
      unit: '',
      targetLineId: minCashTargetId,
      method: 'hardcode',
    };
    generatedLines.push({
      ...blankLine(minCashTargetId, 'Minimum Cash Target', { role: 'minimumCashTarget' }),
      formula: buildHardcodeFormula(minCashTargetDriverId),
      projection: { method: 'hardcode', driverId: minCashTargetDriverId },
    });
    generatedLines.push({
      ...blankLine(cashAvailableId, 'Cash Available for Repayment', { role: 'cashAvailableForRepayment' }),
      formula: buildCashAvailableForRepaymentFormula(cashLine!.id, fcfLine!.id, minCashTargetDriverId),
    });
    generatedLines.push({
      ...blankLine(cashShortfallId, 'Cash Shortfall', { role: 'cashShortfall' }),
      formula: buildCashShortfallFormula(cashLine!.id, fcfLine!.id, minCashTargetDriverId),
    });
  }

  for (const tranche of tranches) {
    const props = tranche.debtProperties ?? {};
    const isRevolver = props.debtType === 'revolver';
    const beginningId = roleId(tranche.id, 'beginningBalance');
    const amortizationId = roleId(tranche.id, 'amortization');
    const repaymentId = roleId(tranche.id, 'repayment');
    const borrowingId = roleId(tranche.id, 'borrowing');
    const interestId = roleId(tranche.id, 'interestExpense');
    const endingId = roleId(tranche.id, 'endingBalance');

    generatedLines.push({
      ...blankLine(beginningId, `${tranche.name} — Beginning Balance`, { trancheLineId: tranche.id, role: 'beginningBalance' }),
      formula: buildDebtBeginningBalanceFormula(tranche.id),
    });

    // A revolver never amortizes on a schedule — zeroing the rate (rather than special-casing
    // the formula shape) is enough, since the builder naturally evaluates to 0 either way.
    generatedLines.push({
      ...blankLine(amortizationId, `${tranche.name} — Amortization`, { trancheLineId: tranche.id, role: 'amortization' }),
      formula: buildDebtAmortizationFormula(tranche.id, props.originalFaceValue, isRevolver ? 0 : (props.amortizationRate ?? 0), periodsPerYear),
    });

    // Repayment: a revolver is always the waterfall's first link (no more-senior tranche ahead
    // of it — see orderedTranches); a non-repayable tranche never repays; every other repayable
    // tranche gets the next link, chained off whatever's already senior to it. All three collapse
    // to a flat 0 without a recognizable cash line to sweep from.
    let repaymentFormula: ResolvedFormula;
    if (!canRunCashLogic) {
      repaymentFormula = { kind: 'num', value: 0 };
    } else if (!isRevolver && props.repayable === false) {
      repaymentFormula = { kind: 'num', value: 0 };
    } else {
      repaymentFormula = buildDebtRepaymentFormula(cashAvailableId, [...seniorRepaymentIds], beginningId, amortizationId);
    }
    generatedLines.push({
      ...blankLine(repaymentId, `${tranche.name} — Repayment`, { trancheLineId: tranche.id, role: 'repayment' }),
      formula: repaymentFormula,
    });
    if (isRevolver || props.repayable !== false) seniorRepaymentIds.push(repaymentId);

    // Only a revolver draws — a term tranche's own Borrowing is always a flat 0 in this model.
    generatedLines.push({
      ...blankLine(borrowingId, `${tranche.name} — Borrowing`, { trancheLineId: tranche.id, role: 'borrowing' }),
      formula:
        isRevolver && canRunCashLogic
          ? buildRevolverBorrowingFormula(cashShortfallId, props.commitmentAmount ?? 0, beginningId)
          : { kind: 'num', value: 0 },
    });

    generatedLines.push({
      ...blankLine(endingId, `${tranche.name} — Ending Balance`, { trancheLineId: tranche.id, role: 'endingBalance' }),
      formula: buildDebtEndingBalanceFormula(beginningId, amortizationId, repaymentId, borrowingId),
    });

    generatedLines.push({
      ...blankLine(interestId, `${tranche.name} — Interest Expense`, { trancheLineId: tranche.id, role: 'interestExpense' }),
      formula: buildDebtInterestFormula(props.couponRate ?? 0, periodsPerYear, beginningId, endingId, circularCalcsEnabled),
    });
    interestFeedIds.push(interestId);
    borrowingFeedIds.push(borrowingId);
    // The CFS "Debt Repayments" feed bundles mandatory amortization + swept repayment into one
    // line — the split only matters at this per-tranche schedule level (see Slice 0).
    repaymentFeedIds.push(amortizationId, repaymentId);

    if (isRevolver) {
      const feeId = roleId(tranche.id, 'commitmentFee');
      generatedLines.push({
        ...blankLine(feeId, `${tranche.name} — Commitment Fee`, { trancheLineId: tranche.id, role: 'commitmentFee' }),
        formula: buildDebtCommitmentFeeFormula(
          props.commitmentFeeRate ?? 0,
          periodsPerYear,
          props.commitmentAmount ?? 0,
          beginningId,
          endingId,
          circularCalcsEnabled,
        ),
      });
      interestFeedIds.push(feeId); // a commitment fee is a financing cost alongside coupon interest — same feed
    }
  }

  if (canRunCashLogic) {
    const revolver = tranches.find((t) => t.debtProperties?.debtType === 'revolver');
    generatedLines.push({
      ...blankLine(revolverBreachId, 'Revolver Availability Breach', { role: 'revolverBreach' }),
      formula: revolver
        ? buildRevolverBreachFormula(cashShortfallId, revolver.debtProperties?.commitmentAmount ?? 0, roleId(revolver.id, 'beginningBalance'))
        : buildRevolverBreachFormula(cashShortfallId, 0, undefined),
    });
  }

  // Always present, regardless of tranche count — see this function's own doc comment for why:
  // anything (Net Interest Expense, a custom schema's own line) can reference these by ordinary
  // qualified name at any time, so they can never be conditionally absent.
  generatedLines.push({
    ...blankLine(totalInterestId, 'Interest Expense', { role: 'totalInterestExpense' }),
    formula: { kind: 'call', fn: 'sum', args: interestFeedIds.map((id): ResolvedFormula => ({ kind: 'ref', lineId: id })) },
  });
  generatedLines.push({
    ...blankLine(totalBorrowingsId, 'Borrowings', { role: 'totalBorrowings' }),
    formula: { kind: 'call', fn: 'sum', args: borrowingFeedIds.map((id): ResolvedFormula => ({ kind: 'ref', lineId: id })) },
  });
  generatedLines.push({
    ...blankLine(totalRepaymentsId, 'Repayments', { role: 'totalRepayments' }),
    formula: { kind: 'call', fn: 'sum', args: repaymentFeedIds.map((id): ResolvedFormula => ({ kind: 'ref', lineId: id })) },
  });

  let next = withDebtScheduleSection(schema, sectionId, generatedLines);
  next = {
    ...next,
    drivers: minCashTargetDriver
      ? [...next.drivers.filter((d) => d.id !== minCashTargetDriverId), minCashTargetDriver]
      : next.drivers.filter((d) => d.id !== minCashTargetDriverId),
  };

  // Point every tranche's own line at its schedule's Ending Balance for every period without a
  // mapped value — the same "formula is the fallback" rule every line already follows; its own
  // actual-period historicals (mapped at import) still win outright, unchanged.
  for (const tranche of tranches) {
    next = updateLine(next, tranche.id, { formula: { kind: 'ref', lineId: roleId(tranche.id, 'endingBalance') } });
  }

  return next;
}

/** regenerateDebtSchedule for a bare template, which has no timeline or model settings to read:
 *  annual periods and no circular calcs, the same assumption createDefaultStatementSchema seeds
 *  its own schedule with. Those two only change constants inside the generated formulas (per-
 *  period proration, avg-vs-beginning balance) — never which lines exist or their ids — and a
 *  model regenerates with its real values the moment it forks the template, so nothing here
 *  needs to be right about them. Safe to call on every edit: idempotent, and every generated
 *  line's id is stable (see regenerateDebtSchedule), so a formula referencing one keeps working. */
export function regenerateTemplateDebtSchedule(schema: StatementSchema): StatementSchema {
  return regenerateDebtSchedule(schema, periodsPerYearFor('FY'), false);
}

const SECTION_NAME = 'Debt Schedule';

/** True for the auto-generated Debt Schedule section — read-only in the template editor apart
 *  from moving the section itself. */
export function isDebtScheduleSection(section: StatementSection): boolean {
  return section.id === 'debtSchedule:section' || section.lines.some((l) => l.debtScheduleRole !== undefined);
}
/** Fallback ids, used only the very first time a given schedule-level role has never existed in
 *  a schema before (see regenerateDebtSchedule's own doc comment and resolveScheduleLevelId) —
 *  never assumed to be a role's CURRENT id once a schema has been cloned. The three totals are
 *  exported for tests, which build schemas fresh (never cloned) and so can rely on the fallback
 *  always being what's actually assigned. */
const DEFAULT_SECTION_ID = 'debtSchedule:section';
const DEFAULT_MIN_CASH_TARGET_ID = 'debtSchedule:minimumCashTarget';
const DEFAULT_MIN_CASH_TARGET_DRIVER_ID = 'debtSchedule:minimumCashTargetDriver';
const DEFAULT_CASH_AVAILABLE_ID = 'debtSchedule:cashAvailableForRepayment';
const DEFAULT_CASH_SHORTFALL_ID = 'debtSchedule:cashShortfall';
const DEFAULT_REVOLVER_BREACH_ID = 'debtSchedule:revolverBreach';
export const TOTAL_INTEREST_ID = 'debtSchedule:totalInterestExpense';
export const TOTAL_BORROWINGS_ID = 'debtSchedule:totalBorrowings';
export const TOTAL_REPAYMENTS_ID = 'debtSchedule:totalRepayments';

function roleId(trancheLineId: string, role: DebtScheduleRole): string {
  return `debtSchedule:${trancheLineId}:${role}`;
}

function allLines(schema: StatementSchema): StatementLine[] {
  return schema.sections.flatMap((s) => s.lines);
}

/** The current id of the schedule-level (non-tranche) line carrying `role`, wherever it actually
 *  is right now — found by the stable role tag, not assumed from a constant, since cloning a
 *  template re-keys every line including this one (see regenerateDebtSchedule's own doc
 *  comment). Falls back to `fallback` only when this schema has never had one before. */
function resolveScheduleLevelId(schema: StatementSchema, role: DebtScheduleRole, fallback: string): string {
  return allLines(schema).find((l) => l.debtScheduleRole?.role === role && l.debtScheduleRole.trancheLineId === undefined)?.id ?? fallback;
}

/** Every leaf debt tranche with properties set, in seniority order — revolver(s) first (schema
 *  order among themselves), then every other tranche in schema order, the same "schema order is
 *  seniority order" convention already used for cumulative Leverage/LTV. Only a single revolver
 *  actually participates in the draw/breach math (see regenerateDebtSchedule) — a documented
 *  limitation, not built out further. A tranche with `lineKind: 'debt'` but no `debtProperties`
 *  yet (just created, not configured) is excluded — same "the moment it has properties" gate
 *  Capital Structure already uses to show the debt-properties panel. */
function orderedTranches(schema: StatementSchema): StatementLine[] {
  const eligible = allLines(schema).filter(
    (l) => l.debtProperties !== undefined && effectiveLineKind(schema, l) === 'debt' && childrenOf(schema, l.id).length === 0,
  );
  const revolvers = eligible.filter((l) => l.debtProperties?.debtType === 'revolver');
  const term = eligible.filter((l) => l.debtProperties?.debtType !== 'revolver');
  return [...revolvers, ...term];
}

// Ending Balance (per tranche) and the three schedule-level totals all read as subtotals — the
// same bold/underlined treatment every other subtotal line (Gross Profit, EBITDA, Total Debt...)
// already gets, applied automatically here since these lines are generated, not hand-authored
// one at a time.
const TOTAL_ROLES: ReadonlySet<DebtScheduleRole> = new Set([
  'endingBalance', 'totalInterestExpense', 'totalBorrowings', 'totalRepayments',
]);

function blankLine(id: string, name: string, role: { trancheLineId?: string; role: DebtScheduleRole }): StatementLine {
  return {
    id,
    name,
    role: 'calculated',
    rowFormat: TOTAL_ROLES.has(role.role) ? 'total' : 'normal',
    numberFormat: 'number',
    sign: 'natural',
    aggregation: 'sum',
    formula: null,
    projection: null,
    aliases: [],
    debtScheduleRole: role,
  };
}

function updateLine(schema: StatementSchema, lineId: string, patch: Partial<StatementLine>): StatementSchema {
  return {
    ...schema,
    sections: schema.sections.map((s) => ({ ...s, lines: s.lines.map((l) => (l.id === lineId ? { ...l, ...patch } : l)) })),
  };
}

/** Replaces the Debt Schedule section's `lines` array wholesale, in place if it already exists
 *  (so it doesn't jump to the end of the section list on every regenerate), appended at the end
 *  (with `sectionId`, the resolved-or-default id — see regenerateDebtSchedule) the first time
 *  it's created. Always has content by the time this is called — the three totals exist
 *  regardless of tranche count. Existing lookup is by NAME, not `sectionId`: a template clone
 *  keeps section names verbatim while re-keying every id, so name is what survives. */
function withDebtScheduleSection(schema: StatementSchema, sectionId: string, lines: StatementLine[]): StatementSchema {
  const existingIndex = schema.sections.findIndex((s) => s.name === SECTION_NAME);
  if (existingIndex === -1) {
    return { ...schema, sections: [...schema.sections, { id: sectionId, name: SECTION_NAME, lines }] };
  }
  const sections = [...schema.sections];
  sections[existingIndex] = { ...sections[existingIndex], lines };
  return { ...schema, sections };
}
