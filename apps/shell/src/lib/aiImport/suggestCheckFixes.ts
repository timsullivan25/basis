import type { LineMapping, ParsedSourceLine, ParsedWorkbook, StatementSchema } from '../../data';
import type { LlmProvider } from './llmProvider';
import { checkFormulaText, closingSubsets, type FailingCheck } from './reviewChecks';
import type { MappingTarget } from './suggestMappings';

const CONFIDENCE = { high: 0.75, medium: 0.6, low: 0.4 } as const;
export type Band = keyof typeof CONFIDENCE;
const MAX_ADDED_PER_CHANGE = 5;

/** One proposed edit to a target's sum: lines to add, lines to take out. Moving a line is a remove on one target and an add on another. */
export interface MappingChange {
  targetLineId: string;
  add: string[];
  remove: string[];
  confidence: Band;
  reason: string;
}

export const CHECK_FIX_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['changes'],
  properties: {
    changes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['target', 'add', 'remove', 'confidence', 'reason'],
        properties: {
          target: { type: 'string' },
          add: { type: 'array', items: { type: 'string' } },
          remove: { type: 'array', items: { type: 'string' } },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          reason: { type: 'string' },
        },
      },
    },
  },
} as const;

export const CHECK_FIX_PROMPT = `You are helping fix the mapping of an imported financial model onto a company's standard statement lines. A check that should equal zero does not, so the mapping is probably wrong or incomplete somewhere in this statement.

Each target line below is mapped to zero or more imported lines, which are added together. You may change that: ADD an unmapped imported line to a target, REMOVE an imported line from a target (only targets marked removable), or MOVE a line by removing it from one target and adding it to another.

Rules:
- Answer only with target ids and imported-line ids you are given. Never invent an id.
- Use the numbers. The gap is what is missing or double counted; a change should move the gap toward zero. You are told what earlier attempts did to the gap — do not repeat one that made it worse.
- Every change must also make sense on its own. A line goes on a target because it is that kind of item, never only because the numbers tie: debt does not belong in an operating liability, and a subtotal is not a component.
- Prefer the smallest change that explains the gap. Do not remap lines that look correct.
- Remove a line only when it looks wrongly placed, and say why.
- If you can see no sensible change, return no changes. That is a fine answer.
- confidence is "high" only when the change clearly belongs. "reason" is one short sentence a reviewer can check.`;

const latest = (line: ParsedSourceLine, lastIndex: number): string => {
  const v = line.values[lastIndex];
  return v === null || v === undefined ? 'blank' : String(v);
};

/** A mapping the review may take lines out of: not the user's or an approved one, and only a weak one (fuzzy) or one the AI made. */
export function isRemovable(mapping: LineMapping | undefined): boolean {
  return !!mapping && mapping.sourceLineIds.length > 0 && !mapping.approved && (mapping.method === 'ai' || mapping.method === 'fuzzy');
}

/** A mapping the review may add lines to: anything but the user's own and approved ones. */
export function isEditable(mapping: LineMapping | undefined): boolean {
  return !mapping || (!mapping.approved && mapping.method !== 'manual');
}

export interface CheckFixRequest {
  check: FailingCheck;
  schema: StatementSchema;
  workbook: ParsedWorkbook;
  mapping: Record<string, LineMapping>;
  /** Targets in the check's section. */
  sectionTargets: MappingTarget[];
  /** Unmapped, non-empty imported lines in the same section. */
  pool: ParsedSourceLine[];
  gap: number;
  /** The gap before the last change that was kept, or null on the first look. */
  priorGap: number | null;
  /** What earlier rounds tried and what it did to the gap, oldest first. */
  attempts: string[];
}

