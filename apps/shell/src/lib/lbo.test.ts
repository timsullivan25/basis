import { describe, expect, it } from 'vitest';
import { applyLboFinancingPatch, buildLboEvaluationInputs, computeAbilityToPay, computeEntryLtmEbitda, computeLboOutput, effectiveLboFinancing, lastTwelveMonths, seedLboCase, type SeedLboCaseParams } from './lbo';
import { createLboStatementSchema } from './lboStatementSchema';
import { findSummaryLine } from './summaryLines';
import { evaluateModel } from './engine/evaluate';
import { addChildLine, removeChildLine } from './statementLineChildren';
import { regenerateDebtSchedule } from './debtSchedule';
import type { LboCase, LboFinancingByScenario, LboFinancingInputs, StatementLine, StatementSchema, Timeline } from '../data';
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

function allLines(schema: StatementSchema): StatementLine[] {
  return schema.sections.flatMap((s) => s.lines);
}

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
    const ebit = allLines(schema).find((l) => l.name === 'EBIT')!;
    expect(ebit.formula).toEqual({ kind: 'bin', op: '-', left: { kind: 'ref', lineId: lineIds.ebitda }, right: { kind: 'ref', lineId: lineIds.da } });
  });

  it('starts with zero tranches — Total Debt has no formula yet', () => {
    const { schema, lineIds } = createLboStatementSchema(1);
    const totalDebt = allLines(schema).find((l) => l.id === lineIds.totalDebt)!;
    expect(totalDebt.formula).toBeNull();
  });
});

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

describe('seedLboCase', () => {
  it('stores only structure — entry period, horizon, tranche schema, timeline shape, a base financing entry', () => {
    const result = seed();
    expect(result.entryPeriodIndex).toBe(1);
    expect(result.horizonYears).toBe(3);
    expect(result.timeline).toHaveLength(4);
    expect(Object.keys(result.financing)).toEqual(['base']);
  });

  it('sizes the starting leverage multiple off the company\'s own current Net Debt / EBITDA, and adds a Term Loan + Revolver', () => {
    const result = seed();
    expect(result.financing.base.leverageMultiple).toBeCloseTo(800 / 440);
    const names = allLines(result.schema).filter((l) => l.parentLineId).map((l) => l.name);
    expect(names).toEqual(['Revolver', 'Term Loan']);
    // No originalFaceValue stored for the Term Loan — it's leverage-linked, derived live instead.
    const termLoan = allLines(result.schema).find((l) => l.name === 'Term Loan')!;
    expect(termLoan.debtProperties?.originalFaceValue).toBeUndefined();
  });

  it('extends the timeline horizonYears beyond the single entry period, all marked projected', () => {
    const result = seed({ horizonYears: 4 });
    expect(result.timeline).toHaveLength(5);
    expect(result.timeline[0].kind).toBe('actual');
    expect(result.timeline.slice(1).every((p) => p.kind === 'projected')).toBe(true);
  });

  it('clamps the Revolver commitment to zero rather than going negative off a negative entry EBITDA', () => {
    const schema = baseSchema();
    const evaluation = lineValues({
      rev: [1000, 1100], ebitda: [-50, -40], da: [50, 55], capex: [40, 44], nwc: [100, 110],
      taxRate: [0.25, 0.25], ebit: [-100, -95], netDebt: [800, 800],
    });
    const result = seedLboCase({
      modelId: 'model-1', baseSchema: schema, baseTimeline: BASE_TIMELINE, baseEvaluation: evaluation,
      entryPeriodIndex: 1, horizonYears: 3,
    });
    const revolver = allLines(result.schema).find((l) => l.name === 'Revolver')!;
    expect(revolver.debtProperties?.commitmentAmount).toBe(0);
  });

  it('marks the Term Loan as the leverage-linked tranche', () => {
    const result = seed();
    const termLoan = allLines(result.schema).find((l) => l.name === 'Term Loan')!;
    expect(result.leverageLinkedTrancheId).toBe(termLoan.id);
  });
});

