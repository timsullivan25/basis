import { describe, expect, it } from 'vitest';
import { DEFAULT_CHECK_TOLERANCE, getCheckStatus } from './statementFormatting';
import type { StatementLine } from '../../data';

function checkLine(overrides: Partial<StatementLine> = {}): StatementLine {
  return {
    id: 'l1',
    name: 'Some Check',
    role: 'check',
    rowFormat: 'normal',
    numberFormat: 'percentage',
    sign: 'natural',
    aggregation: 'none',
    formula: null,
    projection: null,
    aliases: [],
    ...overrides,
  };
}

describe('getCheckStatus', () => {
  it('is "unknown" for a null value — the first period, not a failure', () => {
    expect(getCheckStatus(checkLine(), null)).toBe('unknown');
  });

  it('is "unknown" for a line that is not a Check, regardless of value', () => {
    expect(getCheckStatus(checkLine({ role: 'calculated' }), 5)).toBe('unknown');
  });

  it('passes at exactly the default tolerance, fails just past it', () => {
    expect(getCheckStatus(checkLine(), DEFAULT_CHECK_TOLERANCE)).toBe('pass');
    expect(getCheckStatus(checkLine(), DEFAULT_CHECK_TOLERANCE + 0.0001)).toBe('fail');
  });

  it('is sign-independent — a negative miss still fails', () => {
    expect(getCheckStatus(checkLine(), -(DEFAULT_CHECK_TOLERANCE + 0.01))).toBe('fail');
  });

  it('honors a line-specific checkTolerance over the default', () => {
    const loose = checkLine({ checkTolerance: 0.05 });
    expect(getCheckStatus(loose, 0.02)).toBe('pass');
    const strict = checkLine({ checkTolerance: 0 });
    expect(getCheckStatus(strict, 0.0001)).toBe('fail');
  });
});
