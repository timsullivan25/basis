import { describe, expect, it } from 'vitest';
import {
  computeDistributableValue,
  computeRecoveryWaterfall,
  effectiveRecoveryInputs,
  orderedSeniorityTiers,
  type SeniorityTier,
} from './recoveryWaterfall';
import type { AnalysisSettings, RecoveryInputs, StatementLine, StatementSchema } from '../data';

function debtLine(id: string, name: string, opts: { parentLineId?: string } = {}): StatementLine {
  return {
    id,
    name,
    role: 'optional',
    rowFormat: 'normal',
    numberFormat: 'number',
    sign: 'absolute',
    aggregation: 'sum',
    formula: null,
    projection: null,
    aliases: [],
    lineKind: 'debt',
    debtProperties: {},
    parentLineId: opts.parentLineId,
  };
}

function tierLine(id: string, name: string): StatementLine {
  return {
    id,
    name,
    role: 'optional',
    rowFormat: 'normal',
    numberFormat: 'number',
    sign: 'absolute',
    aggregation: 'sum',
    formula: null,
    projection: null,
    aliases: [],
    lineKind: 'debt',
    allowsSubLines: true,
  };
}

function schema(lines: StatementLine[]): StatementSchema {
  return {
    id: 's1',
    name: 'Test schema',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    sections: [{ id: 'balance-sheet', name: 'Balance Sheet', lines }],
    drivers: [],
  };
}

describe('orderedSeniorityTiers', () => {
  it('groups tranches under the same parent tier line into one pari passu tier', () => {
    const s = schema([
      tierLine('1l', '1L Debt'),
      debtLine('tla', 'Term Loan A', { parentLineId: '1l' }),
      debtLine('tlb', 'Term Loan B', { parentLineId: '1l' }),
      tierLine('unsecured', 'Unsecured Debt'),
      debtLine('notes', 'Senior Notes', { parentLineId: 'unsecured' }),
    ]);
    const tiers = orderedSeniorityTiers(s);
    expect(tiers).toHaveLength(2);
    expect(tiers[0].tierName).toBe('1L Debt');
    expect(tiers[0].tranches.map((t) => t.id)).toEqual(['tla', 'tlb']);
    expect(tiers[1].tierName).toBe('Unsecured Debt');
    expect(tiers[1].tranches.map((t) => t.id)).toEqual(['notes']);
  });

  it('treats a childless tier line that carries its own debtProperties as a one-tranche tier', () => {
    const s = schema([{ ...tierLine('1l', '1L Debt'), debtProperties: {} }]);
    const tiers = orderedSeniorityTiers(s);
    expect(tiers).toEqual<SeniorityTier[]>([{ tierLineId: '1l', tierName: '1L Debt', tranches: [s.sections[0].lines[0]] }]);
  });

  it('excludes a tier line that has real children (it is a pure rollup, not a leaf)', () => {
    const s = schema([tierLine('1l', '1L Debt'), debtLine('tla', 'Term Loan A', { parentLineId: '1l' })]);
    const tiers = orderedSeniorityTiers(s);
    expect(tiers.flatMap((t) => t.tranches).map((t) => t.id)).toEqual(['tla']);
  });
});

describe('computeDistributableValue', () => {
  it('multiplies EBITDA by the multiple for the ebitdaMultiple method', () => {
    const inputs: RecoveryInputs = { method: 'ebitdaMultiple', multiple: 5, periodIndex: null, directValue: null };
    expect(computeDistributableValue(inputs, { ebitda: 100, revenue: null })).toBe(500);
  });

  it('multiplies Revenue by the multiple for the revenueMultiple method', () => {
    const inputs: RecoveryInputs = { method: 'revenueMultiple', multiple: 2, periodIndex: null, directValue: null };
    expect(computeDistributableValue(inputs, { ebitda: null, revenue: 300 })).toBe(600);
  });

  it('returns directValue as-is for the direct method', () => {
    const inputs: RecoveryInputs = { method: 'direct', multiple: null, periodIndex: null, directValue: 750 };
    expect(computeDistributableValue(inputs, { ebitda: null, revenue: null })).toBe(750);
  });

  it('returns null when the chosen method is missing an input it needs', () => {
    const inputs: RecoveryInputs = { method: 'ebitdaMultiple', multiple: 5, periodIndex: null, directValue: null };
    expect(computeDistributableValue(inputs, { ebitda: null, revenue: null })).toBeNull();
  });

  it('returns null when no method has been chosen yet', () => {
    const inputs: RecoveryInputs = { method: null, multiple: null, periodIndex: null, directValue: null };
    expect(computeDistributableValue(inputs, { ebitda: 100, revenue: 100 })).toBeNull();
  });
});

