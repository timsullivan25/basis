import type { ParsedPeriod, ParsedSourceLine, ParsedWorkbook } from '../../data';
import type { LayoutMap, LayoutPeriodColumn, LayoutPeriodKind } from './layoutMap';
import { columnIndex, type GridCell, type SheetGrid } from './workbookGrid';

/** Which period columns to pull. 'lowest' takes the finest grain present (quarters over years), for when Basis aggregates annuals itself. */
export type Granularity = 'annual' | 'lowest';

export interface ExtractionResult {
  workbook: ParsedWorkbook;
  /** Things worth a human glance at review — never blocking. */
  warnings: string[];
}

export class ExtractionError extends Error {}

const GRAIN_ORDER: LayoutPeriodKind[] = ['Quarter', 'Semi-Annual', 'FY'];

function chooseKind(columns: LayoutPeriodColumn[], granularity: Granularity): LayoutPeriodKind | undefined {
  const present = new Set(columns.filter((c) => c.actual).map((c) => c.kind));
  if (granularity === 'annual') return present.has('FY') ? 'FY' : undefined;
  return GRAIN_ORDER.find((kind) => present.has(kind));
}

function toIsoDate(cell: GridCell): string {
  if (typeof cell !== 'string') return '';
  const parsed = new Date(cell);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
}

/**
 * Copies historical periods and line items out of the located region into the shape the existing template
 * parser produces. Deterministic: no value passes through a model. Zeros are copied as zeros, and
 * non-numeric cells become null — cleanup of placeholder zeros, ratio rows and check rows is left to mapping.
 */
export function extractHistoricals(grids: SheetGrid[], map: LayoutMap, granularity: Granularity = 'annual'): ExtractionResult {
  const grid = grids.find((g) => g.name === map.sheet);
  if (!grid) throw new ExtractionError(`Sheet "${map.sheet}" not found.`);

  const kind = chooseKind(map.periodColumns, granularity);
  if (!kind) throw new ExtractionError(granularity === 'annual' ? 'No actual annual period columns were identified.' : 'No actual period columns were identified.');
  const columns = map.periodColumns.filter((c) => c.actual && c.kind === kind);

  const rowByNumber = new Map(grid.rows.map((row) => [row.rowNumber, row.cells]));
  const cellAt = (rowNumber: number | null, column: string): GridCell =>
    rowNumber === null ? null : (rowByNumber.get(rowNumber)?.[columnIndex(column)] ?? null);

  const warnings: string[] = [];
  const periodType = kind as ParsedPeriod['type'];
  const periods: ParsedPeriod[] = columns.map((c) => {
    const nameCell = cellAt(map.nameRow, c.column);
    const date = toIsoDate(cellAt(map.dateRow, c.column));
    if (!date) warnings.push(`Column ${c.column} has no readable period-end date.`);
    return { type: periodType, date, name: nameCell === null ? c.column : String(nameCell) };
  });

  const labelCol = columnIndex(map.labelColumn);
  const lines: ParsedSourceLine[] = [];
  for (const statement of map.statements) {
    for (let rowNumber = statement.firstRow; rowNumber <= statement.lastRow; rowNumber++) {
      const cells = rowByNumber.get(rowNumber);
      const label = cells?.[labelCol];
      if (typeof label !== 'string') continue;
      const values = columns.map((c) => {
        const value = cells?.[columnIndex(c.column)];
        return typeof value === 'number' ? value : null;
      });
      if (values.every((v) => v === null)) continue; // header / spacer rows carry no data
      lines.push({ id: `row-${rowNumber}`, section: statement.name, name: label, values });
    }
  }

  if (lines.length === 0) throw new ExtractionError('No line items with numbers were found in the identified statement rows.');
  for (const [i, column] of columns.entries()) {
    if (lines.every((line) => line.values[i] === null)) warnings.push(`Column ${column.column} has no numbers in any statement row.`);
  }
  return { workbook: { periods, lines }, warnings };
}
