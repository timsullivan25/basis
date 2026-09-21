import type { LineMapping, ParsedSourceLine, ParsedWorkbook, StatementLine, StatementSchema, StatementSection } from '../../data';
import { addChildLine, childrenOf } from '../statementLineChildren';
import type { LlmProvider } from './llmProvider';

/**
 * A change the model proposes to the schema. This is a closed vocabulary, not free-form schema JSON: each
 * op is applied through the schema's own edit functions, so every invariant they keep (roll-up formulas,
 * roles, the Debt Schedule) still holds, and each op can be shown, accepted or rejected on its own. Later
 * ops (debt tranche settings, new lines or sections) extend this union; the review and apply path stays.
 */
export interface AddSubLineOp {
  kind: 'addSubLine';
  /** A line that allows sub-lines (a segment parent, an EBITDA adjustment level, a debt class). */
  parentLineId: string;
  name: string;
  /** Imported lines the new sub-line is mapped from. Never empty — a sub-line with nothing behind it isn't proposed. */
  sourceLineIds: string[];
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}
export type StructureOp = AddSubLineOp;

export type ParentTarget = { line: StatementLine; section: StatementSection };

export const STRUCTURE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['subLines'],
  properties: {
    subLines: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['parent', 'name', 'sources', 'confidence', 'reason'],
        properties: {
          parent: { type: 'string' },
          name: { type: 'string' },
          sources: { type: 'array', items: { type: 'string' } },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          reason: { type: 'string' },
        },
      },
    },
  },
} as const;

const SYSTEM_PROMPT = `You are helping fit an imported financial model onto a company's standard statement structure.
The standard statement has some "parent" lines that break down into sub-lines: revenue splits into segments, EBITDA splits into adjustments, and each debt class (secured, unsecured, ...) splits into its tranches. Some imported lines were not matched to any standard line. Decide which of those left-over lines are the sub-lines of which parent, and propose them.

Rules:
- Answer only with parent ids and imported-line ids you are given. Never invent an id.
- Propose a sub-line only when imported lines clearly break down that parent: revenue by segment or geography under a revenue parent, add-backs and adjustments under an EBITDA delta line, individual loans, notes and revolvers under a debt class.
- A sub-line's name is a clean, short label (for example "Academia", "Restructuring", "Term Loan B"). Do not include the group or section in it.
- One sub-line normally comes from one imported line. Use several only when they are pieces of the same item.
- Use each imported line at most once. Do not use lines marked as used.
- Do not propose sub-lines for totals or subtotals, ratios, or lines that belong on a standard line of their own.
- If nothing fits a parent, propose nothing for it. No proposals at all is a fine answer.
- confidence is "high" only when the breakdown is obvious. "reason" is one short sentence a reviewer can check.`;

function describeSource(line: ParsedSourceLine, lastIndex: number): string {
  const value = line.values[lastIndex];
  const parts = [`id=${line.id}`, `section=${line.section}`];
  if (line.group) parts.push(`group=${line.group}`);
  parts.push(`name=${line.name}`, `latest=${value === null || value === undefined ? 'blank' : value}`);
  return parts.join(' | ');
}

const latest = (line: ParsedSourceLine | undefined, lastIndex: number): number | null => line?.values[lastIndex] ?? null;

/** Lines that allow sub-lines and can take them — not generated or formula-only ones. */
export function subLineParents(schema: StatementSchema): ParentTarget[] {
  return schema.sections.flatMap((section) => section.lines.filter((line) => line.allowsSubLines && !line.debtScheduleRole).map((line) => ({ line, section })));
}

/** Imported lines not mapped onto any target yet — the raw material for sub-lines. A parent's own still-unreviewed AI mapping doesn't hold its lines back: the parent is about to be broken down, so a guess at its total (or at a sum of its tranches) must not hide what its sub-lines would be made from. */
export function unassignedSourceLines(schema: StatementSchema, workbook: ParsedWorkbook, mapping: Record<string, LineMapping>): ParsedSourceLine[] {
  const parentIds = new Set(subLineParents(schema).map((p) => p.line.id));
  const used = new Set(
    Object.values(mapping)
      .filter((m) => !(m.method === 'ai' && !m.approved && parentIds.has(m.targetLineId)))
      .flatMap((m) => m.sourceLineIds),
  );
  return workbook.lines.filter((l) => !used.has(l.id));
}

