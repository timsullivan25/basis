import { describe, expect, it } from 'vitest';
import { expectsMapping, isFormulaOnly, isSourced } from './lineRole';

describe('role helpers', () => {
  it('only Required and Optional lines are sourced and mapped', () => {
    expect(isSourced({ role: 'required' })).toBe(true);
    expect(isSourced({ role: 'optional' })).toBe(true);
    expect(isSourced({ role: 'calculated' })).toBe(false);
    expect(isSourced({ role: 'check' })).toBe(false);
    expect(expectsMapping({ role: 'optional' })).toBe(true);
    expect(expectsMapping({ role: 'calculated' })).toBe(false);
  });

  it('Calculated and Check lines are formula-only', () => {
    expect(isFormulaOnly({ role: 'calculated' })).toBe(true);
    expect(isFormulaOnly({ role: 'check' })).toBe(true);
    expect(isFormulaOnly({ role: 'required' })).toBe(false);
  });
});
