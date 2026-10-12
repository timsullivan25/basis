import type { SchemaLineIndex } from './schemaLineIndex';
import type { SheetGrid } from './workbookGrid';

/** How many leading columns are scanned for line labels. */
export const LABEL_COLUMNS = 6;
/** How many leading (non-empty) rows are checked for period-header-looking text. */
const HEADER_SCAN_ROWS = 15;
const PERIOD_HEADER_MIN_CELLS = 3;
const EXAMPLE_LIMIT = 8;

// FY2024, FY-2024, FY 24, 2024A/2024E, Q1-2024, 1Q24, H1 2024, a bare year, or an ISO date.
const PERIOD_LIKE = /^(fy[\s-]?\d{2,4}|\d{4}\s?[ae]?|q[1-4][\s-]?\d{2,4}|[1-4]q\s?\d{2,4}|h[12][\s-]?\d{2,4}|\d{4}-\d{2}-\d{2})$/i;

export interface SheetEvidence {
  name: string;
  hidden: boolean;
  /** Non-empty rows, and the widest row's column count. */
  rowCount: number;
  columnCount: number;
  numericCells: number;
  textCells: number;
  /** Do the leading non-empty rows contain several period-looking cells (years, quarters, dates)? */
  periodHeaderHint: boolean;
  /** Distinct Basis schema lines whose name or alias appears as a label on this sheet. */
  schemaMatches: {
    distinctLines: number;
    bySection: Record<string, number>;
    examples: string[];
  };
}

/** Facts about each sheet that help decide whether it holds financial statements. Evidence only — nothing here selects a sheet. */
export function buildSheetEvidence(grids: SheetGrid[], index: SchemaLineIndex): SheetEvidence[] {
  return grids.map((grid) => {
    let numericCells = 0;
    let textCells = 0;
    let columnCount = 0;
    const seen = new Map<string, { sectionName: string; example: string }>();

    for (const row of grid.rows) {
      columnCount = Math.max(columnCount, row.cells.length);
      row.cells.forEach((cell, col) => {
        if (typeof cell === 'number') numericCells++;
        else if (cell !== null) {
          textCells++;
          if (col < LABEL_COLUMNS) {
            const ref = index.match(cell);
            if (ref && !seen.has(`${ref.sectionName}|${ref.lineName}`)) {
              seen.set(`${ref.sectionName}|${ref.lineName}`, { sectionName: ref.sectionName, example: `r${row.rowNumber} "${cell}" → ${ref.lineName}` });
            }
          }
        }
      });
    }

    const bySection: Record<string, number> = {};
    for (const { sectionName } of seen.values()) bySection[sectionName] = (bySection[sectionName] ?? 0) + 1;

    const periodLikeCells = grid.rows
      .slice(0, HEADER_SCAN_ROWS)
      .map((row) => row.cells.filter((c) => c !== null && PERIOD_LIKE.test(String(c).trim())).length);

    return {
      name: grid.name,
      hidden: grid.hidden,
      rowCount: grid.rows.length,
      columnCount,
      numericCells,
      textCells,
      periodHeaderHint: periodLikeCells.some((n) => n >= PERIOD_HEADER_MIN_CELLS),
      schemaMatches: { distinctLines: seen.size, bySection, examples: [...seen.values()].slice(0, EXAMPLE_LIMIT).map((s) => s.example) },
    };
  });
}

/** One-line-per-sheet rendering for the triage prompt. */
export function evidenceToText(evidence: SheetEvidence[]): string {
  return evidence
    .map((e) => {
      const sections = Object.entries(e.schemaMatches.bySection).map(([name, n]) => `${name}: ${n}`).join(', ');
      const head = `"${e.name}"${e.hidden ? ' (hidden)' : ''} — ${e.rowCount} rows × ${e.columnCount} cols, ${e.numericCells} numbers, ${e.textCells} text cells, period-like headers: ${e.periodHeaderHint ? 'yes' : 'no'}`;
      if (e.schemaMatches.distinctLines === 0) return `${head}; no Basis line matches`;
      return `${head}; ${e.schemaMatches.distinctLines} Basis lines matched (${sections}) e.g. ${e.schemaMatches.examples.slice(0, 3).join('; ')}`;
    })
    .join('\n');
}
