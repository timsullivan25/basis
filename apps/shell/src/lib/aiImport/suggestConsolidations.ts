import type { LineMapping, ParsedSourceLine, ParsedWorkbook } from '../../data';
import { normalize } from '../matchStatementLines';
import type { LlmProvider } from './llmProvider';
import type { MappingTarget } from './suggestMappings';

const CONFIDENCE = { high: 0.75, medium: 0.6, low: 0.4 } as const;
type Band = keyof typeof CONFIDENCE;
const MAX_ADDED_PER_TARGET = 5;

export const CONSOLIDATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['additions'],
  properties: {
    additions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['target', 'sources', 'confidence', 'reason'],
        properties: {
          target: { type: 'string' },
          sources: { type: 'array', items: { type: 'string' } },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          reason: { type: 'string' },
        },
      },
    },
  },
} as const;

export const CONSOLIDATION_PROMPT = `You are helping finish mapping an imported financial model onto a company's standard statement lines.
Each standard ("target") line below is already mapped to zero or more imported lines, which are added together. Some imported lines from the same statement are still unmapped. Decide which unmapped lines are further components of a target line and should be ADDED to what it already sums.

Rules:
- Answer only with target ids and imported-line ids you are given. Never invent an id.
- Add an unmapped line to a target only when it is part of the same thing the target reports. Examples: "Goodwill" added to a target "Goodwill & Intangibles" that is mapped only to "Intangible Assets"; "Restricted Cash" added to "Cash & Equivalents"; "Other Long-Term Debt" added to a "Debt" target that has one tranche; an unmapped add-back added to an EBITDA adjustments line.
- Do not add totals, subtotals, ratios, percentages, per-share figures or other memo lines. A line that reads like a subtotal of lines already mapped is not a component.
- Do not add a line just because it is unmapped. Many unmapped lines belong to no target; leave them.
- A line can be added to only one target.
- If a target already represents everything it should, add nothing to it. Returning no additions at all is a fine answer.
- confidence is "high" only when the line clearly belongs. "reason" is one short sentence a reviewer can check.`;

const latest = (line: ParsedSourceLine, lastIndex: number): string => {
  const v = line.values[lastIndex];
  return v === null || v === undefined ? 'blank' : String(v);
};

/** True when the line carries any non-zero number — an all-zero or blank line has nothing to consolidate. */
export function hasValue(line: ParsedSourceLine): boolean {
  return line.values.some((v) => v !== null && v !== 0);
}

/** Imported lines not mapped onto any target, with something in them. */
export function unmappedSourceLines(workbook: ParsedWorkbook, mapping: Record<string, LineMapping>): ParsedSourceLine[] {
  const used = new Set(Object.values(mapping).flatMap((m) => m.sourceLineIds));
  return workbook.lines.filter((l) => !used.has(l.id) && hasValue(l));
}

export interface ConsolidationOptions {
  /** Restrict to these target sections (by id) — the checks pass uses this to look only where a check is failing. */
  onlySectionIds?: ReadonlySet<string>;
  /** Extra text shown to the model for a target section (id -> text): the failing check, its gap, and lines that would close it. */
  evidenceBySectionId?: ReadonlyMap<string, string>;
}

/**
 * Looks for unmapped imported lines that belong ADDED to a target that is already mapped (Goodwill onto an
 * Intangibles match; an extra debt line onto a debt target). One request per statement section, pairing a
 * target section with the imported section of the same name — so a big import stays small and a Balance
 * Sheet line is only ever offered to Balance Sheet targets. Targets the user set or approved are left alone.
 * Returns the full new mapping (old sources plus additions, method 'ai', flagged) only for targets it changed.
 */
