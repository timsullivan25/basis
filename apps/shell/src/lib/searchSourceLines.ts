import type { ParsedSourceLine } from '../data';

/** Rank of a source line for a search query: 1 name starts with it, 2 name contains it, 3 group contains it, 4 section contains it; null for no match. */
function rank(line: ParsedSourceLine, query: string): number | null {
  const name = line.name.toLowerCase();
  if (name.startsWith(query)) return 1;
  if (name.includes(query)) return 2;
  if (line.group?.toLowerCase().includes(query)) return 3;
  if (line.section.toLowerCase().includes(query)) return 4;
  return null;
}

/**
 * Filters and orders imported lines for the mapping picker. With no query every line is returned, those
 * in `preferredSection` (the target's own section) first. With a query only matching lines are returned,
 * best tier first; within a tier and when nothing is typed, the file's own order is kept.
 */
export function searchSourceLines(lines: ParsedSourceLine[], search: string, preferredSection: string): ParsedSourceLine[] {
  const query = search.trim().toLowerCase();
  if (!query) {
    const preferred = preferredSection.trim().toLowerCase();
    const inSection = (l: ParsedSourceLine) => l.section.trim().toLowerCase() === preferred;
    return [...lines.filter(inSection), ...lines.filter((l) => !inSection(l))];
  }
  return lines
    .map((line, index) => ({ line, index, tier: rank(line, query) }))
    .filter((r): r is { line: ParsedSourceLine; index: number; tier: number } => r.tier !== null)
    .sort((a, b) => a.tier - b.tier || a.index - b.index)
    .map((r) => r.line);
}