/** Asks the model for changes that would close one failing check, with the numbers and history it needs. Answers are validated; nothing is applied here. */
export async function proposeCheckFixes(provider: LlmProvider, request: CheckFixRequest): Promise<MappingChange[]> {
  const { check, schema, workbook, mapping, sectionTargets, pool, gap, priorGap, attempts } = request;
  const lastIndex = workbook.periods.length - 1;
  const sourceById = new Map(workbook.lines.map((l) => [l.id, l]));
  const round = (n: number) => Math.round(n * 100) / 100;

  const values = workbook.periods.map((p, i) => `${p.name}: ${check.values[i] === null || check.values[i] === undefined ? 'n/a' : round(check.values[i] as number)}`).join(', ');
  const subsets = closingSubsets(check, pool);
  const closing = subsets.length
    ? `Unmapped lines that would close the gap exactly in every period: ${subsets.map((s) => s.lineIds.map((id) => `${sourceById.get(id)?.name} [id=${id}]`).join(' + ')).join('; ')}. Strong evidence, but only if they belong on a target.`
    : 'No small set of unmapped lines closes the gap exactly, so the cause may be a wrongly placed line.';

  const targetText = sectionTargets
    .filter((t) => isEditable(mapping[t.line.id]))
    .map(({ line }) => {
      const m = mapping[line.id];
      const current = m?.sourceLineIds.map((id) => sourceById.get(id)).filter((l): l is ParsedSourceLine => !!l) ?? [];
      const mapped = current.length ? current.map((l) => `${l.name} (${latest(l, lastIndex)}) [id=${l.id}]`).join(' + ') : 'not mapped';
      return `id=${line.id} | name=${line.name} | mapped to: ${mapped} | removable: ${isRemovable(m) ? 'yes' : 'no'}`;
    })
    .join('\n');
  const poolText = pool.map((l) => [`id=${l.id}`, l.group ? `group=${l.group}` : undefined, `name=${l.name}`, `latest=${latest(l, lastIndex)}`].filter(Boolean).join(' | ')).join('\n');

  const raw = await provider.generateStructured({
    system: CHECK_FIX_PROMPT,
    prompt: [
      `CHECK: "${check.line.name}" = ${checkFormulaText(check, schema)}. It should be zero.`,
      `Values by period: ${values}.`,
      `Total gap now: ${round(gap)}${priorGap === null ? ' (first look)' : `; before the last change kept: ${round(priorGap)}`}.`,
      attempts.length ? `Already tried:\n${attempts.join('\n')}` : 'Nothing tried yet.',
      closing,
      `\nTarget lines:\n${targetText}`,
      `\nUnmapped imported lines in this section:\n${poolText || '(none)'}`,
    ].join('\n'),
    schemaName: 'mapping_check_changes',
    schema: CHECK_FIX_SCHEMA,
    effort: 'low',
  });
  return parseCheckFixes(raw, sectionTargets.map((t) => t.line.id).filter((id) => isEditable(mapping[id])), mapping, new Set(pool.map((l) => l.id)));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Keeps changes for editable targets: adds must come from the unmapped pool (or be lines this same answer removes), removes must be current sources of a removable target. */
export function parseCheckFixes(raw: unknown, editableIds: string[], mapping: Record<string, LineMapping>, pool: ReadonlySet<string>): MappingChange[] {
  if (!isObject(raw) || !Array.isArray(raw.changes)) return [];
  const editable = new Set(editableIds);
  const entries = raw.changes.filter(isObject);
  const removed = new Set<string>();
  const removes = entries.map((e) => {
    const target = typeof e.target === 'string' ? e.target : '';
    const current = new Set(mapping[target]?.sourceLineIds ?? []);
    const ids = editable.has(target) && isRemovable(mapping[target]) && Array.isArray(e.remove) ? [...new Set(e.remove.filter((s): s is string => typeof s === 'string' && current.has(s)))] : [];
    ids.forEach((id) => removed.add(id));
    return ids;
  });
  const claimed = new Set<string>();
  const out: MappingChange[] = [];
  entries.forEach((e, i) => {
    if (typeof e.target !== 'string' || !editable.has(e.target)) return;
    const add = Array.isArray(e.add)
      ? [...new Set(e.add.filter((s): s is string => typeof s === 'string' && (pool.has(s) || removed.has(s)) && !claimed.has(s)))].slice(0, MAX_ADDED_PER_CHANGE)
      : [];
    if (add.length === 0 && removes[i].length === 0) return;
    add.forEach((s) => claimed.add(s));
    out.push({
      targetLineId: e.target,
      add,
      remove: removes[i],
      confidence: e.confidence === 'high' || e.confidence === 'medium' ? e.confidence : 'low',
      reason: typeof e.reason === 'string' ? e.reason : '',
    });
  });
  return out;
}

/** Applies a change to a copy of the mapping: the target's sources minus `remove` plus `add`, flagged as an AI match (or unmapped if nothing is left). */
export function applyChange(mapping: Record<string, LineMapping>, change: MappingChange, workbook: ParsedWorkbook): Record<string, LineMapping> {
  const before = mapping[change.targetLineId];
  const kept = (before?.sourceLineIds ?? []).filter((id) => !change.remove.includes(id));
  const sourceLineIds = [...kept, ...change.add.filter((id) => !kept.includes(id))];
  const nameOf = (id: string) => workbook.lines.find((l) => l.id === id)?.name ?? id;
  const parts = [change.add.length ? `added ${change.add.map(nameOf).join(', ')}` : '', change.remove.length ? `removed ${change.remove.map(nameOf).join(', ')}` : ''].filter(Boolean).join(' and ');
  return {
    ...mapping,
    [change.targetLineId]: sourceLineIds.length === 0
      ? { targetLineId: change.targetLineId, sourceLineIds: [], method: 'none', confidence: 0, note: `AI check fix ${parts} — nothing left mapped${change.reason ? `: ${change.reason}` : ''}`, approved: false }
      : { targetLineId: change.targetLineId, sourceLineIds, method: 'ai', confidence: CONFIDENCE[change.confidence], note: `AI check fix ${parts}${change.reason ? `: ${change.reason}` : ''}`, approved: false },
  };
}

/** One line of history for the model: what a change was and what it did to the gap. */
export function describeAttempt(round: number, change: MappingChange, workbook: ParsedWorkbook, targetName: string, before: number, after: number, kept: boolean): string {
  const nameOf = (id: string) => workbook.lines.find((l) => l.id === id)?.name ?? id;
  const what = [change.add.length ? `add ${change.add.map(nameOf).join(', ')} to ${targetName}` : '', change.remove.length ? `remove ${change.remove.map(nameOf).join(', ')} from ${targetName}` : ''].filter(Boolean).join('; ');
  const r = (n: number) => Math.round(n * 100) / 100;
  return `Round ${round}: ${what} — gap ${r(before)} -> ${r(after)} (${kept ? 'kept' : 'rejected, did not help'})`;
}
