import { describe, expect, it } from 'vitest';
import { expectsMapping, isFormulaOnly, lineRole, normalizeLine, normalizeStatementSchema } from './lineRole';
import type { StatementLine, StatementSchema } from '../data';

const someFormula = { kind: 'num', value: 1 } as const;

function line(over: Partial<StatementLine> = {}): StatementLine {
  return {
    id: 'l1',
    name: 'L',
    rowFormat: 'normal',
    numberFormat: 'number',
    sign: 'natural',
    aggregation: 'sum',
    formula: null,
    projection: null,
    aliases: [],
    ...over,
  };
}

describe('lineRole — older data with no stored role', () => {
  it('a plain line is Required, or Optional when the old flag said so', () => {
    expect(lineRole(line({ required: true }))).toBe('required');
    expect(lineRole(line({ required: false }))).toBe('optional');
    expect(lineRole(line())).toBe('required');
  });

  it('a formula with no projection is Calculated (the old "structural formula")', () => {
    expect(lineRole(line({ required: false, formula: someFormula }))).toBe('calculated');
  });

  it('a formula WITH a projection is still sourced', () => {
    expect(lineRole(line({ required: true, formula: someFormula, projection: { method: 'flat' } }))).toBe('required');
  });

  it('a rollup formula (sub-lines / debt) is not Calculated', () => {
    expect(lineRole(line({ required: false, formula: someFormula, allowsSubLines: true }))).toBe('optional');
    expect(lineRole(line({ required: false, formula: someFormula, parentLineId: 'p' }))).toBe('optional');
    expect(lineRole(line({ required: false, formula: someFormula, lineKind: 'debt' }))).toBe('optional');
  });

  it('a legacy lineKind "check" is the Check role, and a Debt Schedule line is Calculated', () => {
    expect(lineRole(line({ lineKind: 'check', formula: someFormula }))).toBe('check');
    expect(lineRole(line({ debtScheduleRole: { role: 'totalInterestExpense' } }))).toBe('calculated');
  });

  it('a stored role always wins', () => {
    expect(lineRole(line({ role: 'calculated', required: true }))).toBe('calculated');
  });
});

describe('expectsMapping / isFormulaOnly', () => {
  it('only Required and Optional lines are mapped', () => {
    expect(expectsMapping(line({ role: 'required' }))).toBe(true);
    expect(expectsMapping(line({ role: 'optional' }))).toBe(true);
    expect(expectsMapping(line({ role: 'calculated' }))).toBe(false);
    expect(expectsMapping(line({ role: 'check' }))).toBe(false);
    expect(isFormulaOnly(line({ role: 'check' }))).toBe(true);
  });
});

describe('normalizeLine', () => {
  it('gives a sourced line with no projection the default Flat — the "forgot to set one" case', () => {
    const next = normalizeLine(line({ id: 'x', required: true }));
    expect(next.role).toBe('required');
    expect(next.projection).toEqual({ method: 'flat' });
    expect(next.formula).toEqual({ kind: 'call', fn: 'priorPeriod', args: [{ kind: 'ref', lineId: 'x' }] });
  });

  it('drops the legacy required flag and lineKind "check"', () => {
    const next = normalizeLine(line({ required: false, lineKind: 'check', formula: someFormula }));
    expect(next.role).toBe('check');
    expect('required' in next).toBe(false);
    expect('lineKind' in next).toBe(false);
  });

  it('leaves a Calculated line without a projection', () => {
    const next = normalizeLine(line({ required: false, formula: someFormula }));
    expect(next.role).toBe('calculated');
    expect(next.projection).toBeNull();
  });

  it('leaves a debt line and a parent that sums sub-lines without a projection', () => {
    expect(normalizeLine(line({ required: false, lineKind: 'debt' })).projection).toBeNull();
    expect(normalizeLine(line({ required: false, allowsSubLines: true })).projection).toBeNull();
  });

  it('never discards a projection or formula that is already there', () => {
    const before = line({ role: 'required', formula: someFormula, projection: { method: 'growth', driverId: 'd1' } });
    expect(normalizeLine(before)).toEqual(before);
  });

  it('is idempotent', () => {
    const schema: StatementSchema = {
      id: 's', name: 'S', createdAt: '', updatedAt: '', drivers: [],
      sections: [{ id: 'a', name: 'A', lines: [line({ id: 'r', required: true }), line({ id: 'c', required: false, formula: someFormula })] }],
    };
    const once = normalizeStatementSchema(schema);
    expect(normalizeStatementSchema(once)).toEqual(once);
  });
});
