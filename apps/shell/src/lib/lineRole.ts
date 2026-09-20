import type { LineRole, StatementLine, StatementSchema } from '../data/types';
import { buildFlatFormula } from './engine/resolve';

type RoleInput = Pick<
  StatementLine,
  'role' | 'required' | 'formula' | 'projection' | 'lineKind' | 'parentLineId' | 'allowsSubLines' | 'debtScheduleRole'
>;

/** A line whose formula is NOT its own authored calculation: a debt line (the Debt Schedule feeds
 *  it), a sub-line, or a parent that sums its sub-lines. These keep `projection: null` and are
 *  still sourced (mapped) lines — the formula they carry is a rollup, not "the line is
 *  calculated". */
function hasStructuralFormula(line: RoleInput): boolean {
  return line.lineKind === 'debt' || Boolean(line.parentLineId) || Boolean(line.allowsSubLines);
}

/** The role of data saved before `role` existed, derived the way the old UI inferred it: a check
 *  line was `lineKind: 'check'`, a Debt Schedule line is generated, and "has a formula but no
 *  projection" meant Calculated — except a rollup formula (see hasStructuralFormula), which never
 *  did. Everything else was Required/Optional by the old `required` flag. */
function deriveLegacyRole(line: RoleInput): LineRole {
  if (line.lineKind === 'check') return 'check';
  if (line.debtScheduleRole) return 'calculated';
  if (line.formula !== null && line.projection == null && !hasStructuralFormula(line)) return 'calculated';
  return line.required === false ? 'optional' : 'required';
}

/** THE way to read a line's role — prefers the stored one, falls back to deriving it for older
 *  data (a frozen snapshot, an exported template, a test fixture). */
export function lineRole(line: RoleInput): LineRole {
  return line.role ?? deriveLegacyRole(line);
}

/** Required / Optional: mapped from an uploaded model, projected afterwards. */
export function isSourced(line: RoleInput): boolean {
  const role = lineRole(line);
  return role === 'required' || role === 'optional';
}

/** Calculated / Check: one formula produces every period, and nothing is ever mapped to it. */
export function isFormulaOnly(line: RoleInput): boolean {
  return !isSourced(line);
}

/** Whether the mapping screen should offer a source for this line. */
export function expectsMapping(line: RoleInput): boolean {
  return isSourced(line);
}

/** Where a line's projection is legitimately absent (see StatementLine.projection). */
function needsNoProjection(line: RoleInput): boolean {
  return hasStructuralFormula(line) || Boolean(line.debtScheduleRole);
}

/** Brings one line to the current shape: an explicit `role`, no legacy `required` / `lineKind:
 *  'check'`, and — for a sourced line that has none — the default Flat projection. Idempotent,
 *  and never discards a projection, driver or formula that's already there. */
export function normalizeLine(line: StatementLine): StatementLine {
  const role = lineRole(line);
  const { required: _legacyRequired, ...rest } = line;
  const next: StatementLine = { ...rest, role, lineKind: line.lineKind === 'check' ? undefined : line.lineKind };
  if (next.lineKind === undefined) delete next.lineKind;

  const isSourcedLine = role === 'required' || role === 'optional';
  if (isSourcedLine && next.projection == null && !needsNoProjection(next)) {
    // A sourced line with no projection was the "forgot to set one" case. If it somehow carries a
    // hand-written formula, keep that as its projection; otherwise it carries forward flat.
    return next.formula !== null
      ? { ...next, projection: { method: 'formula' } }
      : { ...next, formula: buildFlatFormula(next.id), projection: { method: 'flat' } };
  }
  return next;
}

/** normalizeLine over a whole schema. Applied where saved schemas are read (see the
 *  repositories), so everything downstream only ever sees the current shape. */
export function normalizeStatementSchema(schema: StatementSchema): StatementSchema {
  return {
    ...schema,
    sections: schema.sections.map((section) => ({ ...section, lines: section.lines.map(normalizeLine) })),
  };
}