describe('buildLboEvaluationInputs + evaluateModel (end to end)', () => {
  function buildCase(
    overrides: Partial<SeedLboCaseParams> = {},
  ): { lboCase: Pick<LboCase, 'schema' | 'timeline' | 'entryPeriodIndex' | 'financing' | 'leverageLinkedTrancheId'>; baseSchema: StatementSchema; baseEvaluation: LineValues } {
    const schema = baseSchema();
    const evaluation = lineValues({
      rev: [1000, 1100], ebitda: [400, 440], da: [50, 55], capex: [40, 44], nwc: [100, 110],
      taxRate: [0.25, 0.25], ebit: [350, 385], netDebt: [800, 800],
    });
    const created = seedLboCase({
      modelId: 'model-1', baseSchema: schema, baseTimeline: BASE_TIMELINE, baseEvaluation: evaluation,
      entryPeriodIndex: 1, horizonYears: 3, ...overrides,
    });
    return { lboCase: created, baseSchema: schema, baseEvaluation: evaluation };
  }

  it('resolves entry-period historicals live from the base evaluation for the active scenario', () => {
    const { lboCase, baseSchema: bs, baseEvaluation } = buildCase();
    const built = buildLboEvaluationInputs(lboCase, 'base', bs, baseEvaluation, BASE_TIMELINE);
    const revenueId = findSummaryLine(built.schema, 'revenue')!.id;
    expect(built.historicals[revenueId][0]).toBe(1100);
  });

  it('re-derives the leverage-linked Term Loan face value against a DIFFERENT scenario\'s own live EBITDA — no stored copy to go stale', () => {
    const { lboCase, baseSchema: bs } = buildCase();
    const upsideEvaluation = lineValues({
      rev: [1000, 1300], ebitda: [400, 600], da: [50, 55], capex: [40, 44], nwc: [100, 110],
      taxRate: [0.25, 0.25], ebit: [350, 545], netDebt: [800, 800],
    });
    const builtBase = buildLboEvaluationInputs(lboCase, 'base', bs, lineValues({
      rev: [1000, 1100], ebitda: [400, 440], da: [50, 55], capex: [40, 44], nwc: [100, 110],
      taxRate: [0.25, 0.25], ebit: [350, 385], netDebt: [800, 800],
    }), BASE_TIMELINE);
    const builtUpside = buildLboEvaluationInputs(lboCase, 'upside', bs, upsideEvaluation, BASE_TIMELINE);

    const termLoanId = allLines(lboCase.schema).find((l) => l.name === 'Term Loan')!.id;
    // Same leverage multiple (no scenario override), but the face value tracks each scenario's
    // OWN live EBITDA: 800/440 * 440 = 800 under base, 800/440 * 600 under upside.
    expect(builtBase.historicals[termLoanId][0]).toBeCloseTo((800 / 440) * 440);
    expect(builtUpside.historicals[termLoanId][0]).toBeCloseTo((800 / 440) * 600);
  });

  it('evaluates end to end: Revenue grows at the implied entry-period rate, and positive FCF sweeps the Term Loan down over time', () => {
    const { lboCase, baseSchema: bs, baseEvaluation } = buildCase();
    const built = buildLboEvaluationInputs(lboCase, 'base', bs, baseEvaluation, BASE_TIMELINE);
    const evaluation = evaluateModel(built.schema, { timeline: built.timeline, historicals: built.historicals, driverValues: built.driverValues });
    const revenueId = findSummaryLine(built.schema, 'revenue')!.id;
    const totalDebtId = findSummaryLine(built.schema, 'totalDebt')!.id;

    // implied growth = 1100/1000 - 1 = 10%
    expect(evaluation.getValue(revenueId, 0)).toBe(1100);
    expect(evaluation.getValue(revenueId, 1)).toBeCloseTo(1210);
    expect(evaluation.getValue(revenueId, 2)).toBeCloseTo(1331);

    const entryDebt = evaluation.getValue(totalDebtId, 0)!;
    const laterDebt = evaluation.getValue(totalDebtId, 3)!;
    expect(laterDebt).toBeLessThan(entryDebt);
  });

  it('a manually-added tranche keeps its own stored face value — never overridden live', () => {
    const { lboCase: created, baseSchema: bs, baseEvaluation } = buildCase();
    const totalDebtId = findSummaryLine(created.schema, 'totalDebt')!.id;
    const withExtra: StatementLine = {
      id: 'sub-notes', name: 'Subordinated Notes', role: 'optional', rowFormat: 'normal', numberFormat: 'number',
      sign: 'absolute', aggregation: 'sum', formula: null, projection: null, aliases: [], parentLineId: totalDebtId,
      debtProperties: { debtType: 'term', couponType: 'fixed', couponRate: 0.11, originalFaceValue: 150, repayable: true },
    };
    const schemaWithExtra: StatementSchema = {
      ...created.schema,
      sections: created.schema.sections.map((s) => (s.lines.some((l) => l.id === totalDebtId) ? { ...s, lines: [...s.lines, withExtra] } : s)),
    };
    const lboCase = { ...created, schema: schemaWithExtra };
    const built = buildLboEvaluationInputs(lboCase, 'base', bs, baseEvaluation, BASE_TIMELINE);
    expect(built.historicals['sub-notes'][0]).toBe(150);
  });

  it('identifies the leverage-linked tranche by its stable id, not by "first non-revolver tranche" position', () => {
    const { lboCase: created, baseSchema: bs, baseEvaluation } = buildCase();
    const totalDebtId = findSummaryLine(created.schema, 'totalDebt')!.id;
    const termLoanId = allLines(created.schema).find((l) => l.name === 'Term Loan')!.id;
    expect(created.leverageLinkedTrancheId).toBe(termLoanId);

    // A second, manually-added TERM tranche inserted BEFORE the leverage-linked Term Loan in
    // section order. If buildLboEvaluationInputs ever fell back to positional inference ("first
    // non-revolver tranche"), it would patch THIS tranche's face value live instead, losing the
    // user's own stored originalFaceValue for it.
    const extraTermTranche: StatementLine = {
      id: 'extra-term', name: 'Second Lien', role: 'optional', rowFormat: 'normal', numberFormat: 'number',
      sign: 'absolute', aggregation: 'sum', formula: null, projection: null, aliases: [], parentLineId: totalDebtId,
      debtProperties: { debtType: 'term', couponType: 'fixed', couponRate: 0.12, originalFaceValue: 200, repayable: true },
    };
    const schemaWithExtra: StatementSchema = {
      ...created.schema,
      sections: created.schema.sections.map((s) => (s.lines.some((l) => l.id === totalDebtId) ? { ...s, lines: [extraTermTranche, ...s.lines] } : s)),
    };
    const lboCase = { ...created, schema: schemaWithExtra };
    const built = buildLboEvaluationInputs(lboCase, 'base', bs, baseEvaluation, BASE_TIMELINE);
    expect(built.historicals['extra-term'][0]).toBe(200);
    expect(built.historicals[termLoanId][0]).toBeCloseTo((800 / 440) * 440);
  });
});

