import type { LineMapping, ParsedWorkbook, StatementSchema } from '../../data';
import type { LlmProvider } from './llmProvider';
import { candidatesForCheck, checkGap, evaluateChecks } from './reviewChecks';
import { applyChange, describeAttempt, proposeCheckFixes, type MappingChange } from './suggestCheckFixes';
import { suggestConsolidations } from './suggestConsolidations';
import { suggestMappings, type MappingTarget } from './suggestMappings';

export type AiReviewStep = 'fill' | 'consolidate' | 'checks';

/** How many times the model gets to look at a failing check and propose changes. */
export const MAX_CHECK_ROUNDS = 3;
const EPSILON = 0.01;

export interface CheckOutcome {
  name: string;
  section: string;
  /** resolved: the check now passes. improved: still off, but by less than before the review. unresolved: not helped. */
  status: 'resolved' | 'improved' | 'unresolved';
  /** The check's value in the latest period after the review (null when not computable). */
  latest: number | null;
}

export interface AiReviewResult {
  mapping: Record<string, LineMapping>;
  filled: number;
  consolidated: number;
  /** Lines changed by the checks pass, not counting ones consolidation already changed. */
  fixed: number;
  checks: CheckOutcome[];
  /** Sections whose suggestions after Fill were undone because their check ended worse than it started. */
  reverted: string[];
}

export interface AiReviewInput {
  provider: LlmProvider;
  schema: StatementSchema;
  targets: MappingTarget[];
  workbook: ParsedWorkbook;
  mapping: Record<string, LineMapping>;
  manualHistoricals?: Record<string, (number | null)[]>;
  /** A match that needs no fill pass: it has a source and isn't a tie. */
  isSettled: (mapping: LineMapping | undefined) => boolean;
  onStep?: (step: AiReviewStep) => void;
}

const stub = (id: string): Omit<LineMapping, 'previous'> => ({ targetLineId: id, sourceLineIds: [], method: 'none', confidence: 0, note: '', approved: false });

/** Stamps every mapping that differs from `old` with what it replaced (kept from the first change), so one suggestion can be rejected later. */
function withPrevious(old: Record<string, LineMapping>, next: Record<string, LineMapping>): Record<string, LineMapping> {
  const out = { ...next };
  for (const [id, m] of Object.entries(next)) {
    if (m === old[id]) continue;
    const { previous, ...before } = old[id] ?? stub(id);
    out[id] = { ...m, previous: previous ?? before };
  }
  return out;
}

/**
 * The mapping review. Every pass works on a copy in memory, the result is flagged for a person to check, and
 * nothing is saved.
 * 1. Fill — unmapped and tied targets, from unmapped source lines.
 * 2. Consolidate — unmapped source lines that belong added onto an existing weak match (Goodwill onto Intangibles).
 *    Settled matches (exact, alias, prior, sure AI) are left alone.
 * 3. Checks — with 1 and 2 in place, every check line still off is looked at up to MAX_CHECK_ROUNDS times. The model
 *    sees the gap, what earlier tries did to it, and any unmapped lines that would close it exactly, and may add,
 *    remove or move lines. Each proposal is tried on an in-memory copy and kept only if it shrinks the gap.
 * Finally, a section whose check ended worse than it was after Fill gets everything after Fill undone there.
 * A check that is still off is reported, never hidden.
 */
