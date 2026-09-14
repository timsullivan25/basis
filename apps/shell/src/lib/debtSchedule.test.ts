import { describe, expect, it } from 'vitest';
import { periodsPerYearFor, regenerateDebtSchedule, TOTAL_BORROWINGS_ID, TOTAL_INTEREST_ID, TOTAL_REPAYMENTS_ID } from './debtSchedule';
import { evaluateModel } from './engine/evaluate';
import type { DebtScheduleRole, DebtTrancheProperties, StatementLine, StatementSchema, Timeline } from '../data';

function line(id: string, name: string, opts: Partial<StatementLine> = {}): StatementLine {
  return {
    id,
    name,
    required: false,
    rowFormat: 'normal',
    numberFormat: 'number',
    sign: 'natural',
    aggregation: 'sum',
    formula: null,
    projection: null,
    aliases: [],
    ...opts,
  };
}

function schemaWith(lines: StatementLine[]): StatementSchema {
  return { id: 's1', name: 'Test', createdAt: '', updatedAt: '', sections: [{ id: 'sec', name: 'Balance Sheet', lines }], drivers: [] };
}

function findByRole(schema: StatementSchema, role: DebtScheduleRole, trancheLineId?: string): StatementLine | undefined {
  return schema.sections
    .flatMap((s) => s.lines)
    .find((l) => l.debtScheduleRole?.role === role && (trancheLineId === undefined || l.debtScheduleRole?.trancheLineId === trancheLineId));
}

const TIMELINE: Timeline = [
  { id: 'p0', type: 'FY', endDate: '2024-12-31', label: 'FY24', kind: 'actual' },
  { id: 'p1', type: 'FY', endDate: '2025-12-31', label: 'FY25', kind: 'projected' },
];

describe('periodsPerYearFor', () => {
  it('maps each period type to its annual count', () => {
    expect(periodsPerYearFor('FY')).toBe(1);
    expect(periodsPerYearFor('Semi-Annual')).toBe(2);
    expect(periodsPerYearFor('Quarter')).toBe(4);
  });
});

describe('regenerateDebtSchedule — reconciliation', () => {
  function trancheSchema(): StatementSchema {
    return schemaWith([
      line('cash', 'Cash & Equivalents', {}),
      line('fcf', 'Free Cash Flow', {}),
      line('termA', 'Term Loan A', { lineKind: 'debt', debtProperties: { debtType: 'term', couponRate: 0.06 } }),
    ]);
  }

  it('a childless debt line with no debtProperties yet is not scheduled — only the three always-present totals exist', () => {
    const schema = schemaWith([line('termA', 'Term Loan A', { lineKind: 'debt' })]);
    const next = regenerateDebtSchedule(schema, 1, false);
    const dsLines = next.sections.find((s) => s.name === 'Debt Schedule')!.lines;
    expect(dsLines.map((l) => l.id).sort()).toEqual([TOTAL_BORROWINGS_ID, TOTAL_INTEREST_ID, TOTAL_REPAYMENTS_ID].sort());
    expect(dsLines.find((l) => l.id === TOTAL_INTEREST_ID)!.formula).toEqual({ kind: 'call', fn: 'sum', args: [] });
  });

  it('formats Ending Balance as a total row, everything else normal', () => {
    const schema = regenerateDebtSchedule(trancheSchema(), 1, false);
    expect(findByRole(schema, 'endingBalance', 'termA')!.rowFormat).toBe('total');
    expect(findByRole(schema, 'beginningBalance', 'termA')!.rowFormat).toBe('normal');
    expect(findByRole(schema, 'interestExpense', 'termA')!.rowFormat).toBe('normal');
  });

  it('is idempotent — calling it again with no changes produces an identical schema', () => {
    const once = regenerateDebtSchedule(trancheSchema(), 1, false);
    const twice = regenerateDebtSchedule(once, 1, false);
    expect(twice).toEqual(once);
  });

  it('reconciles in place — the Debt Schedule section keeps its position, not appended again', () => {
    let schema = schemaWith([
      line('other', 'Other Section Marker', {}),
      ...trancheSchema().sections[0].lines,
    ]);
    schema = regenerateDebtSchedule(schema, 1, false);
    schema = { ...schema, sections: [schema.sections[0], { id: 'z', name: 'Zzz', lines: [] }, schema.sections[1]] };
    const reindexed = regenerateDebtSchedule(schema, 1, false);
    expect(reindexed.sections.findIndex((s) => s.name === 'Debt Schedule')).toBe(2);
  });

  it('removing the last tranche reverts the Debt Schedule section to just the three totals, each summing nothing', () => {
    let schema = regenerateDebtSchedule(trancheSchema(), 1, false);
    expect(schema.sections.find((s) => s.name === 'Debt Schedule')!.lines.length).toBeGreaterThan(3);
    schema = { ...schema, sections: schema.sections.map((s) => ({ ...s, lines: s.lines.filter((l) => l.id !== 'termA') })) };
    schema = regenerateDebtSchedule(schema, 1, false);
    const dsLines = schema.sections.find((s) => s.name === 'Debt Schedule')!.lines;
    expect(dsLines.map((l) => l.id).sort()).toEqual([TOTAL_BORROWINGS_ID, TOTAL_INTEREST_ID, TOTAL_REPAYMENTS_ID].sort());
    expect(dsLines.find((l) => l.id === TOTAL_INTEREST_ID)!.formula).toEqual({ kind: 'call', fn: 'sum', args: [] });
  });

  it('points the tranche line itself at its schedule Ending Balance', () => {
    const schema = regenerateDebtSchedule(trancheSchema(), 1, false);
    const tranche = schema.sections.flatMap((s) => s.lines).find((l) => l.id === 'termA')!;
    const ending = findByRole(schema, 'endingBalance', 'termA')!;
    expect(tranche.formula).toEqual({ kind: 'ref', lineId: ending.id });
  });
});

