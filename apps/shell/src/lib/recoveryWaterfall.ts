import type { AnalysisSettings, RecoveryInputs, ScenarioKey, StatementLine, StatementSchema } from '../data';
import { childrenOf, effectiveLineKind } from './statementLineChildren';

const DEFAULT_RECOVERY_INPUTS: RecoveryInputs = { method: null, multiple: null, periodIndex: null, directValue: null, adminCosts: null };

/** A scenario's effective Recovery Waterfall valuation inputs — 'base' is ground truth, a named
 *  scenario's entry is sparse against it (per-field, not whole-record), same convention and same
 *  reason as lib/dcf.ts's effectiveDcfInputs. Guards the whole `recoveryInputs` object, not just
 *  `.base` (unlike effectiveDcfInputs) — this field is newer than dcfInputs, so an existing dev
 *  record can genuinely predate it. */
export function effectiveRecoveryInputs(settings: AnalysisSettings, scenarioId: ScenarioKey): RecoveryInputs {
  const base = settings.recoveryInputs?.base ?? DEFAULT_RECOVERY_INPUTS;
  if (scenarioId === 'base') return base;
  const override = settings.recoveryInputs?.[scenarioId];
  return {
    method: override?.method ?? base.method,
    multiple: override?.multiple ?? base.multiple,
    periodIndex: override?.periodIndex ?? base.periodIndex,
    directValue: override?.directValue ?? base.directValue,
    adminCosts: override?.adminCosts ?? base.adminCosts,
  };
}

/** One seniority class in the capital structure — every tranche in it holds an equal (pari passu)
 *  claim on whatever value is left once every more-senior tier has been paid in full. Grouped by
 *  `parentLineId` (the "1L Debt"/"2L Debt"/"Unsecured Debt"-style tier line a tranche was added
 *  under in Capital Structure) — deliberately NOT lib/debtSchedule.ts's own cash-sweep order.
 *  That order answers a different question (which tranche gets repaid FIRST out of available
 *  cash during ordinary operations — revolver first, so it's available again next period); a
 *  recovery waterfall needs LEGAL seniority instead, where two tranches under the same tier line
 *  share pro rata rather than one exhausting the other first. A tranche with no parent (the tier
 *  line itself carries debtProperties directly, because no sub-line has been added under it yet)
 *  is its own one-tranche tier. */
export interface SeniorityTier {
  /** The tier line's own id — either the parent tier line, or the lone tranche's own id when it
   *  has no parent. */
  tierLineId: string;
  tierName: string;
  tranches: StatementLine[];
}

/** Every leaf debt tranche (see StatementLine.debtProperties' own doc comment for what "leaf"
 *  means here), grouped into seniority tiers in schema order — the same "schema order is
 *  seniority order" convention lib/debtSchedule.ts's own orderedTranches uses for cumulative
 *  Leverage/LTV, just applied to TIERS (parent lines) instead of individual tranches, and without
 *  that function's revolver-first carve-out (a cash-sweep concern, not a legal-seniority one). */
export function orderedSeniorityTiers(schema: StatementSchema): SeniorityTier[] {
  const allLines = schema.sections.flatMap((s) => s.lines);
  const tranches = allLines.filter(
    (l) => l.debtProperties !== undefined && effectiveLineKind(schema, l) === 'debt' && childrenOf(schema, l.id).length === 0,
  );

  const tiers: SeniorityTier[] = [];
  const tierByLineId = new Map<string, SeniorityTier>();
  for (const tranche of tranches) {
    const tierLineId = tranche.parentLineId ?? tranche.id;
    let tier = tierByLineId.get(tierLineId);
    if (!tier) {
      const tierLine = tranche.parentLineId ? allLines.find((l) => l.id === tierLineId) : tranche;
      tier = { tierLineId, tierName: tierLine?.name ?? tranche.name, tranches: [] };
      tierByLineId.set(tierLineId, tier);
      tiers.push(tier);
    }
    tier.tranches.push(tranche);
  }
  return tiers;
}

/** The resolved EBITDA/Revenue values a multiple-based method needs — the caller resolves which
 *  line and which period (see RecoveryInputs.periodIndex's own doc comment); this function only
 *  ever multiplies. */
export interface DistributableValueConcepts {
  ebitda: number | null;
  revenue: number | null;
}

/** The value the waterfall distributes, per the chosen manual method — never a computed
 *  valuation (see RecoveryInputs' own doc comment for why DCF/LBO/Comps aren't wired in here
 *  yet). Null whenever the chosen method's own inputs aren't fully set, same null-propagation
 *  discipline as lib/dcf.ts's computeDcfOutputs. */
