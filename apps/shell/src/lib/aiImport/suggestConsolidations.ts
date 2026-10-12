import type { LineMapping, ParsedSourceLine, ParsedWorkbook } from '../../data';
import { normalize } from '../matchStatementLines';
import type { LlmProvider } from './llmProvider';
import type { MappingTarget } from './suggestMappings';
import { getPrompt } from './prompts';

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

const latest = (line: ParsedSourceLine, lastIndex: number): string => {
  const v = line.values[lastIndex];
  return v === null || v === undefined ? 'blank' : String(v);
};

/** A match not worth second-guessing without evidence: the user's own, an exact/alias/prior name hit, or an AI match it was sure of. Weak matches (fuzzy, unsure AI) and unmapped targets are open. */
export function isSettledMatch(mapping: LineMapping | undefined): boolean {
  if (!mapping || mapping.sourceLineIds.length === 0) return false;
  if (mapping.approved || mapping.method === 'manual' || mapping.method === 'exact' || mapping.method === 'alias' || mapping.method === 'prior') return true;
  return mapping.method === 'ai' && mapping.confidence >= CONFIDENCE.high;
}

/** True when the line carries any non-zero number — an all-zero or blank line has nothing to consolidate. */
export function hasValue(line: ParsedSourceLine): boolean {
  return line.values.some((v) => v !== null && v !== 0);
}

/** Imported lines not mapped onto any target, with something in them. */
export function unmappedSourceLines(workbook: ParsedWorkbook, mapping: Record<string, LineMapping>): ParsedSourceLine[] {
  const used = new Set(Object.values(mapping).flatMap((m) => m.sourceLineIds));
  return workbook.lines.filter((l) => !used.has(l.id) && hasValue(l));
}

/**
 * Looks for unmapped imported lines that belong ADDED to a target that is already mapped (Goodwill onto an
 * Intangibles match; an extra debt line onto a debt target). One request per statement section, pairing a
 * target section with the imported section of the same name — so a big import stays small and a Balance
 * Sheet line is only ever offered to Balance Sheet targets. Targets the user set or approved are left alone, and so are settled matches.
 * Returns the full new mapping (old sources plus additions, method 'ai', flagged) only for targets it changed.
 */
export async function suggestConsolidations(
  provider: LlmProvider,
  targets: MappingTarget[],
  workbook: ParsedWorkbook,
  mapping: Record<string, LineMapping>,
): Promise<Record<string, LineMapping>> {
  const pool = unmappedSourceLines(workbook, mapping);
  if (pool.length === 0) return {};
  const lastIndex = workbook.periods.length - 1;
  const sourceById = new Map(workbook.lines.map((l) => [l.id, l]));

  const poolBySection = new Map<string, ParsedSourceLine[]>();
  for (const line of pool) poolBySection.set(normalize(line.section), [...(poolBySection.get(normalize(line.section)) ?? []), line]);

  const targetsBySection = new Map<string, MappingTarget[]>();
  for (const t of targets) {
    if (isSettledMatch(mapping[t.line.id])) continue;
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
      const raw = await provider.generateStructured({
        system: getPrompt('consolidate'),
        prompt: `Section: ${sectionTargets[0].section.name}\n\nTarget lines:\n${targetText}\n\nUnmapped imported lines in this section:\n${sourceText}`,
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