describe('regenerateDebtSchedule — circular-calc toggle', () => {
  function trancheSchema(): StatementSchema {
    return schemaWith([
      line('cash', 'Cash & Equivalents', {}),
      line('fcf', 'Free Cash Flow', {}),
      line('termA', 'Term Loan A', { lineKind: 'debt', debtProperties: { debtType: 'term', couponRate: 0.06 } }),
    ]);
  }

  it('interest is Beginning-only when the toggle is off, avg(Beginning, Ending) when on', () => {
    const beginningId = 'debtSchedule:termA:beginningBalance';
    const endingId = 'debtSchedule:termA:endingBalance';

    const off = regenerateDebtSchedule(trancheSchema(), 1, false);
    const offInterest = findByRole(off, 'interestExpense', 'termA')!;
    expect(offInterest.formula).toEqual({ kind: 'bin', op: '*', left: { kind: 'num', value: 0.06 }, right: { kind: 'ref', lineId: beginningId } });

    const on = regenerateDebtSchedule(trancheSchema(), 1, true);
    const onInterest = findByRole(on, 'interestExpense', 'termA')!;
    expect(onInterest.formula).toEqual({
      kind: 'bin', op: '*', left: { kind: 'num', value: 0.06 },
      right: { kind: 'call', fn: 'avg', args: [{ kind: 'ref', lineId: beginningId }, { kind: 'ref', lineId: endingId }] },
    });
  });
});

