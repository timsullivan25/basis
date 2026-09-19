import { columnIndex, type SheetGrid } from './workbookGrid';

export type LayoutPeriodKind = 'FY' | 'Quarter' | 'Semi-Annual' | 'LTM' | 'NTM' | 'Other';

const PERIOD_KINDS: readonly LayoutPeriodKind[] = ['FY', 'Quarter', 'Semi-Annual', 'LTM', 'NTM', 'Other'];

export interface LayoutPeriodColumn {
  /** Column letter(s) in the source sheet, e.g. "AK". */
  column: string;
  kind: LayoutPeriodKind;
  /** True for reported history, false for projections. */
  actual: boolean;
}

export interface LayoutStatement {
  /** Section name in the Basis Template, e.g. "Income Statement". */
  name: string;
  /** 1-based source rows, inclusive: the first line item through the last (totals included). */
  firstRow: number;
  lastRow: number;
}

/**
 * Where a model's financial statements live — the AI's whole job in the import. Everything after this is
 * deterministic cell copying, so numbers can't be misquoted; the failure mode is "picked the wrong place",
 * which a human confirms at the review step.
 *
 * Single-sheet by design for now: all statements and the period columns are on `sheet`.
 */
export interface LayoutMap {
  sheet: string;
  /** Column holding the line-item names. */
  labelColumn: string;
  /** Source row holding each period's end date / display name, when the sheet has one. */
  dateRow: number | null;
  nameRow: number | null;
  /** Every period column worth knowing about (including projections and LTM/NTM), classified. */
  periodColumns: LayoutPeriodColumn[];
  statements: LayoutStatement[];
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
  /** Other places that looked like plausible financials, so the review step can offer them. */
  alternatives: { sheet: string; note: string }[];
}

export class LayoutMapError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`Invalid layout map: ${issues.join('; ')}`);
    this.issues = issues;
  }
}

/** True when the map should go in front of a human before extraction, rather than being trusted outright. */
export function needsConfirmation(map: LayoutMap): boolean {
  return map.confidence !== 'high' || map.alternatives.length > 0;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRow(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

/** Validates a provider's raw response against the workbook it was about to describe. Throws LayoutMapError listing every problem found. */
export function parseLayoutMap(raw: unknown, grids: SheetGrid[]): LayoutMap {
  const issues: string[] = [];
  if (!isObject(raw)) throw new LayoutMapError(['response is not an object']);

  const sheet = typeof raw.sheet === 'string' ? raw.sheet : '';
  const grid = grids.find((g) => g.name === sheet);
  if (!grid) issues.push(`sheet "${sheet}" does not exist in the workbook`);

  const labelColumn = typeof raw.labelColumn === 'string' ? raw.labelColumn : '';
  if (columnIndex(labelColumn) < 0) issues.push(`labelColumn "${labelColumn}" is not a column letter`);

  const optionalRow = (key: 'dateRow' | 'nameRow'): number | null => {
    const value = raw[key];
    if (value === null || value === undefined) return null;
    if (!isRow(value)) issues.push(`${key} must be a row number or null`);
    return isRow(value) ? value : null;
  };
  const dateRow = optionalRow('dateRow');
  const nameRow = optionalRow('nameRow');

  const periodColumns: LayoutPeriodColumn[] = [];
  if (!Array.isArray(raw.periodColumns) || raw.periodColumns.length === 0) {
    issues.push('periodColumns must be a non-empty array');
  } else {
    for (const entry of raw.periodColumns) {
      if (
        !isObject(entry) ||
        typeof entry.column !== 'string' ||
        columnIndex(entry.column) < 0 ||
        !PERIOD_KINDS.includes(entry.kind as LayoutPeriodKind) ||
        typeof entry.actual !== 'boolean'
      ) {
        issues.push(`invalid periodColumns entry ${JSON.stringify(entry)}`);
        continue;
      }
      periodColumns.push({ column: entry.column, kind: entry.kind as LayoutPeriodKind, actual: entry.actual });
    }
  }

  const statements: LayoutStatement[] = [];
  if (!Array.isArray(raw.statements) || raw.statements.length === 0) {
    issues.push('statements must be a non-empty array');
  } else {
    for (const entry of raw.statements) {
      if (
        !isObject(entry) ||
        typeof entry.name !== 'string' ||
        entry.name.trim() === '' ||
        !isRow(entry.firstRow) ||
        !isRow(entry.lastRow) ||
        entry.firstRow > entry.lastRow
      ) {
        issues.push(`invalid statements entry ${JSON.stringify(entry)}`);
        continue;
      }
      statements.push({ name: entry.name.trim(), firstRow: entry.firstRow, lastRow: entry.lastRow });
    }
  }

  const confidence = raw.confidence;
  if (confidence !== 'high' && confidence !== 'medium' && confidence !== 'low') {
    issues.push('confidence must be "high", "medium" or "low"');
  }

  const alternatives = Array.isArray(raw.alternatives)
    ? raw.alternatives.flatMap((a) =>
        isObject(a) && typeof a.sheet === 'string' ? [{ sheet: a.sheet, note: typeof a.note === 'string' ? a.note : '' }] : [],
      )
    : [];

  if (issues.length > 0) throw new LayoutMapError(issues);
  return {
    sheet,
    labelColumn,
    dateRow,
    nameRow,
    periodColumns,
    statements,
    confidence: confidence as LayoutMap['confidence'],
    reasoning: typeof raw.reasoning === 'string' ? raw.reasoning : '',
    alternatives,
  };
}

/** JSON Schema handed to the provider; mirrors `LayoutMap`. */
export const LAYOUT_MAP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['sheet', 'labelColumn', 'dateRow', 'nameRow', 'periodColumns', 'statements', 'confidence', 'reasoning', 'alternatives'],
  properties: {
    sheet: { type: 'string' },
    labelColumn: { type: 'string', description: 'Column letter holding line-item names' },
    dateRow: { type: ['integer', 'null'], description: 'Row number holding period end dates, or null' },
    nameRow: { type: ['integer', 'null'], description: 'Row number holding period display labels, or null' },
    periodColumns: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['column', 'kind', 'actual'],
        properties: {
          column: { type: 'string' },
          kind: { type: 'string', enum: [...PERIOD_KINDS] },
          actual: { type: 'boolean' },
        },
      },
    },
    statements: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'firstRow', 'lastRow'],
        properties: { name: { type: 'string' }, firstRow: { type: 'integer' }, lastRow: { type: 'integer' } },
      },
    },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    reasoning: { type: 'string' },
    alternatives: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['sheet', 'note'],
        properties: { sheet: { type: 'string' }, note: { type: 'string' } },
      },
    },
  },
} as const;
