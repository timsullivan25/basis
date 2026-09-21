import type { StatementLine } from '../data/types';

/** Required / Optional: mapped from an uploaded model, projected afterwards. */
export function isSourced(line: Pick<StatementLine, 'role'>): boolean {
  return line.role === 'required' || line.role === 'optional';
}

/** Calculated / Linked / Check: one formula produces every period, and nothing is ever mapped to it. */
export function isFormulaOnly(line: Pick<StatementLine, 'role'>): boolean {
  return !isSourced(line);
}

/** Whether the mapping screen should offer a source for this line. */
export function expectsMapping(line: Pick<StatementLine, 'role'>): boolean {
  return isSourced(line);
}