export async function runAiReview(input: AiReviewInput): Promise<AiReviewResult> {
  const { provider, schema, targets, workbook, isSettled, manualHistoricals = {}, onStep = () => {} } = input;
  const evaluate = (m: Record<string, LineMapping>) => evaluateChecks(schema, workbook, m, manualHistoricals);
  const gapOf = (m: Record<string, LineMapping>, checkId: string) => {
    const c = evaluate(m).find((x) => x.line.id === checkId);
    return c ? checkGap(c) : 0;
  };
  let mapping = input.mapping;

  onStep('fill');
  const filled = await suggestMappings(provider, targets, workbook, mapping, isSettled);
  mapping = withPrevious(mapping, { ...mapping, ...filled });
  const afterFill = mapping;

  onStep('consolidate');
  const consolidated = await suggestConsolidations(provider, targets, workbook, mapping);
  mapping = withPrevious(mapping, { ...mapping, ...consolidated });

  onStep('checks');
  // Every check that is off at any point before the rounds — the ones the summary has to account for.
  const startGap = new Map(evaluate(afterFill).map((c) => [c.line.id, checkGap(c)]));
  const seen = new Set([...startGap].filter(([, g]) => g > 0).map(([id]) => id));
  for (const c of evaluate(mapping)) if (checkGap(c) > 0) seen.add(c.line.id);
  const attempts = new Map<string, string[]>();
  const priorGap = new Map<string, number>();
  const finished = new Set<string>();
  const fixedIds = new Set<string>();
  for (let round = 1; round <= MAX_CHECK_ROUNDS; round++) {
    const active = evaluate(mapping).filter((c) => checkGap(c) > 0 && !finished.has(c.line.id));
    if (active.length === 0) break;
    for (const check of active) {
      const gap = checkGap(check);
      const changes = await proposeCheckFixes(provider, {
        check, schema, workbook, mapping,
        sectionTargets: targets.filter((t) => t.section.id === check.section.id),
        pool: candidatesForCheck(check, workbook, mapping),
        gap, priorGap: priorGap.get(check.line.id) ?? null, attempts: attempts.get(check.line.id) ?? [],
      });
      if (changes.length === 0) { finished.add(check.line.id); continue; }
      priorGap.set(check.line.id, gap);

      const nameOf = (id: string) => targets.find((t) => t.line.id === id)?.line.name ?? id;
      const log = attempts.get(check.line.id) ?? [];
      const applyAll = (m: Record<string, LineMapping>, list: MappingChange[]) => list.reduce((acc, ch) => applyChange(acc, ch, workbook), m);
      let next = mapping;
      const together = gapOf(applyAll(mapping, changes), check.line.id);
      if (changes.length > 1 && together < gap - EPSILON) {
        next = applyAll(mapping, changes);
        changes.forEach((ch) => log.push(describeAttempt(round, ch, workbook, nameOf(ch.targetLineId), gap, together, true)));
      } else {
        // One at a time, each kept only if it shrinks the gap — a good change can't be sunk by a bad one beside it.
        let currentGap = gap;
        for (const ch of changes) {
          const trial = applyChange(next, ch, workbook);
          const g = gapOf(trial, check.line.id);
          const kept = g < currentGap - EPSILON;
          log.push(describeAttempt(round, ch, workbook, nameOf(ch.targetLineId), currentGap, g, kept));
          if (kept) { next = trial; currentGap = g; }
        }
      }
      attempts.set(check.line.id, log);
      if (next !== mapping) {
        for (const id of Object.keys(next)) if (next[id] !== mapping[id]) fixedIds.add(id);
        mapping = withPrevious(mapping, next);
      }
    }
  }

  // The last guard: a section whose check ended worse than it was after Fill has its later suggestions undone.
  const reverted = new Set<string>();
  for (const c of evaluate(mapping)) {
    if (checkGap(c) > (startGap.get(c.line.id) ?? 0) + EPSILON) {
      reverted.add(c.section.id);
      for (const t of targets.filter((x) => x.section.id === c.section.id)) {
        if (mapping[t.line.id] === afterFill[t.line.id]) continue;
        mapping = { ...mapping };
        if (afterFill[t.line.id]) mapping[t.line.id] = afterFill[t.line.id];
        else delete mapping[t.line.id];
      }
    }
  }

  const checks: CheckOutcome[] = evaluate(mapping)
    .filter((c) => seen.has(c.line.id) && ((startGap.get(c.line.id) ?? 0) > 0 || checkGap(c) > 0))
    .map((c) => {
      const gap = checkGap(c);
      return {
        name: c.line.name,
        section: c.section.name,
        status: gap === 0 ? 'resolved' : gap < (startGap.get(c.line.id) ?? 0) - EPSILON ? 'improved' : 'unresolved',
        latest: c.values.at(-1) ?? null,
      };
    });

  const consolidatedIds = Object.keys(consolidated).filter((id) => mapping[id] !== afterFill[id]);
  return {
    mapping,
    filled: Object.keys(filled).length,
    consolidated: consolidatedIds.length,
    fixed: [...fixedIds].filter((id) => !consolidatedIds.includes(id) && mapping[id] !== afterFill[id]).length,
    checks,
    reverted: targets.filter((t) => reverted.has(t.section.id)).map((t) => t.section.name).filter((n, i, all) => all.indexOf(n) === i),
  };
}