describe('effectiveLboFinancing', () => {
  const financing: LboFinancingByScenario = {
    base: { leverageMultiple: 4, targetIrrs: [0.15, 0.2], exitMultiple: 9, exitPeriodIndex: null, transactionExpensesPct: 0.02 },
    downside: { leverageMultiple: 3 },
  };

  it('base is ground truth', () => {
    expect(effectiveLboFinancing(financing, 'base')).toEqual(financing.base);
  });

  it('a named scenario overrides only its own set fields, cascading the rest from base', () => {
    const effective = effectiveLboFinancing(financing, 'downside');
    expect(effective.leverageMultiple).toBe(3);
    expect(effective.transactionExpensesPct).toBe(0.02);
    expect(effective.exitMultiple).toBe(9);
  });

  it('an explicit null override wins over a non-null base value ("No expansion", no transaction expenses)', () => {
    const effective = effectiveLboFinancing({ ...financing, downside: { exitMultiple: null, transactionExpensesPct: null } }, 'downside');
    expect(effective.exitMultiple).toBeNull();
    expect(effective.transactionExpensesPct).toBeNull();
    expect(effective.leverageMultiple).toBe(4);
  });

  it('a scenario with no entry at all cascades fully from base', () => {
    expect(effectiveLboFinancing(financing, 'unmodeled')).toEqual(financing.base);
  });
});