describe('regenerateDebtSchedule — survives a template clone re-keying every id', () => {
  it('keeps using the section/total ids a clone already assigned, rather than creating duplicates under the default ids', () => {
    const base = schemaWith([
      line('cash', 'Cash & Equivalents', {}),
      line('fcf', 'Free Cash Flow', {}),
    ]);
    let schema = regenerateDebtSchedule(base, 1, false);

    // Simulate what cloneStatementSchemaStructure does to every line/section when a model forks
    // its own private copy of a template: fresh ids for the Debt Schedule section and its three
    // (zero-tranche) totals, consistently — nothing here should ever assume the DEFAULT_* ids
    // are still current after this.
    schema = {
      ...schema,
      sections: schema.sections.map((s) =>
        s.name === 'Debt Schedule'
          ? { ...s, id: 'cloned:section', lines: s.lines.map((l) => ({ ...l, id: `cloned:${l.id}` })) }
          : s,
      ),
    };

    const withTranche = {
      ...schema,
      sections: [
        ...schema.sections,
        { id: 'sec2', name: 'Balance Sheet', lines: [line('termA', 'Term Loan A', { lineKind: 'debt', debtProperties: { couponRate: 0.06 } })] },
      ],
    };
    const regenerated = regenerateDebtSchedule(withTranche, 1, false);

    const dsSections = regenerated.sections.filter((s) => s.name === 'Debt Schedule');
    expect(dsSections).toHaveLength(1);
    expect(dsSections[0].id).toBe('cloned:section');
    expect(dsSections[0].lines.some((l) => l.id === `cloned:${TOTAL_INTEREST_ID}`)).toBe(true);
    expect(dsSections[0].lines.some((l) => l.id === TOTAL_INTEREST_ID)).toBe(false);
    // The real payoff: the tranche's own interest line landed in the SAME (cloned-id) total.
    const total = dsSections[0].lines.find((l) => l.id === `cloned:${TOTAL_INTEREST_ID}`)!;
    expect((total.formula as { args: unknown[] }).args).toHaveLength(1);
  });
});

describe('regenerateDebtSchedule — the three schedule-level totals', () => {
  it('sum every tranche, growing and shrinking as tranches come and go — no declared "feed" needed anywhere', () => {
    let schema = schemaWith([
      line('cash', 'Cash & Equivalents', {}),
      line('fcf', 'Free Cash Flow', {}),
      line('termA', 'Term Loan A', { lineKind: 'debt', debtProperties: { couponRate: 0.06 } }),
      line('termB', 'Term Loan B', { lineKind: 'debt', debtProperties: { couponRate: 0.05 } }),
    ]);
    schema = regenerateDebtSchedule(schema, 1, false);
    const total = () => schema.sections.flatMap((s) => s.lines).find((l) => l.id === TOTAL_INTEREST_ID)!;
    expect(total().formula).toMatchObject({ kind: 'call', fn: 'sum' });
    expect((total().formula as { args: unknown[] }).args).toHaveLength(2);

    schema = { ...schema, sections: schema.sections.map((s) => ({ ...s, lines: s.lines.filter((l) => l.id !== 'termA' && l.id !== 'termB') })) };
    schema = regenerateDebtSchedule(schema, 1, false);
    expect(total().formula).toEqual({ kind: 'call', fn: 'sum', args: [] });
  });

  it('a line elsewhere can reference a total by ordinary qualified formula, exactly like any other cross-section pull-through', () => {
    // No special field on either side — this is just an ordinary ResolvedFormula, the same way
    // defaultStatementSchema.ts wires up Net Interest Expense in the real default template.
    let schema = schemaWith([
      line('cash', 'Cash & Equivalents', {}),
      line('fcf', 'Free Cash Flow', {}),
      line('netInterestExpense', 'Net Interest Expense', { formula: { kind: 'ref', lineId: TOTAL_INTEREST_ID } }),
      line('termA', 'Term Loan A', { lineKind: 'debt', debtProperties: { couponRate: 0.06 } }),
    ]);
    schema = regenerateDebtSchedule(schema, 1, false);
    const evaluation = evaluateModel(schema, {
      timeline: TIMELINE,
      historicals: { termA: [100, null] },
    });
    expect(evaluation.getValue('netInterestExpense', 1)).toBeCloseTo(0.06 * 100, 6);
  });
});