export async function suggestConsolidations(
  provider: LlmProvider,
  targets: MappingTarget[],
  workbook: ParsedWorkbook,
  mapping: Record<string, LineMapping>,
  options: ConsolidationOptions = {},
): Promise<Record<string, LineMapping>> {
  const pool = unmappedSourceLines(workbook, mapping);
  if (pool.length === 0) return {};
  const lastIndex = workbook.periods.length - 1;
  const sourceById = new Map(workbook.lines.map((l) => [l.id, l]));

  const poolBySection = new Map<string, ParsedSourceLine[]>();
  for (const line of pool) poolBySection.set(normalize(line.section), [...(poolBySection.get(normalize(line.section)) ?? []), line]);

  const targetsBySection = new Map<string, MappingTarget[]>();
  for (const t of targets) {
    if (options.onlySectionIds && !options.onlySectionIds.has(t.section.id)) continue;
    targetsBySection.set(t.section.id, [...(targetsBySection.get(t.section.id) ?? []), t]);
  }

  const result: Record<string, LineMapping> = {};
  const claimed = new Set<string>();
  const jobs = [...targetsBySection.values()].flatMap((sectionTargets) => {
    const sectionPool = poolBySection.get(normalize(sectionTargets[0].section.name));
    return sectionPool ? [{ sectionTargets, sectionPool }] : [];
  });

  await Promise.all(
    jobs.map(async ({ sectionTargets, sectionPool }) => {
      const targetText = sectionTargets
        .map(({ line }) => {
          const current = mapping[line.id]?.sourceLineIds.map((id) => sourceById.get(id)).filter((l): l is ParsedSourceLine => !!l) ?? [];
          const mapped = current.length ? `mapped to: ${current.map((l) => `${l.name} (${latest(l, lastIndex)})`).join(' + ')}` : 'not mapped';
          return `id=${line.id} | name=${line.name}${line.aliases.length ? ` | also called: ${line.aliases.join(', ')}` : ''} | ${mapped}`;
        })
        .join('\n');
      const sourceText = sectionPool
        .map((l) => [`id=${l.id}`, l.group ? `group=${l.group}` : undefined, `name=${l.name}`, `latest=${latest(l, lastIndex)}`].filter(Boolean).join(' | '))
        .join('\n');
      const evidence = options.evidenceBySectionId?.get(sectionTargets[0].section.id);
      const raw = await provider.generateStructured({
        system: CONSOLIDATION_PROMPT,
        prompt: `Section: ${sectionTargets[0].section.name}\n${evidence ? `\n${evidence}\n` : ''}\nTarget lines:\n${targetText}\n\nUnmapped imported lines in this section:\n${sourceText}`,
        schemaName: 'mapping_consolidations',
        schema: CONSOLIDATION_SCHEMA,
        effort: 'low',
      });
      const editable = new Map(
        sectionTargets.filter(({ line }) => { const m = mapping[line.id]; return !m || (m.method !== 'manual' && !m.approved); }).map(({ line }) => [line.id, line.name]),
      );
      const parsed = parseConsolidations(raw, editable, new Set(sectionPool.map((l) => l.id)), claimed);
      for (const [targetId, add] of Object.entries(parsed)) {
        const before = mapping[targetId];
        const existing = before?.sourceLineIds ?? [];
        if (decomposes(add.sources, existing, sourceById)) continue;
        const names = add.sources.map((id) => sourceById.get(id)?.name ?? id).join(', ');
        result[targetId] = {
          targetLineId: targetId,
          sourceLineIds: [...existing, ...add.sources],
          method: 'ai',
          confidence: CONFIDENCE[add.band],
          note: `AI suggests adding ${names} to ${existing.length ? `the existing match (${before?.method})` : 'this line'}${add.reason ? `: ${add.reason}` : ''}`,
          approved: false,
        };
      }
    }),
  );
  return result;
}

/** Lines that add up to what the target already reports are that figure's own components (Operating Income plus Depreciation, against a mapped EBITDA), not more of it — adding them would count it twice. */
export function decomposes(added: string[], existing: string[], byId: ReadonlyMap<string, ParsedSourceLine>): boolean {
  if (existing.length === 0) return false;
  const total = (ids: string[], i: number) => ids.reduce((sum, id) => sum + (byId.get(id)?.values[i] ?? 0), 0);
  const periods = byId.get(existing[0])?.values.length ?? 0;
  let compared = 0;
  for (let i = 0; i < periods; i++) {
    const have = total(existing, i);
    if (have === 0) continue;
    if (Math.abs(total(added, i) - have) > Math.max(0.05, Math.abs(have) * 0.0005)) return false;
    compared++;
  }
  return compared > 0;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Keeps additions for editable targets whose sources are unmapped lines of the right section not already taken. `claimed` is shared across sections so no line is added twice. */
export function parseConsolidations(
  raw: unknown,
  editable: ReadonlyMap<string, string>,
  pool: ReadonlySet<string>,
  claimed: Set<string>,
): Record<string, { sources: string[]; band: Band; reason: string }> {
  const out: Record<string, { sources: string[]; band: Band; reason: string }> = {};
  if (!isObject(raw) || !Array.isArray(raw.additions)) return out;
  for (const entry of raw.additions) {
    if (!isObject(entry) || typeof entry.target !== 'string' || !editable.has(entry.target) || !Array.isArray(entry.sources)) continue;
    const already = out[entry.target]?.sources ?? [];
    const sources = [...new Set(entry.sources.filter((s): s is string => typeof s === 'string' && pool.has(s) && !claimed.has(s)))].slice(0, MAX_ADDED_PER_TARGET - already.length);
    if (sources.length === 0) continue;
    sources.forEach((s) => claimed.add(s));
    out[entry.target] = {
      sources: [...already, ...sources],
      band: entry.confidence === 'high' || entry.confidence === 'medium' ? entry.confidence : 'low',
      reason: typeof entry.reason === 'string' ? entry.reason : (out[entry.target]?.reason ?? ''),
    };
  }
  return out;
}
