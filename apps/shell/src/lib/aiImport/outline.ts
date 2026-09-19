import { columnLetter, type GridCell, type SheetGrid } from './workbookGrid';

const HEADER_ROWS = 10;
const MAX_LABEL_ROWS_PER_SHEET = 70;
const CELL_CHARS = 14;
const LABEL_CHARS = 60;
const LABEL_SEARCH_COLS = 6;
const STATEMENT_KEYWORDS = /income statement|balance sheet|cash flow|total assets|net income|revenue|ebitda/i;
/** Statement titles are what the locate step is looking for, so they are exempt from the per-sheet cap. So are top-level section headers (a name in one of the first two columns, no numbers), which mark where each statement ends. */
const STATEMENT_TITLE = /^(consolidated\s+)?(income statement|statements? of (operations|income|earnings)|profit (and|&) loss|p&l|balance sheet|statements? of financial position|cash flow( statement)?s?|statements? of cash flows?)\b/i;

function clip(cell: GridCell, limit = CELL_CHARS): string {
  if (cell === null) return '';
  const text = typeof cell === 'number' ? String(Math.round(cell * 100) / 100) : cell;
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function numberCount(cells: GridCell[]): number {
  return cells.filter((c) => typeof c === 'number').length;
}

/**
 * A compact picture of the whole workbook for the "where are the financials?" question: per sheet, the
 * top rows verbatim (that's where period headers live) plus the labels of header-like rows further down
 * (rows with a name but no numbers, or that mention a statement keyword). Line items and values are
 * deliberately left out — a 700-row model would otherwise cost ~50k tokens to answer a question that
 * only needs its table of contents.
 */
export function buildOutline(grids: SheetGrid[]): string {
  return grids.map(sheetOutline).join('\n\n');
}

function sheetOutline(grid: SheetGrid): string {
  const label = `## Sheet "${grid.name}"${grid.hidden ? ' (hidden)' : ''}`;
  if (grid.rows.length === 0) return `${label} — empty`;

  const width = grid.rows.reduce((max, row) => Math.max(max, row.cells.length), 0);
  const lastRow = grid.rows[grid.rows.length - 1].rowNumber;
  const lines = [`${label} — rows 1-${lastRow}, columns A-${columnLetter(width - 1)}`];

  const top = grid.rows.filter((row) => row.rowNumber <= HEADER_ROWS);
  for (const row of top) {
    const cells = row.cells.flatMap((c, i) => (c === null ? [] : [`${columnLetter(i)}=${clip(c)}`]));
    lines.push(`r${row.rowNumber}: ${cells.join(' ')}`);
  }

  const labelRows: { text: string; priority: boolean }[] = [];
  for (const row of grid.rows) {
    if (row.rowNumber <= HEADER_ROWS) continue;
    const idx = row.cells.slice(0, LABEL_SEARCH_COLS).findIndex((c) => typeof c === 'string');
    if (idx < 0) continue;
    const label = row.cells[idx] as string;
    const headerLike = numberCount(row.cells) === 0;
    if (headerLike || STATEMENT_KEYWORDS.test(label)) {
      labelRows.push({
        text: `r${row.rowNumber} [${columnLetter(idx)}] ${clip(label, LABEL_CHARS)}${headerLike ? '' : ' (has values)'}`,
        priority: STATEMENT_TITLE.test(label.trim()) || (headerLike && idx <= 1),
      });
    }
  }
  if (labelRows.length > 0) {
    // Over the cap, keep every priority row and fill the rest in sheet order, so a long assumptions block can't crowd out the statements below it.
    let room = MAX_LABEL_ROWS_PER_SHEET - labelRows.filter((r) => r.priority).length;
    const kept = labelRows.filter((r) => r.priority || room-- > 0);
    lines.push('Row labels:');
    lines.push(...kept.map((r) => r.text));
    if (kept.length < labelRows.length) lines.push(`… ${labelRows.length - kept.length} more label rows omitted`);
  }
  return lines.join('\n');
}