describe('computeAbilityToPay', () => {
  const timeline: Timeline = Array.from({ length: 6 }, (_, i) => ({
    id: `p${i}`, type: 'FY' as const, endDate: `${2024 + i}-12-31`, label: `FY${24 + i}`,
    kind: i === 0 ? ('actual' as const) : ('projected' as const),
  }));
  const financing: LboFinancingInputs = { leverageMultiple: 4, targetIrrs: [0.2], exitMultiple: null, exitPeriodIndex: null, transactionExpensesPct: null };

  const evaluation = lineValues({
    ebitda: [100, null, null, null, null, 150],
    totalDebt: [400, null, null, null, null, 50],
    cash: [0, null, null, null, null, 10],
  });
  const lineIds = { ebitda: 'ebitda', totalDebt: 'totalDebt', cash: 'cash' };

  it('MOIC always equals (1 + target IRR) ^ holding years — the solve is self-consistent by construction', () => {
    for (const exitMultiple of [null, 8, 10]) {
      const rows = computeAbilityToPay({ ...financing, exitMultiple }, timeline, evaluation, lineIds);
      expect(rows[0].moic).toBeCloseTo(Math.pow(1.2, 5), 6);
    }
  });

  it('matches a hand-computed entry multiple for an explicit (non-expanding-assumption) exit multiple', () => {
    const rows = computeAbilityToPay({ ...financing, exitMultiple: 8 }, timeline, evaluation, lineIds);
    const expectedEntryTev = 1160 / Math.pow(1.2, 5) + 400;
    expect(rows[0].impliedEntryEnterpriseValue).toBeCloseTo(expectedEntryTev, 6);
    expect(rows[0].impliedEntryMultiple).toBeCloseTo(expectedEntryTev / 100, 6);
  });

  it('propagates null, never a fabricated number, when the exit period has no resolved data', () => {
    const sparse = lineValues({ ebitda: [100], totalDebt: [400], cash: [0] });
    const rows = computeAbilityToPay(financing, timeline, sparse, lineIds);
    expect(rows[0].impliedEntryMultiple).toBeNull();
    expect(rows[0].moic).toBeNull();
  });

  it('one row per target IRR, in the order given', () => {
    const rows = computeAbilityToPay({ ...financing, targetIrrs: [0.15, 0.2, 0.25] }, timeline, evaluation, lineIds);
    expect(rows.map((r) => r.targetIrr)).toEqual([0.15, 0.2, 0.25]);
    expect(rows[0].impliedEntryMultiple!).toBeGreaterThan(rows[1].impliedEntryMultiple!);
    expect(rows[1].impliedEntryMultiple!).toBeGreaterThan(rows[2].impliedEntryMultiple!);
  });
});

describe('computeLboOutput', () => {
  it('matches what buildLboEvaluationInputs + computeAbilityToPay would produce separately — one implementation, not two that could drift', () => {
    const result = seed();
    const output = computeLboOutput(result, 'base', baseSchema(), lineValues({
      rev: [1000, 1100], ebitda: [400, 440], da: [50, 55], capex: [40, 44], nwc: [100, 110],
      taxRate: [0.25, 0.25], ebit: [350, 385], netDebt: [800, 800],
    }), BASE_TIMELINE);

    expect(output.projection).toHaveLength(result.timeline.length);
    expect(output.projection[0].revenue).toBe(1100);
    expect(output.projection[0].ebitda).toBe(440);
    expect(output.abilityToPay).toHaveLength(result.financing.base.targetIrrs.length);
    // Same self-consistency invariant as computeAbilityToPay's own tests: MOIC = (1+IRR)^n.
    const periodsPerYear = 1;
    const holdingYears = (result.timeline.length - 1) / periodsPerYear;
    expect(output.abilityToPay[1].moic).toBeCloseTo(Math.pow(1.2, holdingYears), 6);
  });

  it('reflects a scenario override in both the projection and the ability-to-pay grid', () => {
    const result = seed();
    const base = computeLboOutput(result, 'base', baseSchema(), lineValues({
      rev: [1000, 1100], ebitda: [400, 440], da: [50, 55], capex: [40, 44], nwc: [100, 110],
      taxRate: [0.25, 0.25], ebit: [350, 385], netDebt: [800, 800],
    }), BASE_TIMELINE);
    const withOverride: typeof result = { ...result, financing: { ...result.financing, upside: { ...result.financing.base, leverageMultiple: 6 } } };
    const upside = computeLboOutput(withOverride, 'upside', baseSchema(), lineValues({
      rev: [1000, 1100], ebitda: [400, 440], da: [50, 55], capex: [40, 44], nwc: [100, 110],
      taxRate: [0.25, 0.25], ebit: [350, 385], netDebt: [800, 800],
    }), BASE_TIMELINE);

    expect(upside.projection[0].totalDebt).toBeGreaterThan(base.projection[0].totalDebt!);
  });
});

describe('applyLboFinancingPatch', () => {
  const financing: LboFinancingByScenario = {
    base: { leverageMultiple: 4, targetIrrs: [0.2], exitMultiple: null, exitPeriodIndex: null, transactionExpensesPct: 0.02 },
  };

  it('stores only the edited field on a named scenario, so later Base edits still reach it', () => {
    const edited = applyLboFinancingPatch(financing, 'upside', { leverageMultiple: 5 });
    expect(edited.upside).toEqual({ leverageMultiple: 5 });
    const baseEdited = applyLboFinancingPatch(edited, 'base', { transactionExpensesPct: 0.03 });
    expect(effectiveLboFinancing(baseEdited, 'upside')).toMatchObject({ leverageMultiple: 5, transactionExpensesPct: 0.03 });
  });

  it('merges successive edits rather than replacing the scenario entry', () => {
    const once = applyLboFinancingPatch(financing, 'upside', { leverageMultiple: 5 });
    const twice = applyLboFinancingPatch(once, 'upside', { exitMultiple: 8 });
    expect(twice.upside).toEqual({ leverageMultiple: 5, exitMultiple: 8 });
  });
});

