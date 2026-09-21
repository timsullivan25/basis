import type { LineMapping, ParsedSourceLine, ParsedWorkbook, StatementLine, StatementSchema, StatementSection } from '../../data';
import { getCheckStatus } from '../../components/statements/statementFormatting';
import { evaluateModel } from '../engine/evaluate';
import { normalize } from '../matchStatementLines';
import { buildTimeline } from '../periodTimeline';
import { resolveActuals } from '../resolveActuals';
import { hasValue } from './suggestConsolidations';

export interface FailingCheck {
  line: StatementLine;
  section: StatementSection;
  /** The check's value per period; null where it can't be computed. */
  values: (number | null)[];
}

/** Evaluates the schema against the current mapping and returns every check line with its value per period. */
export function evaluateChecks(
  schema: StatementSchema,
  workbook: ParsedWorkbook,
  mapping: Record<string, LineMapping>,
  manualHistoricals: Record<string, (number | null)[]> = {},
): FailingCheck[] {
  const timeline = buildTimeline(workbook.periods);
  const historicals = resolveActuals(Object.values(mapping), workbook, timeline);
  for (const [lineId, values] of Object.entries(manualHistoricals)) {
    if ((mapping[lineId]?.sourceLineIds.length ?? 0) === 0 && values.some((v) => v !== null)) historicals[lineId] = values;
  }
  const evaluation = evaluateModel(schema, { timeline, historicals });
  const checks: FailingCheck[] = [];
  for (const section of schema.sections) {
    for (const line of section.lines) {
      if (line.role !== 'check') continue;
      const values = timeline.map((_, i) => evaluation.getValue(line.id, i));
      checks.push({ line, section, values });
    }
  }
  return checks;
}

const fails = (c: FailingCheck) => c.values.some((v) => getCheckStatus(c.line, v) === 'fail');

/** Every check line that fails in some period under the current mapping. */
export function failingChecks(...args: Parameters<typeof evaluateChecks>): FailingCheck[] {
  return evaluateChecks(...args).filter(fails);
}

const MAX_CANDIDATES = 40;
const MAX_SUBSET = 3;
const MAX_RESULTS = 5;
const MIN_TOLERANCE = 0.05;

/**
 * Small sets of unmapped lines whose values equal the check's gap in every period where it fails (either
 * sign — a missing asset makes Assets − Liabilities negative, a missing liability positive). Pure
 * arithmetic, so it is code's job, not the model's; the result is evidence handed to the model, never applied.
 */
export function closingSubsets(check: FailingCheck, candidates: ParsedSourceLine[]): { lineIds: string[]; sign: 1 | -1 }[] {
  const tolerance = Math.max(check.line.checkTolerance ?? 0, MIN_TOLERANCE);
  const gaps = check.values.map((v, i) => ({ i, v })).filter((g): g is { i: number; v: number } => g.v !== null && Math.abs(g.v) > tolerance);
  if (gaps.length === 0) return [];
  const pool = [...candidates].sort((a, b) => Math.abs(b.values.at(-1) ?? 0) - Math.abs(a.values.at(-1) ?? 0)).slice(0, MAX_CANDIDATES);
  const found: { lineIds: string[]; sign: 1 | -1 }[] = [];

  const sumAt = (ids: ParsedSourceLine[], period: number) => ids.reduce((total, l) => total + (l.values[period] ?? 0), 0);
  const tryPick = (picked: ParsedSourceLine[]) => {
    for (const sign of [1, -1] as const) {
      if (gaps.every((g) => Math.abs(sumAt(picked, g.i) - sign * g.v) <= tolerance)) found.push({ lineIds: picked.map((l) => l.id), sign });
    }
  };
  const walk = (start: number, picked: ParsedSourceLine[], size: number) => {
    if (found.length >= MAX_RESULTS) return;
    if (picked.length === size) return tryPick(picked);
    for (let i = start; i < pool.length; i++) walk(i + 1, [...picked, pool[i]], size);
  };
  for (let size = 1; size <= MAX_SUBSET && found.length < MAX_RESULTS; size++) walk(0, [], size);
  return found.slice(0, MAX_RESULTS);
}

/** Imported lines in the same-named section that are unmapped and non-empty — where a missing line would be. */
export function candidatesForCheck(check: FailingCheck, workbook: ParsedWorkbook, mapping: Record<string, LineMapping>): ParsedSourceLine[] {
  const used = new Set(Object.values(mapping).flatMap((m) => m.sourceLineIds));
  return workbook.lines.filter((l) => normalize(l.section) === normalize(check.section.name) && !used.has(l.id) && hasValue(l));
}

/** The paragraph shown to the model for a failing check: the gap per period, and any lines that would close it exactly. */
export function checkEvidenceText(check: FailingCheck, workbook: ParsedWorkbook, candidates: ParsedSourceLine[]): string {
  const byId = new Map(workbook.lines.map((l) => [l.id, l]));
  const gaps = workbook.periods.map((p, i) => `${p.name}: ${check.values[i] === null || check.values[i] === undefined ? 'n/a' : Math.round((check.values[i] as number) * 100) / 100}`).join(', ');
  const subsets = closingSubsets(check, candidates);
  const closing = subsets.length
    ? `\nThese unmapped lines would close the gap exactly in every period (strong evidence they are missing from a target): ${subsets.map((s) => s.lineIds.map((id) => `${byId.get(id)?.name} [id=${id}]`).join(' + ')).join('; ')}.`
    : '\nNo small set of unmapped lines closes the gap exactly, so the gap may have another cause.';
  return `CHECK FAILING: "${check.line.name}" should be zero but is: ${gaps}. Something is likely missing from, or double counted in, this statement's mapping.${closing}`;
}
