import type { LineMapping, ParsedSourceLine, StatementLine, StatementSection } from '../data';
import { isCalculated } from './engine/resolve';

const FUZZY_THRESHOLD = 0.6;

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function levenshtein(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let i = 0; i < rows; i++) dp[i][0] = i;
  for (let j = 0; j < cols; j++) dp[0][j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[rows - 1][cols - 1];
}

/** 0-1 similarity between two strings, normalized for punctuation/case/whitespace. */
function similarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const distance = levenshtein(na, nb);
  return 1 - distance / Math.max(na.length, nb.length);
}

function unmapped(targetLineId: string, note: string): LineMapping {
  return { targetLineId, sourceLineIds: [], method: 'none', confidence: 0, note, approved: false };
}

/**
 * Exact -> alias -> fuzzy matching, one target line at a time. Only ever proposes a single
 * source line per target — aggregating multiple source lines into one target is a manual
 * action in the mapping UI, not something this pass guesses at.
 *
 * The AI step from the matching hierarchy isn't implemented: there's no LLM call wired into
 * this app yet. Anything that falls through fuzzy matching comes back unmapped ('none') with
 * a note saying so, rather than faking an AI result.
 */
export function matchStatementLines(
  sections: StatementSection[],
  sourceLines: ParsedSourceLine[],
  additionalAliasesByLineId: Record<string, string[]> = {},
): Record<string, LineMapping> {
  const result: Record<string, LineMapping> = {};

  for (const section of sections) {
    for (const line of section.lines) {
      if (isCalculated(line)) continue; // calculated lines are never matched to source data
      result[line.id] = matchOne(line, sourceLines, additionalAliasesByLineId[line.id] ?? []);
    }
  }

  return result;
}

function matchOne(target: StatementLine, sourceLines: ParsedSourceLine[], extraAliases: string[]): LineMapping {
  const targetName = normalize(target.name);

  const exact = sourceLines.find((source) => normalize(source.name) === targetName);
  if (exact) {
    return {
      targetLineId: target.id,
      sourceLineIds: [exact.id],
      method: 'exact',
      confidence: 1,
      note: `"${exact.name}" matches the line name exactly.`,
      approved: false,
    };
  }

  const aliasSet = new Set(target.aliases.map(normalize).filter(Boolean));
  if (aliasSet.size > 0) {
    const aliasHit = sourceLines.find((source) => aliasSet.has(normalize(source.name)));
    if (aliasHit) {
      return {
        targetLineId: target.id,
        sourceLineIds: [aliasHit.id],
        method: 'alias',
        confidence: 1,
        note: `"${aliasHit.name}" matches a registered alias.`,
        approved: false,
      };
    }
  }

  // Names carried from the company's previous mapping — a real hit, but not a registered
  // schema alias, so it's tagged and reviewed differently (see MatchMethod).
  const priorSet = new Set(extraAliases.map(normalize).filter(Boolean));
  if (priorSet.size > 0) {
    const priorHit = sourceLines.find((source) => priorSet.has(normalize(source.name)));
    if (priorHit) {
      return {
        targetLineId: target.id,
        sourceLineIds: [priorHit.id],
        method: 'prior',
        confidence: 1,
        note: `"${priorHit.name}" matches the line mapped here last time.`,
        approved: false,
      };
    }
  }

  let best: { line: ParsedSourceLine; score: number } | null = null;
  for (const source of sourceLines) {
    const score = similarity(target.name, source.name);
    if (score >= FUZZY_THRESHOLD && (!best || score > best.score)) best = { line: source, score };
  }
  if (best) {
    return {
      targetLineId: target.id,
      sourceLineIds: [best.line.id],
      method: 'fuzzy',
      confidence: Number(best.score.toFixed(2)),
      note: `Fuzzy match on "${best.line.name}" (score ${best.score.toFixed(2)}).`,
      approved: false,
    };
  }

  return unmapped(target.id, 'No exact, alias, or fuzzy match above threshold. AI-assisted matching is not yet implemented.');
}
