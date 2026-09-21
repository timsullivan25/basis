export interface RowRange {
  first: number;
  last: number;
}

/** Index range (into the grid's non-empty rows) covered by a row-number range: from the first row at or after `first` to the last row at or before `last`. Null when no row falls inside. */
export function snapRange(rowNumbers: readonly number[], range: RowRange): { firstIdx: number; lastIdx: number } | null {
  const firstIdx = rowNumbers.findIndex((n) => n >= range.first);
  if (firstIdx < 0) return null;
  let lastIdx = -1;
  for (let i = rowNumbers.length - 1; i >= 0; i--) {
    if (rowNumbers[i] <= range.last) {
      lastIdx = i;
      break;
    }
  }
  return lastIdx >= firstIdx ? { firstIdx, lastIdx } : null;
}

/**
 * Where a dragged edge lands. `boundary` is the pointer's position in row units from the top of the rows (0 = the
 * top edge of the first row, 1 = the edge between rows 0 and 1, ...). The top edge can't pass the range's last row;
 * the bottom edge can't pass its first.
 */
export function dragTopEdge(boundary: number, lastIdx: number): number {
  return Math.min(Math.max(Math.round(boundary), 0), lastIdx);
}

export function dragBottomEdge(boundary: number, firstIdx: number, rowCount: number): number {
  return Math.max(Math.min(Math.round(boundary) - 1, rowCount - 1), firstIdx);
}