export function computeDistributableValue(inputs: RecoveryInputs, concepts: DistributableValueConcepts): number | null {
  switch (inputs.method) {
    case 'ebitdaMultiple':
      return inputs.multiple !== null && concepts.ebitda !== null ? inputs.multiple * concepts.ebitda : null;
    case 'revenueMultiple':
      return inputs.multiple !== null && concepts.revenue !== null ? inputs.multiple * concepts.revenue : null;
    case 'direct':
      return inputs.directValue;
    case null:
      return null;
  }
}

export interface TrancheRecovery {
  lineId: string;
  name: string;
  tierName: string;
  balance: number | null;
  recoveryAmount: number | null;
  recoveryPct: number | null;
}

const ADMIN_COSTS_LINE_ID = '__adminCosts__';

export interface RecoveryWaterfallOutputs {
  distributableValue: number | null;
  /** Administrative & priority claims — DIP financing, professional fees, wind-down costs — paid
   *  BEFORE any secured tranche sees a dollar, per the standard priority sequence (DIP →
   *  administrative → secured → unsecured → equity). Modeled as an ordinary TrancheRecovery
   *  (a real "claim" that can itself go under-recovered if distributableValue doesn't even cover
   *  it) rather than a special case like the Equity row below — unlike equity, admin costs DO
   *  have a defined claim amount and a meaningful recovery rate. `null` claim/recovery-pct when
   *  no admin cost has been entered (treated as $0, not "unknown" — this input is optional). */
  adminCosts: TrancheRecovery;
  totalDebtBalance: number | null;
  /** What's left for equity once admin costs and every tier are paid — 0 (not null) once every
   *  input needed to reach that answer is actually known; null when one of them (a balance, the
   *  distributable value) is still missing. */
  residualToEquity: number | null;
  tranches: TrancheRecovery[];
  /** The fulcrum security — the most senior claim (admin costs counts, since it's senior to
   *  everything) that does NOT recover in full. This is where restructuring negotiating leverage
   *  concentrates: everything above it is unimpaired and has nothing to negotiate over; everything
   *  below it recovers nothing regardless of how the fulcrum's own recovery is negotiated, so it
   *  has no leverage either. `null` when every claim recovers in full (not a distressed capital
   *  structure at this valuation — nothing to flag) OR when an earlier claim's own recovery isn't
   *  yet resolvable (same "don't fabricate" discipline as the rest of this function — a claim
   *  with no real balance, e.g. admin costs left unset, is skipped rather than treated as unknown). */
  fulcrumLineId: string | null;
}

/** `balance === 0` is a real, resolved claim (e.g. a tranche already paid off) — trivially
 *  satisfied, skip to the next claim. `balance === null` is genuinely unresolved (unmapped, or the
 *  model hasn't evaluated this period) — unlike 0, this must BAIL rather than skip: a claim after
 *  an unknown one could be the true fulcrum and we'd have no way to tell. The caller is
 *  responsible for leaving admin costs OUT of this list entirely when it isn't configured (its own
 *  `balance: null` means "no claim configured," a different meaning than a tranche's `null`, so it
 *  can't share this function's null-handling). */
function findFulcrum(claimsInPriorityOrder: TrancheRecovery[]): string | null {
  for (const claim of claimsInPriorityOrder) {
    if (claim.balance === 0) continue;
    if (claim.balance === null || claim.recoveryPct === null) return null;
    if (claim.recoveryPct < 1) return claim.lineId;
  }
  return null;
}

/**
 * Walks admin/priority costs first, then seniority tiers senior-to-junior, paying each in full
 * before anything junior sees a dollar. Within a tier, every tranche shares pro rata by its own
 * balance's share of the tier's total balance — pari passu, per SeniorityTier's own doc comment.
 * A tier with any unresolved (null) tranche balance makes that tier's own recovery null rather
 * than silently treating the missing balance as zero — same "don't fabricate a number" discipline
 * as lib/dcf.ts's all-or-nothing UFCF row — but doesn't block MORE SENIOR claims, whose own
 * balances may be fully known, from resolving. A null distributableValue propagates the same way:
 * every claim's recovery is null, but balances themselves still show, so the table isn't empty
 * while the user is still setting up the valuation.
 */