/** Asks the model which unassigned imported lines are sub-lines of which parent. Returns validated ops, possibly none. */
export async function proposeStructure(
  provider: LlmProvider,
  schema: StatementSchema,
  workbook: ParsedWorkbook,
  mapping: Record<string, LineMapping>,
): Promise<StructureOp[]> {
  const parents = subLineParents(schema);
  const leftover = unassignedSourceLines(schema, workbook, mapping);
  if (parents.length === 0 || leftover.length === 0) return [];

  const lastIndex = workbook.periods.length - 1;
  const sourceById = new Map(workbook.lines.map((l) => [l.id, l]));
  const parentText = parents
    .map(({ line, section }) => {
      const mapped = mapping[line.id]?.sourceLineIds.map((id) => sourceById.get(id)?.name).filter(Boolean).join(', ');
      const existing = childrenOf(schema, line.id).map((c) => c.name);
      return [
        `id=${line.id}`, `section=${section.name}`, `name=${line.name}`,
        line.lineKind === 'debt' ? 'kind=debt class' : undefined,
        mapped ? `mapped from: ${mapped}` : undefined,
        existing.length ? `already has sub-lines: ${existing.join(', ')}` : undefined,
      ].filter(Boolean).join(' | ');
    })
    .join('\n');

  const raw = await provider.generateStructured({
    system: SYSTEM_PROMPT,
    prompt: `Parent lines that can take sub-lines:\n${parentText}\n\nImported lines not matched to any standard line:\n${leftover.map((l) => describeSource(l, lastIndex)).join('\n')}`,
    schemaName: 'structure_proposals',
    schema: STRUCTURE_SCHEMA,
    effort: 'low',
  });
  return parseStructureOps(raw, schema, workbook, mapping);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Keeps only well-formed proposals: a real eligible parent, unassigned and not-yet-used sources, a fresh name. */
export function parseStructureOps(raw: unknown, schema: StatementSchema, workbook: ParsedWorkbook, mapping: Record<string, LineMapping>): StructureOp[] {
  if (!isObject(raw) || !Array.isArray(raw.subLines)) return [];
  const parents = new Set(subLineParents(schema).map((p) => p.line.id));
  const available = new Set(unassignedSourceLines(schema, workbook, mapping).map((l) => l.id));
  const takenNames = new Map<string, Set<string>>();
  const ops: StructureOp[] = [];
  for (const entry of raw.subLines) {
    if (!isObject(entry) || typeof entry.parent !== 'string' || !parents.has(entry.parent)) continue;
    const name = typeof entry.name === 'string' ? entry.name.trim().slice(0, 80) : '';
    if (!name || !Array.isArray(entry.sources)) continue;
    const sources = [...new Set(entry.sources.filter((s): s is string => typeof s === 'string' && available.has(s)))];
    if (sources.length === 0) continue;
    const names = takenNames.get(entry.parent) ?? new Set(childrenOf(schema, entry.parent).map((c) => c.name.toLowerCase()));
    if (names.has(name.toLowerCase())) continue;
    names.add(name.toLowerCase());
    takenNames.set(entry.parent, names);
    sources.forEach((s) => available.delete(s));
    ops.push({
      kind: 'addSubLine',
      parentLineId: entry.parent,
      name,
      sourceLineIds: sources,
      confidence: entry.confidence === 'high' || entry.confidence === 'medium' ? entry.confidence : 'low',
      reason: typeof entry.reason === 'string' ? entry.reason : '',
    });
  }
  return ops;
}

/** Code-computed evidence for a parent's proposed sub-lines: their latest-period total against what the parent was mapped to (null when it wasn't mapped). Shown to the reviewer, never a gate. */
export function tieOut(ops: StructureOp[], parentLineId: string, workbook: ParsedWorkbook, mapping: Record<string, LineMapping>): { proposed: number; parent: number | null } {
  const lastIndex = workbook.periods.length - 1;
  const byId = new Map(workbook.lines.map((l) => [l.id, l]));
  const sum = (ids: string[]) => ids.reduce((total, id) => total + (latest(byId.get(id), lastIndex) ?? 0), 0);
  const proposed = sum(ops.filter((o) => o.parentLineId === parentLineId).flatMap((o) => o.sourceLineIds));
  const parentSources = mapping[parentLineId]?.sourceLineIds ?? [];
  return { proposed, parent: parentSources.length ? sum(parentSources) : null };
}

const CONFIDENCE = { high: 0.75, medium: 0.6, low: 0.4 } as const;

/** Applies one op through the schema's own edit functions and maps the new line. The caller regenerates the Debt Schedule afterwards. */
export function applyStructureOp(schema: StatementSchema, mapping: Record<string, LineMapping>, op: StructureOp): { schema: StatementSchema; mapping: Record<string, LineMapping> } {
  const { schema: next, lineId } = addChildLine(schema, { kind: 'line', parentLineId: op.parentLineId }, op.name);
  return {
    schema: next,
    mapping: {
      ...mapping,
      [lineId]: {
        targetLineId: lineId,
        sourceLineIds: op.sourceLineIds,
        method: 'ai',
        confidence: CONFIDENCE[op.confidence],
        note: `AI-proposed sub-line (${op.confidence} confidence)${op.reason ? `: ${op.reason}` : ''}`,
        approved: false,
      },
    },
  };
}