describe('LTM EBITDA', () => {
  const quarters: Timeline = Array.from({ length: 5 }, (_, i) => ({
    id: `q${i}`, type: 'Quarter' as const, endDate: `2024-0${i + 1}-28`, label: `Q${i + 1}`, kind: 'actual' as const,
  }));

  it('sums the last four quarters on a quarterly model', () => {
    const evaluation = lineValues({ ebitda: [10, 20, 30, 40, 50] });
    expect(computeEntryLtmEbitda(baseSchema(), evaluation, quarters, 4)).toBe(20 + 30 + 40 + 50);
  });

  it('is just the period itself on an annual model', () => {
    expect(computeEntryLtmEbitda(baseSchema(), lineValues({ ebitda: [400, 440] }), BASE_TIMELINE, 1)).toBe(440);
  });

  it('annualizes a short run of quarters rather than going null', () => {
    expect(lastTwelveMonths([{ value: 10, type: 'Quarter' }, { value: 30, type: 'Quarter' }])).toBe(80);
  });

  it('stops at a change of period type', () => {
    expect(lastTwelveMonths([{ value: 400, type: 'FY' }, { value: 30, type: 'Quarter' }])).toBe(120);
  });

  it('sizes leverage and the ability-to-pay grid off LTM on a quarterly model', () => {
    const evaluation = lineValues({
      rev: [250, 250, 250, 250, 250], ebitda: [100, 100, 100, 100, 100], da: [10, 10, 10, 10, 10], capex: [10, 10, 10, 10, 10],
      nwc: [50, 50, 50, 50, 50], taxRate: [0.25, 0.25, 0.25, 0.25, 0.25], ebit: [90, 90, 90, 90, 90], netDebt: [800, 800, 800, 800, 800],
    });
    const result = seedLboCase({ modelId: 'm', baseSchema: baseSchema(), baseTimeline: quarters, baseEvaluation: evaluation, entryPeriodIndex: 4, horizonYears: 2 });
    // 800 of net debt against 400 of LTM EBITDA is 2x, not 8x.
    expect(result.financing.base.leverageMultiple).toBeCloseTo(2);
    const output = computeLboOutput(result, 'base', baseSchema(), evaluation, quarters);
    expect(output.projection[0].totalDebt).toBeCloseTo(800);
    // MOIC still equals (1+IRR)^years with years = 8 quarters / 4.
    expect(output.abilityToPay[1].moic).toBeCloseTo(Math.pow(1.2, 2), 6);
  });
});

describe('debt raised at close', () => {
  const evaluation = lineValues({
    rev: [1000, 1100], ebitda: [400, 440], da: [50, 55], capex: [40, 44], nwc: [100, 110],
    taxRate: [0.25, 0.25], ebit: [350, 385], netDebt: [800, 800],
  });

  it('counts every tranche at close, so a user-added tranche raises entry EV by its face value', () => {
    const result = seed();
    const before = computeLboOutput(result, 'base', baseSchema(), evaluation, BASE_TIMELINE);
    const totalDebt = findSummaryLine(result.schema, 'totalDebt')!;
    const { schema: withLine, lineId } = addChildLine(result.schema, { kind: 'line', parentLineId: totalDebt.id }, 'Notes');
    const schema: StatementSchema = {
      ...withLine,
      sections: withLine.sections.map((s) => ({
        ...s,
        lines: s.lines.map((l) => (l.id === lineId ? { ...l, debtProperties: { debtType: 'term', couponType: 'fixed', couponRate: 0, amortizationRate: 0, repayable: false, originalFaceValue: 100 } } : l)),
      })),
    };
    const after = computeLboOutput({ ...result, schema: regenerateDebtSchedule(schema, 1, false) }, 'base', baseSchema(), evaluation, BASE_TIMELINE);
    expect(after.projection[0].totalDebt).toBeCloseTo(before.projection[0].totalDebt! + 100);
    expect(after.abilityToPay[0].sponsorEquityCheck).not.toBeNull();
  });

  it('with the leverage-linked tranche deleted, leverage funds nothing at close', () => {
    const result = seed();
    const withoutTermLoan = { ...result, schema: regenerateDebtSchedule(removeChildLine(result.schema, result.leverageLinkedTrancheId!), 1, false), leverageLinkedTrancheId: null };
    const output = computeLboOutput(withoutTermLoan, 'base', baseSchema(), evaluation, BASE_TIMELINE);
    expect(output.projection[0].totalDebt).toBe(0);
  });
});
