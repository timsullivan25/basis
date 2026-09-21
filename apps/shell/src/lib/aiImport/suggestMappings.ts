import type { LineMapping, ParsedSourceLine, ParsedWorkbook, StatementLine, StatementSection } from '../../data';
import type { LlmProvider } from './llmProvider';
import { getPrompt } from './prompts';

export type MappingTarget = { line: StatementLine; section: StatementSection };

/** What the model says about how sure it is; mapped to numbers that all sit below the review threshold, so an AI match is always reviewed by a person. */
const CONFIDENCE = { high: 0.75, medium: 0.6, low: 0.4 } as const;
type Band = keyof typeof CONFIDENCE;

const MAX_SOURCES_PER_TARGET = 5;

export const MAPPING_SUGGESTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['matches'],
  properties: {
    matches: {
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

function describeSource(line: ParsedSourceLine, lastIndex: number, claimedBy: string | undefined): string {
  const value = line.values[lastIndex];
  const parts = [`id=${line.id}`, `section=${line.section}`];
  if (line.group) parts.push(`group=${line.group}`);
  parts.push(`name=${line.name}`, `latest=${value === null || value === undefined ? 'blank' : value}`);
  if (claimedBy) parts.push(`(already used by "${claimedBy}")`);
  return parts.join(' | ');
}

/**
 * Asks the model to place imported lines on the target lines the deterministic pass couldn't settle.
 * One request per statement section. Returns a mapping (method 'ai') only for targets it proposed
 * something for; every id is checked against the workbook, and a source already used by a settled
 * target is dropped. Targets it declines are simply absent — their current mapping stays as it was.
 */
export async function suggestMappings(
  provider: LlmProvider,
  targets: MappingTarget[],
  workbook: ParsedWorkbook,
  current: Record<string, LineMapping>,
  isSettled: (mapping: LineMapping | undefined) => boolean,
): Promise<Record<string, LineMapping>> {
  const unresolved = new Set(targets.filter((t) => !isSettled(current[t.line.id])).map((t) => t.line.id));
  if (unresolved.size === 0) return {};

  const claimedBy = new Map<string, string>();
  for (const t of targets) {
    if (unresolved.has(t.line.id)) continue;
    for (const id of current[t.line.id]?.sourceLineIds ?? []) claimedBy.set(id, t.line.name);
  }
  const sourceById = new Map(workbook.lines.map((l) => [l.id, l]));
  const lastIndex = workbook.periods.length - 1;
  const sourceText = workbook.lines.map((l) => describeSource(l, lastIndex, claimedBy.get(l.id))).join('\n');

  const bySection = new Map<string, MappingTarget[]>();
  for (const t of targets) {
    if (!unresolved.has(t.line.id)) continue;
    bySection.set(t.section.id, [...(bySection.get(t.section.id) ?? []), t]);
  }

  const result: Record<string, LineMapping> = {};
  await Promise.all(
    [...bySection.values()].map(async (sectionTargets) => {
      const targetText = sectionTargets
        .map(({ line, section }) => `id=${line.id} | section=${section.name} | name=${line.name}${line.aliases.length ? ` | also called: ${line.aliases.join(', ')}` : ''}${line.role === 'required' ? ' | required' : ''}`)
        .join('\n');
      const raw = await provider.generateStructured({
        system: getPrompt('fill'),
        prompt: `Target lines to place:\n${targetText}\n\nImported lines (latest period value shown):\n${sourceText}`,
        schemaName: 'mapping_suggestions',
        schema: MAPPING_SUGGESTION_SCHEMA,
        effort: 'low',
      });
      const asked = new Set(sectionTargets.map((t) => t.line.id));
      for (const [targetId, mapping] of Object.entries(parseSuggestions(raw, asked, sourceById, claimedBy))) result[targetId] = mapping;
    }),
  );
  return result;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Keeps only well-formed suggestions for targets that were asked about, with sources that exist and aren't already used. */
export function parseSuggestions(
  raw: unknown,
  asked: ReadonlySet<string>,
  sourceById: ReadonlyMap<string, ParsedSourceLine>,
  claimedBy: ReadonlyMap<string, string>,
): Record<string, LineMapping> {
  const out: Record<string, LineMapping> = {};
  if (!isObject(raw) || !Array.isArray(raw.matches)) return out;
  for (const entry of raw.matches) {
    if (!isObject(entry) || typeof entry.target !== 'string' || !asked.has(entry.target) || !Array.isArray(entry.sources)) continue;
    const sources = [...new Set(entry.sources.filter((s): s is string => typeof s === 'string' && sourceById.has(s) && !claimedBy.has(s)))].slice(0, MAX_SOURCES_PER_TARGET);
    if (sources.length === 0) continue;
    const band: Band = entry.confidence === 'high' || entry.confidence === 'medium' ? entry.confidence : 'low';
    out[entry.target] = {
      targetLineId: entry.target,
      sourceLineIds: sources,
      method: 'ai',
      confidence: CONFIDENCE[band],
      note: `AI suggestion (${band} confidence)${typeof entry.reason === 'string' && entry.reason ? `: ${entry.reason}` : ''}`,
      approved: false,
    };
  }
  return out;
}
