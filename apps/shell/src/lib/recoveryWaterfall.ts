import type { AnalysisSettings, RecoveryInputs, ScenarioKey, StatementLine, StatementSchema } from '../data';
import { childrenOf, effectiveLineKind } from './statementLineChildren';

const DEFAULT_RECOVERY_INPUTS: RecoveryInputs = { method: null, multiple: null, periodIndex: null, directValue: null };

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

export interface RecoveryWaterfallOutputs {
  distributableValue: number | null;
  totalDebtBalance: number | null;
  /** What's left for equity once every tier is paid — 0 (not null) once every input needed to
   *  reach that answer is actually known; null when one of them (a balance, the distributable
   *  value) is still missing. */
  residualToEquity: number | null;
  tranches: TrancheRecovery[];
}

/**
 * Walks seniority tiers senior-to-junior, paying each tier in full before any junior tier sees a
 * dollar. Within a tier, every tranche shares pro rata by its own balance's share of the tier's
 * total balance — pari passu, per SeniorityTier's own doc comment. A tier with any unresolved
 * (null) tranche balance makes that tier's own recovery null rather than silently treating the
 * missing balance as zero — same "don't fabricate a number" discipline as lib/dcf.ts's
 * all-or-nothing UFCF row — but doesn't block MORE SENIOR tiers, whose own balances may be fully
 * known, from resolving. A null distributableValue propagates the same way: every tranche's
 * recovery is null, but balances themselves still show, so the table isn't empty while the user
 * is still setting up the valuation.
 */
export function computeRecoveryWaterfall(
  tiers: SeniorityTier[],
  getBalance: (lineId: string) => number | null,
  distributableValue: number | null,
): RecoveryWaterfallOutputs {
  const allTranches = tiers.flatMap((t) => t.tranches);
  const balances = new Map(allTranches.map((t) => [t.id, getBalance(t.id)]));
  const totalDebtBalance = allTranches.every((t) => balances.get(t.id) !== null)
    ? allTranches.reduce((sum, t) => sum + (balances.get(t.id) as number), 0)
    : null;

  let remaining = distributableValue;
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

  return {
    distributableValue,
    totalDebtBalance,
    residualToEquity: remaining !== null && totalDebtBalance !== null ? remaining : null,
    tranches,
  };
}
