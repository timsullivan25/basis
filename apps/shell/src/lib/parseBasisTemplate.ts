import type * as XLSXType from 'xlsx';
import type { ParsedPeriod, ParsedSourceLine, ParsedWorkbook, PeriodType } from '../data';

const SHEET_NAME = 'Basis Template';

// Layout: column A = section (sticky down the column), column B = group (optional
// sub-block title, blank for most rows), column C = line name, column D onward = one
// period per column. Rows 1-3 (index 0-2) of the period columns hold type/date/name;
// line data starts at row 4 (index 3).
const SECTION_COL = 0;
const GROUP_COL = 1;
const NAME_COL = 2;
const PERIOD_START_COL = 3;
const PERIOD_TYPE_ROW = 0;
const PERIOD_DATE_ROW = 1;
const PERIOD_NAME_ROW = 2;
const DATA_START_ROW = 3;

export class TemplateParseError extends Error {}

function cell(grid: unknown[][], row: number, col: number): unknown {
  return grid[row]?.[col];
}

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || String(value).trim() === '';
}

function normalizePeriodType(raw: unknown): PeriodType {
  const s = String(raw ?? '').trim().toLowerCase();
  if (s.startsWith('q')) return 'Quarter';
  if (s.startsWith('semi') || s === 'h1' || s === 'h2') return 'Semi-Annual';
  return 'FY';
}

function normalizeDate(raw: unknown, XLSX: typeof XLSXType): string {
  if (raw instanceof Date) return raw.toISOString();
  if (typeof raw === 'number') {
    const parsed = XLSX.SSF.parse_date_code(raw);
    if (parsed) return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d)).toISOString();
  }
  if (typeof raw === 'string' && raw.trim()) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return '';
}

function normalizeValue(raw: unknown): number | null {
  if (typeof raw === 'number') return raw;
  if (isBlank(raw)) return null;
  const parsed = Number(raw);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Parses a "Basis Template" sheet into periods + source lines. Throws TemplateParseError on a shape mismatch. */
export async function parseBasisTemplate(file: Blob): Promise<ParsedWorkbook> {
  // Loaded on demand — xlsx is a large library that only the mapping screen needs.
  const XLSX = await import('xlsx');
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
  const sheet = workbook.Sheets[SHEET_NAME];
  if (!sheet) {
    throw new TemplateParseError(`No "${SHEET_NAME}" sheet found in the uploaded file.`);
  }

  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null });

  const periods: ParsedPeriod[] = [];
  for (let col = PERIOD_START_COL; ; col++) {
    const name = cell(grid, PERIOD_NAME_ROW, col);
    if (isBlank(name)) break;
    periods.push({
      type: normalizePeriodType(cell(grid, PERIOD_TYPE_ROW, col)),
      date: normalizeDate(cell(grid, PERIOD_DATE_ROW, col), XLSX),
      name: String(name).trim(),
    });
  }
  if (periods.length === 0) {
    throw new TemplateParseError('No periods found starting in column D, rows 1-3.');
  }

  const lines: ParsedSourceLine[] = [];
  let currentSection = '';
  for (let row = DATA_START_ROW; row < grid.length; row++) {
    const sectionCell = cell(grid, row, SECTION_COL);
    if (!isBlank(sectionCell)) currentSection = String(sectionCell).trim();

    const nameCell = cell(grid, row, NAME_COL);
    if (isBlank(nameCell)) continue;

    const groupCell = cell(grid, row, GROUP_COL);
    lines.push({
      id: `row-${row}`,
      section: currentSection,
      ...(isBlank(groupCell) ? {} : { group: String(groupCell).trim() }),
      name: String(nameCell).trim(),
      values: periods.map((_, i) => normalizeValue(cell(grid, row, PERIOD_START_COL + i))),
    });
  }
  if (lines.length === 0) {
    throw new TemplateParseError('No line items found below the period header rows.');
  }

  return { periods, lines };
}
