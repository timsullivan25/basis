import type { ParsedPeriod, ParsedSourceLine, ParsedWorkbook } from '../../data';
import type { ExtractionPlan, PeriodColumn, SectionGroup, SheetPlan } from './extractionPlan';
import { defaultPeriodKeys, isImportableKind, periodKey, periodName, periodOptions, type Granularity } from './periodOptions';
import { sourceLineLabel } from '../sourceLineLabel';
import { columnIndex, type GridCell, type SheetGrid } from './workbookGrid';

export type { Granularity } from './periodOptions';

/** Which periods to import: a granularity preset, or an explicit set of period keys (see periodOptions). */
export type PeriodChoice = Granularity | { keys: ReadonlySet<string> };

export interface ExtractionResult {
  workbook: ParsedWorkbook;
  /** Things worth a human glance at review — never blocking. */
  warnings: string[];
}

export class ExtractionError extends Error {}

function toIsoDate(cell: GridCell): string {
  if (typeof cell !== 'string') return '';
  const parsed = new Date(cell);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
}

/** Titles of the groups whose row range contains this row, outermost first — how a repeated label gets its context. */
function groupPath(rowNumber: number, groups: SectionGroup[]): string[] {
  return groups
    .filter((g) => rowNumber >= g.firstRow && rowNumber <= g.lastRow)
    .sort((a, b) => a.firstRow - b.firstRow || b.lastRow - a.lastRow)
    .map((g) => g.title);
}

/** Two groups where neither contains the other but they share rows — the nesting is ambiguous. */
function partialOverlaps(groups: SectionGroup[]): [SectionGroup, SectionGroup][] {
  const pairs: [SectionGroup, SectionGroup][] = [];
  groups.forEach((a, i) =>
    groups.slice(i + 1).forEach((b) => {
      const shares = a.firstRow <= b.lastRow && b.firstRow <= a.lastRow;
      const nested = (a.firstRow <= b.firstRow && a.lastRow >= b.lastRow) || (b.firstRow <= a.firstRow && b.lastRow >= a.lastRow);
      if (shares && !nested) pairs.push([a, b]);
    }),
  );
  return pairs;
}

interface SheetExtraction {
  sheet: string;
  periods: ParsedPeriod[];
  lines: { id: string; section: string; group?: string; name: string; values: (number | null)[] }[];
}

function extractSheet(grid: SheetGrid, plan: SheetPlan, keys: ReadonlySet<string>, warnings: string[]): SheetExtraction | null {
  const columns: PeriodColumn[] = plan.periodColumns.filter((c) => c.actual && isImportableKind(c.kind) && keys.has(periodKey(periodName(grid, plan, c))));
  if (columns.length === 0) {
    warnings.push(`Sheet "${plan.sheet}": none of the selected periods are on this sheet, so it was skipped.`);
    return null;
  }

  const rowByNumber = new Map(grid.rows.map((row) => [row.rowNumber, row.cells]));
  const cellAt = (rowNumber: number | null, column: string): GridCell =>
    rowNumber === null ? null : (rowByNumber.get(rowNumber)?.[columnIndex(column)] ?? null);

  const periods: ParsedPeriod[] = columns.map((c) => {
    const date = toIsoDate(cellAt(plan.dateRow, c.column));
    if (!date) warnings.push(`Sheet "${plan.sheet}", column ${c.column}: no readable period-end date.`);
    return { type: c.kind as ParsedPeriod['type'], date, name: periodName(grid, plan, c) };
  });

  const labelCol = columnIndex(plan.labelColumn);
  const lines: SheetExtraction['lines'] = [];
  const claimed = new Map<number, string>();
  for (const section of plan.sections) {
    for (let rowNumber = section.firstRow; rowNumber <= section.lastRow; rowNumber++) {
      const previous = claimed.get(rowNumber);
      if (previous !== undefined) {
        warnings.push(`Sheet "${plan.sheet}", row ${rowNumber}: in both "${previous}" and "${section.name}" — imported twice.`);
      }
      claimed.set(rowNumber, section.name);
      const cells = rowByNumber.get(rowNumber);
      const label = cells?.[labelCol];
      if (typeof label !== 'string') continue;
      const values = columns.map((c) => {
        const value = cells?.[columnIndex(c.column)];
        return typeof value === 'number' ? value : null;
      });
      if (values.every((v) => v === null)) continue; // header / spacer rows carry no data
      const group = groupPath(rowNumber, section.groups).join(' › ');
      lines.push({ id: `${plan.sheet}!row-${rowNumber}`, section: section.name, ...(group ? { group } : {}), name: label, values });
    }
  }
  for (const section of plan.sections) {
    for (const [a, b] of partialOverlaps(section.groups)) {
      warnings.push(`Sheet "${plan.sheet}", section "${section.name}": groups "${a.title}" and "${b.title}" overlap without nesting.`);
    }
    const names = lines.filter((l) => l.section === section.name).map(sourceLineLabel);
    const repeated = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))];
    if (repeated.length > 0) {
      warnings.push(`Sheet "${plan.sheet}", section "${section.name}": ${repeated.length} repeated line name${repeated.length === 1 ? '' : 's'} (e.g. "${repeated[0]}") — a group may be missing.`);
    }
  }
  for (const [i, column] of columns.entries()) {
    if (lines.every((line) => line.values[i] === null)) warnings.push(`Sheet "${plan.sheet}", column ${column.column}: no numbers in any planned section.`);
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
export function extractHistoricals(grids: SheetGrid[], plan: ExtractionPlan, choice: PeriodChoice = 'annual'): ExtractionResult {
  const warnings: string[] = [];
  const selected = typeof choice === 'string' ? defaultPeriodKeys(periodOptions(grids, plan), choice) : choice.keys;
  const extractions: SheetExtraction[] = [];
  for (const sheetPlan of plan.sheets) {
    const grid = grids.find((g) => g.name === sheetPlan.sheet);
    if (!grid) throw new ExtractionError(`Sheet "${sheetPlan.sheet}" not found.`);
    const extraction = extractSheet(grid, sheetPlan, selected, warnings);
    if (extraction) extractions.push(extraction);
  }
  if (extractions.length === 0) {
    throw new ExtractionError(selected.size === 0 ? 'No periods are selected.' : 'None of the selected periods were found in the planned sheets.');
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
        ...(line.group ? { group: line.group } : {}),
        name: line.name,
        values: keys.map((k) => {
          const i = ownKeys.indexOf(k);
          return i < 0 ? null : line.values[i];
        }),
      });
    }
  }

  if (lines.length === 0) throw new ExtractionError('No line items with numbers were found in the planned sections.');
  return { workbook: { periods: keys.map((k) => merged.get(k)!), lines }, warnings };
}
