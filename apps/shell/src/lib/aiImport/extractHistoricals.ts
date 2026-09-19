import type { ParsedPeriod, ParsedSourceLine, ParsedWorkbook } from '../../data';
import type { ExtractionPlan, PeriodColumn, PeriodColumnKind, SheetPlan } from './extractionPlan';
import { columnIndex, type GridCell, type SheetGrid } from './workbookGrid';

/** Which period columns to pull. 'lowest' takes the finest grain present (quarters over years), for when Basis aggregates annuals itself. */
export type Granularity = 'annual' | 'lowest';

export interface ExtractionResult {
  workbook: ParsedWorkbook;
  /** Things worth a human glance at review — never blocking. */
  warnings: string[];
}

export class ExtractionError extends Error {}

const GRAIN_ORDER: PeriodColumnKind[] = ['Quarter', 'Semi-Annual', 'FY'];

function chooseKind(columns: PeriodColumn[], granularity: Granularity): PeriodColumnKind | undefined {
  const present = new Set(columns.filter((c) => c.actual).map((c) => c.kind));
  if (granularity === 'annual') return present.has('FY') ? 'FY' : undefined;
  return GRAIN_ORDER.find((kind) => present.has(kind));
}

function toIsoDate(cell: GridCell): string {
  if (typeof cell !== 'string') return '';
  const parsed = new Date(cell);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
}

/** How periods from different sheets are matched up: by name, ignoring case and punctuation ("FY-2024" = "FY 2024"). */
function periodKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

interface SheetExtraction {
  sheet: string;
  periods: ParsedPeriod[];
  lines: { id: string; section: string; name: string; values: (number | null)[] }[];
}

function extractSheet(grid: SheetGrid, plan: SheetPlan, granularity: Granularity, warnings: string[]): SheetExtraction | null {
  const kind = chooseKind(plan.periodColumns, granularity);
  if (!kind) {
    warnings.push(`Sheet "${plan.sheet}": no actual ${granularity === 'annual' ? 'annual ' : ''}period columns were identified, so it was skipped.`);
    return null;
  }
  const columns = plan.periodColumns.filter((c) => c.actual && c.kind === kind);

  const rowByNumber = new Map(grid.rows.map((row) => [row.rowNumber, row.cells]));
  const cellAt = (rowNumber: number | null, column: string): GridCell =>
    rowNumber === null ? null : (rowByNumber.get(rowNumber)?.[columnIndex(column)] ?? null);

  const periods: ParsedPeriod[] = columns.map((c) => {
    const nameCell = cellAt(plan.nameRow, c.column);
    const date = toIsoDate(cellAt(plan.dateRow, c.column));
    if (!date) warnings.push(`Sheet "${plan.sheet}", column ${c.column}: no readable period-end date.`);
    return { type: kind as ParsedPeriod['type'], date, name: nameCell === null ? c.column : String(nameCell) };
  });

  const labelCol = columnIndex(plan.labelColumn);
  const lines: SheetExtraction['lines'] = [];
  for (const statement of plan.statements) {
    for (let rowNumber = statement.firstRow; rowNumber <= statement.lastRow; rowNumber++) {
      const cells = rowByNumber.get(rowNumber);
      const label = cells?.[labelCol];
      if (typeof label !== 'string') continue;
      const values = columns.map((c) => {
        const value = cells?.[columnIndex(c.column)];
        return typeof value === 'number' ? value : null;
      });
      if (values.every((v) => v === null)) continue; // header / spacer rows carry no data
      lines.push({ id: `${plan.sheet}!row-${rowNumber}`, section: statement.name, name: label, values });
    }
  }
  for (const [i, column] of columns.entries()) {
    if (lines.every((line) => line.values[i] === null)) warnings.push(`Sheet "${plan.sheet}", column ${column.column}: no numbers in any statement row.`);
  }
  return { sheet: plan.sheet, periods, lines };
}

/**
 * Copies historical periods and line items out of the planned regions into the shape the existing template
 * parser produces. Deterministic: no value passes through a model. Zeros are copied as zeros, and non-numeric
 * cells become null — cleanup of placeholder zeros, ratio rows and check rows is left to mapping.
 *
 * Several sheets consolidate into one workbook: periods are matched across sheets by name, and a line gets
 * null for any period its sheet lacks. Mismatches are warned about, never guessed at.
 */
export function extractHistoricals(grids: SheetGrid[], plan: ExtractionPlan, granularity: Granularity = 'annual'): ExtractionResult {
  const warnings: string[] = [];
  const extractions: SheetExtraction[] = [];
  for (const sheetPlan of plan.sheets) {
    const grid = grids.find((g) => g.name === sheetPlan.sheet);
    if (!grid) throw new ExtractionError(`Sheet "${sheetPlan.sheet}" not found.`);
    const extraction = extractSheet(grid, sheetPlan, granularity, warnings);
    if (extraction) extractions.push(extraction);
  }
  if (extractions.length === 0) {
    throw new ExtractionError(granularity === 'annual' ? 'No actual annual period columns were identified.' : 'No actual period columns were identified.');
  }

  // Union of periods across sheets, keyed by name; first sheet to mention a period supplies its type and date.
  const merged = new Map<string, ParsedPeriod>();
  for (const extraction of extractions) {
    for (const period of extraction.periods) {
      const key = periodKey(period.name);
      if (!merged.has(key)) merged.set(key, period);
    }
  }
  const keys = [...merged.keys()];
  const allDated = [...merged.values()].every((p) => p.date !== '');
  if (allDated) keys.sort((a, b) => merged.get(a)!.date.localeCompare(merged.get(b)!.date));

  const lines: ParsedSourceLine[] = [];
  for (const extraction of extractions) {
    const ownKeys = extraction.periods.map((p) => periodKey(p.name));
    if (extractions.length > 1) {
      const missing = keys.filter((k) => !ownKeys.includes(k)).map((k) => merged.get(k)!.name);
      if (missing.length > 0) warnings.push(`Sheet "${extraction.sheet}" has no data for: ${missing.join(', ')}.`);
    }
    for (const line of extraction.lines) {
      lines.push({
        id: line.id,
        section: line.section,
        name: line.name,
        values: keys.map((k) => {
          const i = ownKeys.indexOf(k);
          return i < 0 ? null : line.values[i];
        }),
      });
    }
  }

  if (lines.length === 0) throw new ExtractionError('No line items with numbers were found in the identified statement rows.');
  return { workbook: { periods: keys.map((k) => merged.get(k)!), lines }, warnings };
}
