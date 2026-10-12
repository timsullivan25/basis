export type GridCell = string | number | null;

export interface GridRow {
  /** 1-based row number as it appears in the source sheet, so the model (and later checks) can cite it. */
  rowNumber: number;
  /** Cells from column A onward; trailing blanks trimmed. */
  cells: GridCell[];
}

export interface SheetGrid {
  name: string;
  hidden: boolean;
  /** Fully blank rows are dropped; row numbers are preserved. */
  rows: GridRow[];
}

export function columnLetter(index: number): string {
  let n = index;
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

/** Inverse of `columnLetter`: "A" → 0, "AK" → 36. Returns -1 for anything that isn't a plain column reference. */
export function columnIndex(letters: string): number {
  if (!/^[A-Z]{1,3}$/.test(letters)) return -1;
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function normalizeCell(raw: unknown): GridCell {
  if (raw === null || raw === undefined) return null;
  if (raw instanceof Date) return raw.toISOString().slice(0, 10);
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const text = String(raw).trim();
  return text === '' ? null : text;
}

/** Converts already-parsed sheet data (a 2D array per sheet) into trimmed grids. Pure, so it is testable without a real workbook. */
export function buildSheetGrid(name: string, hidden: boolean, data: unknown[][]): SheetGrid {
  const rows: GridRow[] = [];
  data.forEach((rawRow, index) => {
    const cells = (rawRow ?? []).map(normalizeCell);
    while (cells.length > 0 && cells[cells.length - 1] === null) cells.pop();
    if (cells.length > 0) rows.push({ rowNumber: index + 1, cells });
  });
  return { name, hidden, rows };
}

/** Reads every sheet of an .xlsx into grids of cached cell values (formulas are not evaluated; whatever Excel last computed is what we get). */
export async function readWorkbookGrids(file: Blob): Promise<SheetGrid[]> {
  // Loaded on demand, same as parseBasisTemplate — xlsx is large.
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
  return workbook.SheetNames.map((name, i) => {
    const sheet = workbook.Sheets[name];
    const hidden = (workbook.Workbook?.Sheets?.[i]?.Hidden ?? 0) !== 0;
    // Anchor at A1 explicitly: by default sheet_to_json starts at the first populated cell, which would silently
    // renumber every row and column of a model whose used range begins at, say, B2.
    const ref = sheet['!ref'];
    const data = ref
      ? XLSX.utils.sheet_to_json<unknown[]>(sheet, {
          header: 1,
          raw: true,
          defval: null,
          range: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: XLSX.utils.decode_range(ref).e }),
        })
      : [];
    return buildSheetGrid(name, hidden, data);
  });
}

/** Renders one grid as tab-separated text with a column-letter header and source row numbers, compact enough to send to a model. */
export function gridToText(grid: SheetGrid): string {
  const width = grid.rows.reduce((max, row) => Math.max(max, row.cells.length), 0);
  const header = ['', ...Array.from({ length: width }, (_, i) => columnLetter(i))].join('\t');
  const body = grid.rows.map((row) => [row.rowNumber, ...row.cells.map((c) => c ?? '')].join('\t'));
  const label = `Sheet: ${grid.name}${grid.hidden ? ' (hidden)' : ''}`;
  return [label, header, ...body].join('\n');
}