export function computeRecoveryWaterfall(
  tiers: SeniorityTier[],
  getBalance: (lineId: string) => number | null,
  distributableValue: number | null,
  adminCosts: number | null,
): RecoveryWaterfallOutputs {
  const adminClaim = adminCosts ?? 0;
  const adminRecovery = distributableValue !== null ? Math.min(distributableValue, adminClaim) : null;
  const adminRecoveryPct = adminRecovery !== null && adminClaim > 0 ? adminRecovery / adminClaim : null;
  let remaining = distributableValue !== null && adminRecovery !== null ? distributableValue - adminRecovery : null;

  const allTranches = tiers.flatMap((t) => t.tranches);
  const balances = new Map(allTranches.map((t) => [t.id, getBalance(t.id)]));
  const totalDebtBalance = allTranches.every((t) => balances.get(t.id) !== null)
    ? allTranches.reduce((sum, t) => sum + (balances.get(t.id) as number), 0)
    : null;

  const tranches: TrancheRecovery[] = [];
  for (const tier of tiers) {
    const tierBalances = tier.tranches.map((t) => balances.get(t.id) ?? null);
    const tierTotal = tierBalances.every((b) => b !== null) ? (tierBalances as number[]).reduce((a, b) => a + b, 0) : null;
    const tierRecovery = remaining !== null && tierTotal !== null ? Math.min(remaining, tierTotal) : null;
    if (remaining !== null && tierRecovery !== null) remaining -= tierRecovery;

    for (const tranche of tier.tranches) {
      const balance = balances.get(tranche.id) ?? null;
      const recoveryAmount =
        tierRecovery !== null && tierTotal !== null && balance !== null
          ? tierTotal === 0
            ? 0
            : tierRecovery * (balance / tierTotal)
          : null;
      const recoveryPct = recoveryAmount !== null && balance !== null && balance !== 0 ? recoveryAmount / balance : null;
      tranches.push({ lineId: tranche.id, name: tranche.name, tierName: tier.tierName, balance, recoveryAmount, recoveryPct });
    }
  }

  const adminCostsRecovery: TrancheRecovery = {
    lineId: ADMIN_COSTS_LINE_ID,
    name: 'Administrative & Priority Claims',
    tierName: 'Priority',
    balance: adminClaim > 0 ? adminClaim : null,
    recoveryAmount: adminRecovery,
    recoveryPct: adminRecoveryPct,
  };

  return {
    distributableValue,
    adminCosts: adminCostsRecovery,
    totalDebtBalance,
    residualToEquity: remaining !== null && totalDebtBalance !== null ? remaining : null,
    tranches,
    fulcrumLineId: findFulcrum(adminClaim > 0 ? [adminCostsRecovery, ...tranches] : tranches),
  };
}

/** How far the sweep steps the value that actually drives distributableValue — the multiple
 *  itself for a multiple-based method (in whole turns, same shape as lib/dcf.ts's
 *  WACC_STEPS_PCT), or the direct dollar value by percentage for direct entry, since "step the
 *  multiple" has no meaning there. Both produce 5 points: low/low-mid/base/high-mid/high. */
const MULTIPLE_STEPS = [-1, -0.5, 0, 0.5, 1];
const DIRECT_VALUE_STEPS_PCT = [-0.2, -0.1, 0, 0.1, 0.2];

export interface RecoverySensitivityPoint {
  /** The stepped multiple or direct value this point ran with — the sweep's own x-axis label. */
  driverValue: number;
  waterfall: RecoveryWaterfallOutputs;
}

/**
 * Re-runs the full waterfall (admin costs included) at each step of the driving multiple/direct
 * value, holding everything else — tiers, balances, admin costs — fixed. `null` whenever the
 * method isn't set or its own driver value isn't (mirrors computeDistributableValue's own
 * null-propagation): a sensitivity sweep around an undefined center means nothing.
 */
export function computeRecoverySensitivity(
  inputs: RecoveryInputs,
  concepts: DistributableValueConcepts,
  tiers: SeniorityTier[],
  getBalance: (lineId: string) => number | null,
): RecoverySensitivityPoint[] | null {
  if (inputs.method === null) return null;
  const baseDriver = inputs.method === 'direct' ? inputs.directValue : inputs.multiple;
  if (baseDriver === null) return null;

  // A multiple can't sensibly go negative (an EBITDA/revenue multiple below 0x is meaningless) —
  // clamped at 0 rather than letting a small base multiple's low-end step cross zero.
  const driverValues =
    inputs.method === 'direct'
      ? DIRECT_VALUE_STEPS_PCT.map((pct) => baseDriver * (1 + pct))
      : MULTIPLE_STEPS.map((delta) => Math.max(0, baseDriver + delta));

  return driverValues.map((driverValue) => {
    const steppedInputs: RecoveryInputs = inputs.method === 'direct' ? { ...inputs, directValue: driverValue } : { ...inputs, multiple: driverValue };
    const distributableValue = computeDistributableValue(steppedInputs, concepts);
    const waterfall = computeRecoveryWaterfall(tiers, getBalance, distributableValue, inputs.adminCosts);
    return { driverValue, waterfall };
  });
}
