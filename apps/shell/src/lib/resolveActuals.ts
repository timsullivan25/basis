import type { LineMapping, ParsedWorkbook, Timeline } from '../data';

/**
 * Resolves every mapped line's values against the parsed workbook, once, at mapping-save time —
 * the result is what a Model persists as its historicals, never re-derived from the workbook on
 * read. Unmapped lines (empty sourceLineIds) are omitted; a period with no source value present
 * resolves to null, distinct from zero.
 */
export function resolveActuals(
  mapping: LineMapping[],
  workbook: ParsedWorkbook,
  timeline: Timeline,
): Record<string, (number | null)[]> {
  const result: Record<string, (number | null)[]> = {};
  for (const m of mapping) {
    if (m.sourceLineIds.length === 0) continue;
    result[m.targetLineId] = timeline.map((_, periodIndex) => {
      let sum = 0;
      let any = false;
      for (const id of m.sourceLineIds) {
        const value = workbook.lines.find((line) => line.id === id)?.values[periodIndex];
        if (value !== null && value !== undefined) {
          sum += value;
          any = true;
        }
      }
      return any ? sum : null;
    });
  }
  return result;
}