describe('computeRecoveryWaterfall', () => {
  const tiers: SeniorityTier[] = [
    { tierLineId: '1l', tierName: '1L Debt', tranches: [debtLine('tla', 'Term Loan A'), debtLine('tlb', 'Term Loan B')] },
    { tierLineId: 'unsecured', tierName: 'Unsecured Debt', tranches: [debtLine('notes', 'Senior Notes')] },
  ];
  const balances: Record<string, number | null> = { tla: 600, tlb: 400, notes: 500 };
  const getBalance = (id: string) => balances[id] ?? null;

  it('pays a senior tier in full, pro rata within it, before any junior tier sees a dollar', () => {
    // Distributable = 800: fully covers the 1L tier's 1,000 total? No — 800 < 1,000, so 1L takes
    // all 800 pro rata (60/40 split of the 1,000 balance) and Unsecured gets nothing.
    const result = computeRecoveryWaterfall(tiers, getBalance, 800);
    const byId = Object.fromEntries(result.tranches.map((t) => [t.lineId, t]));
    expect(byId.tla.recoveryAmount).toBeCloseTo(480); // 800 * (600/1000)
    expect(byId.tlb.recoveryAmount).toBeCloseTo(320); // 800 * (400/1000)
    expect(byId.notes.recoveryAmount).toBe(0);
    expect(byId.notes.recoveryPct).toBe(0);
    expect(result.residualToEquity).toBe(0);
  });

  it('fully repays every tier and leaves a residual for equity once value exceeds total debt', () => {
    const result = computeRecoveryWaterfall(tiers, getBalance, 2000);
    const byId = Object.fromEntries(result.tranches.map((t) => [t.lineId, t]));
    expect(byId.tla.recoveryAmount).toBe(600);
    expect(byId.tla.recoveryPct).toBe(1);
    expect(byId.notes.recoveryAmount).toBe(500);
    expect(result.totalDebtBalance).toBe(1500);
    expect(result.residualToEquity).toBe(500);
  });

  it('splits value that lands mid-way through a junior tier pro rata within that tier only', () => {
    // 1L (1,000) fully paid, leaving 200 for Unsecured's 500 balance -> 40% recovery.
    const result = computeRecoveryWaterfall(tiers, getBalance, 1200);
    const byId = Object.fromEntries(result.tranches.map((t) => [t.lineId, t]));
    expect(byId.tla.recoveryAmount).toBe(600);
    expect(byId.notes.recoveryAmount).toBe(200);
    expect(byId.notes.recoveryPct).toBeCloseTo(0.4);
    expect(result.residualToEquity).toBe(0);
  });

  it('propagates a null distributable value to every tranche without fabricating zeros', () => {
    const result = computeRecoveryWaterfall(tiers, getBalance, null);
    expect(result.tranches.every((t) => t.recoveryAmount === null)).toBe(true);
    expect(result.tranches.every((t) => t.balance !== null)).toBe(true);
    expect(result.residualToEquity).toBeNull();
  });

  it('propagates an unresolved balance within a tier without blocking a more senior tier', () => {
    const withMissingBalance = (id: string) => (id === 'notes' ? null : getBalance(id));
    const result = computeRecoveryWaterfall(tiers, withMissingBalance, 1200);
    const byId = Object.fromEntries(result.tranches.map((t) => [t.lineId, t]));
    expect(byId.tla.recoveryAmount).toBe(600); // senior tier still resolves
    expect(byId.notes.recoveryAmount).toBeNull(); // its own tier can't total without this balance
    expect(result.totalDebtBalance).toBeNull();
    expect(result.residualToEquity).toBeNull();
  });
});

describe('effectiveRecoveryInputs', () => {
  function settings(recoveryInputs: AnalysisSettings['recoveryInputs']): AnalysisSettings {
    return {
      id: 'm1',
      modelId: 'm1',
      enabledAnalysisIds: [],
      dcfInputs: { base: { wacc: null, terminalGrowth: null } },
      recoveryInputs,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    };
  }

  it("returns base's inputs directly for the base scenario", () => {
    const base: RecoveryInputs = { method: 'ebitdaMultiple', multiple: 6, periodIndex: null, directValue: null };
    expect(effectiveRecoveryInputs(settings({ base }), 'base')).toEqual(base);
  });

  it("cascades a named scenario's unset fields from base, per field", () => {
    const base: RecoveryInputs = { method: 'ebitdaMultiple', multiple: 6, periodIndex: 2, directValue: null };
    const downside: RecoveryInputs = { method: null, multiple: 4, periodIndex: null, directValue: null };
    const effective = effectiveRecoveryInputs(settings({ base, downside }), 'downside');
    expect(effective).toEqual({ method: 'ebitdaMultiple', multiple: 4, periodIndex: 2, directValue: null });
  });

  it('falls back to an all-null default when recoveryInputs is missing entirely (pre-existing record)', () => {
    const legacy = settings(undefined as unknown as AnalysisSettings['recoveryInputs']);
    expect(effectiveRecoveryInputs(legacy, 'base')).toEqual({ method: null, multiple: null, periodIndex: null, directValue: null });
  });
});