describe('regenerateDebtSchedule — end to end via evaluateModel', () => {
  function props(overrides: Partial<DebtTrancheProperties>): DebtTrancheProperties {
    return { debtType: 'term', repayable: true, ...overrides };
  }

  function buildSchema(): StatementSchema {
    return schemaWith([
      line('cash', 'Cash & Equivalents', {}),
      line('fcf', 'Free Cash Flow', {}),
      line('revolver', 'Revolver', { lineKind: 'debt', debtProperties: props({ debtType: 'revolver', couponRate: 0.08, commitmentAmount: 50, commitmentFeeRate: 0.005 }) }),
      line('termA', 'Term Loan A', { lineKind: 'debt', debtProperties: props({ couponRate: 0.06, amortizationRate: 0.05 }) }),
      line('termB', 'Term Loan B (Bond)', { lineKind: 'debt', debtProperties: props({ couponRate: 0.07, repayable: false }) }),
    ]);
  }

  function evaluate(schema: StatementSchema, fcfPeriod1: number, minimumCashTarget: number) {
    const regenerated = regenerateDebtSchedule(schema, 1, false);
    const minCashLine = findByRole(regenerated, 'minimumCashTarget')!;
    const minCashDriverId =
      regenerated.drivers.find((d) => d.targetLineId === minCashLine.id)!.id;
    const historicals: Record<string, (number | null)[]> = {
      cash: [20, null],
      fcf: [0, fcfPeriod1],
      revolver: [15, null],
      termA: [100, null],
      termB: [50, null],
    };
    const evaluation = evaluateModel(regenerated, {
      timeline: TIMELINE,
      historicals,
      driverValues: { [minCashDriverId]: [null, minimumCashTarget] },
    });
    return { regenerated, evaluation };
  }

  it('sweeps available cash by seniority — revolver first, then term tranches, skipping the non-repayable bond', () => {
    const { regenerated, evaluation } = evaluate(buildSchema(), 80, 10);

    const revolverRepay = findByRole(regenerated, 'repayment', 'revolver')!;
    const termARepay = findByRole(regenerated, 'repayment', 'termA')!;
    const termBRepay = findByRole(regenerated, 'repayment', 'termB')!;
    expect(evaluation.getValue(revolverRepay.id, 1)).toBe(15); // fully repaid — it was senior-most
    expect(evaluation.getValue(termARepay.id, 1)).toBe(75); // 90 available − 15 to the revolver
    expect(evaluation.getValue(termBRepay.id, 1)).toBe(0); // non-repayable, never touched

    const revolverEnding = findByRole(regenerated, 'endingBalance', 'revolver')!;
    const termAEnding = findByRole(regenerated, 'endingBalance', 'termA')!;
    const termBEnding = findByRole(regenerated, 'endingBalance', 'termB')!;
    expect(evaluation.getValue(revolverEnding.id, 1)).toBe(0);
    expect(evaluation.getValue(termAEnding.id, 1)).toBe(20); // 100 − 5 amort − 75 repay
    expect(evaluation.getValue(termBEnding.id, 1)).toBe(50); // untouched

    // Interest Expense total = revolver coupon + commitment fee + term A + term B, all Beginning-only.
    expect(evaluation.getValue(TOTAL_INTEREST_ID, 1)).toBeCloseTo(0.08 * 15 + 0.005 * (50 - 15) + 0.06 * 100 + 0.07 * 50, 6);
    expect(evaluation.getValue(TOTAL_REPAYMENTS_ID, 1)).toBe(15 + (5 + 75) + 0); // revolver + (termA amort+repay) + termB
  });

  it('draws the revolver to cover a shortfall within capacity, with no breach', () => {
    // Revolver already carries a $15 draw (see `evaluate`'s historicals), so its available
    // capacity against the $50 commitment is $35 — a $30 shortfall fits inside that.
    const { regenerated, evaluation } = evaluate(buildSchema(), -40, 10);
    const borrow = findByRole(regenerated, 'borrowing', 'revolver')!;
    const breach = findByRole(regenerated, 'revolverBreach')!;
    expect(evaluation.getValue(borrow.id, 1)).toBe(30);
    expect(evaluation.getValue(breach.id, 1)).toBe(0);
  });

  it('caps the draw at revolver capacity and shows the uncovered remainder as a breach', () => {
    // Same $35 available capacity as above; a $90 shortfall now exceeds it.
    const { regenerated, evaluation } = evaluate(buildSchema(), -100, 10);
    const borrow = findByRole(regenerated, 'borrowing', 'revolver')!;
    const breach = findByRole(regenerated, 'revolverBreach')!;
    expect(evaluation.getValue(borrow.id, 1)).toBe(35);
    expect(evaluation.getValue(breach.id, 1)).toBe(55);
  });
});
