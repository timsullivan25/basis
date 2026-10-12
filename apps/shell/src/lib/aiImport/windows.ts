import type { SchemaLineIndex } from './schemaLineIndex';
import { LABEL_COLUMNS } from './sheetEvidence';
import { columnLetter, type GridCell, type GridRow, type SheetGrid } from './workbookGrid';

/** Leading non-empty rows sent at full width — where period headers live. */
export const TOP_ROWS = 15;
const HEADER_CELL_CHARS = 14;
const LABEL_CELL_CHARS = 60;

export interface LabelRow {
  rowNumber: number;
  /** Non-empty cells among the first LABEL_COLUMNS columns, e.g. { column: 'D', value: 'Revenue' }. */
  labels: { column: string; value: string }[];
  /** How many numbers the whole row holds, and the first one (with its column) as a scale/sign sample. */
  numericCount: number;
  firstNumber: { column: string; value: number } | null;
  /** The Basis schema line this row's label matches by name/alias, if any. */
  schemaMatch: string | null;
}

/** What the extraction-plan prompt gets to see for one sheet: the header rows in full, and every row's label — not every number. */
export interface SheetWindows {
  sheet: string;
  rowRange: { first: number; last: number };
  columnCount: number;
  topRows: GridRow[];
  labelRows: LabelRow[];
}

function clip(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function cellText(cell: GridCell, limit: number): string {
  if (cell === null) return '';
  return clip(typeof cell === 'number' ? String(Math.round(cell * 100) / 100) : cell, limit);
}

export function buildSheetWindows(grid: SheetGrid, index: SchemaLineIndex): SheetWindows {
  const labelRows: LabelRow[] = grid.rows.map((row) => {
    const labels = row.cells
      .slice(0, LABEL_COLUMNS)
      .flatMap((cell, col) => (typeof cell === 'string' ? [{ column: columnLetter(col), value: cell }] : []));
    let numericCount = 0;
    let firstNumber: LabelRow['firstNumber'] = null;
    row.cells.forEach((cell, col) => {
      if (typeof cell !== 'number') return;
      numericCount++;
      if (!firstNumber) firstNumber = { column: columnLetter(col), value: cell };
    });
    const match = labels.map((l) => index.match(l.value)).find((ref) => ref !== undefined);
    return { rowNumber: row.rowNumber, labels, numericCount, firstNumber, schemaMatch: match ? `${match.lineName} (${match.sectionName})` : null };
  });

  return {
    sheet: grid.name,
    rowRange: { first: grid.rows[0]?.rowNumber ?? 0, last: grid.rows[grid.rows.length - 1]?.rowNumber ?? 0 },
    columnCount: grid.rows.reduce((max, row) => Math.max(max, row.cells.length), 0),
    topRows: grid.rows.slice(0, TOP_ROWS),
    labelRows: labelRows.filter((row) => row.labels.length > 0 || row.numericCount > 0),
  };
}

export function windowsToText(windows: SheetWindows): string {
  const lines = [
    `Sheet "${windows.sheet}": rows ${windows.rowRange.first}-${windows.rowRange.last}, columns A-${columnLetter(Math.max(windows.columnCount - 1, 0))}`,
    '',
    `TOP ROWS (first ${windows.topRows.length} non-empty rows, all columns):`,
    ...windows.topRows.map((row) => {
      const cells = row.cells.flatMap((c, i) => (c === null ? [] : [`${columnLetter(i)}=${cellText(c, HEADER_CELL_CHARS)}`]));
      return `r${row.rowNumber}: ${cells.join(' ')}`;
    }),
    '',
    'ROW LABELS (every non-empty row; label cells, number count, first number, Basis match):',
    ...windows.labelRows.map((row) => {
      const labels = row.labels.map((l) => `${l.column}="${clip(l.value, LABEL_CELL_CHARS)}"`).join(' ') || '(no label)';
      const sample = row.firstNumber ? ` first=${row.firstNumber.column}:${cellText(row.firstNumber.value, HEADER_CELL_CHARS)}` : '';
      const match = row.schemaMatch ? ` → ${row.schemaMatch}` : '';
      return `r${row.rowNumber} ${labels} #${row.numericCount}${sample}${match}`;
    }),
  ];
  return lines.join('\n');
}
