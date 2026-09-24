import type { LineMapping, ParsedSourceLine, ParsedWorkbook, StatementLine, StatementSchema, StatementSection } from '../../data';
import { addChildLine, childrenOf } from '../statementLineChildren';
import type { LlmProvider } from './llmProvider';
import { getPrompt } from './prompts';

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

function describeSource(line: ParsedSourceLine, lastIndex: number): string {
  const value = line.values[lastIndex];
  const parts = [`id=${line.id}`, `section=${line.section}`];
  if (line.group) parts.push(`group=${line.group}`);
  parts.push(`name=${line.name}`, `latest=${value === null || value === undefined ? 'blank' : value}`);
  return parts.join(' | ');
}

/** Lines grouped by (section, group) — the biggest clusters first, since a group of several lines is the likeliest breakdown — then the ungrouped ones in file order. */
export function clusterText(lines: ParsedSourceLine[], lastIndex: number): string {
  const clusters = new Map<string, ParsedSourceLine[]>();
  const loose: ParsedSourceLine[] = [];
  for (const l of lines) {
    if (!l.group) { loose.push(l); continue; }
    const key = `${l.section} / ${l.group}`;
    clusters.set(key, [...(clusters.get(key) ?? []), l]);
  }
  const blocks = [...clusters.entries()].sort((a, b) => b[1].length - a[1].length).map(([key, members]) => `[${key}] (${members.length} lines)\n${members.map((l) => describeSource(l, lastIndex)).join('\n')}`);
  if (loose.length > 0) blocks.push(`[ungrouped] (${loose.length} lines)\n${loose.map((l) => describeSource(l, lastIndex)).join('\n')}`);
  return blocks.join('\n\n');
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
    system: getPrompt('subLines'),
    prompt: `Parent lines that can take sub-lines:\n${parentText}\n\nImported lines not matched to any standard line, clustered by group:\n${clusterText(leftover, lastIndex)}`,
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
  return dropCostBreakdownWithoutRevenue(ops, schema);
}

const COST_OF_REVENUE = /^(cost of (revenues?|sales|goods sold)|cogs)$/i;
const REVENUE = /^((total|net) )?revenues?$/i;

/** A cost-of-revenue breakdown only makes sense against a revenue breakdown — the same segments — so without one (already in the schema, or proposed in this same answer) it is dropped. */
function dropCostBreakdownWithoutRevenue(ops: StructureOp[], schema: StatementSchema): StructureOp[] {
  const lines = schema.sections.flatMap((s) => s.lines);
  const nameOf = (id: string) => lines.find((l) => l.id === id)?.name ?? '';
  const revenueBroken = lines.some((l) => REVENUE.test(l.name) && childrenOf(schema, l.id).length > 0) || ops.some((o) => REVENUE.test(nameOf(o.parentLineId)));
  return revenueBroken ? ops : ops.filter((o) => !COST_OF_REVENUE.test(nameOf(o.parentLineId)));
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
