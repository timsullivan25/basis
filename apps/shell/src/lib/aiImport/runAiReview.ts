import type { LineMapping, ParsedWorkbook, StatementSchema } from '../../data';
import type { LlmProvider } from './llmProvider';
import { candidatesForCheck, checkEvidenceText, evaluateChecks, failingChecks } from './reviewChecks';
import { suggestConsolidations } from './suggestConsolidations';
import { suggestMappings, type MappingTarget } from './suggestMappings';

export type AiReviewStep = 'fill' | 'consolidate' | 'checks';

export interface CheckOutcome {
  name: string;
  section: string;
  status: 'resolved' | 'unresolved';
  /** The check's value in the latest period after the review (null when not computable). */
  latest: number | null;
}

export interface AiReviewResult {
  mapping: Record<string, LineMapping>;
  filled: number;
  consolidated: number;
  checks: CheckOutcome[];
  /** Sections where the consolidation pass was undone because it made that section's check worse. */
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

/**
 * The mapping review: three passes in order, each flagging what it changes for a person to check.
 * 1. Fill — unmapped and tied targets, from unmapped source lines.
 * 2. Consolidate — unmapped source lines that belong added onto an existing match (Goodwill onto Intangibles).
 * 3. Checks — with the mapping as it now stands, any failing check line marks a section where something is
 *    missing; consolidation is asked again, there only, with the gap and any lines that close it as evidence.
 *    A check still failing afterwards is reported, not hidden.
 */
export async function runAiReview(input: AiReviewInput): Promise<AiReviewResult> {
  const { provider, schema, targets, workbook, isSettled, manualHistoricals = {}, onStep = () => {} } = input;
  let mapping = input.mapping;

  onStep('fill');
  const filled = await suggestMappings(provider, targets, workbook, mapping, isSettled);
  mapping = { ...mapping, ...filled };

  onStep('consolidate');
  const afterFill = mapping;
  let consolidated = await suggestConsolidations(provider, targets, workbook, mapping);
  mapping = { ...mapping, ...consolidated };
  // The checks are the referee: a section whose check got worse (or newly failed) under these additions
  // has had something wrongly added, so its additions are undone rather than left for someone to untangle.
  const reverted = new Set<string>();
  const worst = (values: (number | null)[]) => Math.max(0, ...values.map((v) => Math.abs(v ?? 0)));
  const baseline = new Map(evaluateChecks(schema, workbook, afterFill, manualHistoricals).map((c) => [c.line.id, worst(c.values)]));
  for (const c of evaluateChecks(schema, workbook, mapping, manualHistoricals)) {
    if (worst(c.values) > (baseline.get(c.line.id) ?? 0) + 0.05) reverted.add(c.section.id);
  }
  if (reverted.size > 0) {
    const sectionOf = new Map(targets.map((t) => [t.line.id, t.section.id]));
    consolidated = Object.fromEntries(Object.entries(consolidated).filter(([id]) => !reverted.has(sectionOf.get(id) ?? '')));
    mapping = { ...afterFill, ...consolidated };
  }

  onStep('checks');
  const before = failingChecks(schema, workbook, mapping, manualHistoricals);
  let changedByChecks = 0;
  if (before.length > 0) {
    const evidenceBySectionId = new Map<string, string>();
    for (const check of before) {
      const text = checkEvidenceText(check, workbook, candidatesForCheck(check, workbook, mapping));
      evidenceBySectionId.set(check.section.id, [evidenceBySectionId.get(check.section.id), text].filter(Boolean).join('\n'));
    }
    const fixes = await suggestConsolidations(provider, targets, workbook, mapping, { onlySectionIds: new Set(evidenceBySectionId.keys()), evidenceBySectionId });
    changedByChecks = Object.keys(fixes).length;
    mapping = { ...mapping, ...fixes };
  }
  const after = new Map(evaluateChecks(schema, workbook, mapping, manualHistoricals).map((c) => [c.line.id, c]));
  const stillFailing = new Set(failingChecks(schema, workbook, mapping, manualHistoricals).map((c) => c.line.id));
  const checks: CheckOutcome[] = before.map((c) => {
    const now = after.get(c.line.id) ?? c;
    const stillFails = stillFailing.has(c.line.id);
    return { name: c.line.name, section: c.section.name, status: stillFails ? 'unresolved' : 'resolved', latest: now.values.at(-1) ?? null };
  });

  return { mapping, filled: Object.keys(filled).length, consolidated: Object.keys(consolidated).length + changedByChecks, checks, reverted: targets.filter((t) => reverted.has(t.section.id)).map((t) => t.section.name).filter((n, i, all) => all.indexOf(n) === i) };
}
