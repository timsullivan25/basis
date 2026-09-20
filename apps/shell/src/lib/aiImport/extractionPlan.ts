import { columnIndex, type SheetGrid } from './workbookGrid';

export type PeriodColumnKind = 'FY' | 'Quarter' | 'Semi-Annual' | 'LTM' | 'NTM' | 'Other';

const PERIOD_KINDS: readonly PeriodColumnKind[] = ['FY', 'Quarter', 'Semi-Annual', 'LTM', 'NTM', 'Other'];

export interface PeriodColumn {
  /** Column letter(s) in the source sheet, e.g. "AK". */
  column: string;
  kind: PeriodColumnKind;
  /** True for reported history, false for projections. */
  actual: boolean;
}

/** One block of historical line items on a sheet — a primary statement or a supporting schedule (segments, KPIs, debt, ...). */
export interface SectionRange {
  /** Section name in the Basis Template: the exact Basis section name when the block corresponds to one (e.g. "Income Statement", "EBITDA"), otherwise the sheet's own heading (e.g. "Segment Breakout"). */
  name: string;
  /** 1-based source rows, inclusive: the first line item through the last (totals included). */
  firstRow: number;
  lastRow: number;
}

/** How to read one sheet: everything the executor needs, none of the values. */
export interface SheetPlan {
  sheet: string;
  /** Column holding the line-item names. */
  labelColumn: string;
  /** Source row holding each period's end date / display name, when the sheet has one. */
  dateRow: number | null;
  nameRow: number | null;
  /** Every period column worth knowing about (including projections and LTM/NTM), classified. */
  periodColumns: PeriodColumn[];
  sections: SectionRange[];
}

/** The LLM's answer for one sheet, with what a human needs to judge it. */
export interface SheetPlanResult {
  plan: SheetPlan;
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
  /** Things the model could not settle from the windows it was shown; surfaced at review. */
  openQuestions: string[];
}

/** Everything code needs to copy the historicals out of a workbook. Sheets are consolidated into one template, periods aligned by name. */
export interface ExtractionPlan {
  sheets: SheetPlan[];
  results: SheetPlanResult[];
}

export class PlanError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`Invalid plan: ${issues.join('; ')}`);
    this.issues = issues;
  }
}

/** True when a human should look at the plan before extraction: any sheet below high confidence, or with open questions. */
export function planNeedsConfirmation(results: SheetPlanResult[]): boolean {
  return results.some((r) => r.confidence !== 'high' || r.openQuestions.length > 0);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRow(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

/** Validates a provider's raw plan for one sheet against that sheet. Throws PlanError listing every problem found. */
export function parseSheetPlan(raw: unknown, expectedSheet: string, grids: SheetGrid[]): SheetPlanResult {
  const issues: string[] = [];
  if (!isObject(raw)) throw new PlanError(['response is not an object']);

  const sheet = typeof raw.sheet === 'string' ? raw.sheet : '';
  if (sheet !== expectedSheet) issues.push(`plan is for sheet "${sheet}" but "${expectedSheet}" was asked about`);
  if (!grids.some((g) => g.name === sheet)) issues.push(`sheet "${sheet}" does not exist in the workbook`);

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

  const periodColumns: PeriodColumn[] = [];
  if (!Array.isArray(raw.periodColumns) || raw.periodColumns.length === 0) {
    issues.push('periodColumns must be a non-empty array');
  } else {
    for (const entry of raw.periodColumns) {
      if (
        !isObject(entry) ||
        typeof entry.column !== 'string' ||
        columnIndex(entry.column) < 0 ||
        !PERIOD_KINDS.includes(entry.kind as PeriodColumnKind) ||
        typeof entry.actual !== 'boolean'
      ) {
        issues.push(`invalid periodColumns entry ${JSON.stringify(entry)}`);
        continue;
      }
      periodColumns.push({ column: entry.column, kind: entry.kind as PeriodColumnKind, actual: entry.actual });
    }
  }

  const sections: SectionRange[] = [];
  if (!Array.isArray(raw.sections) || raw.sections.length === 0) {
    issues.push('sections must be a non-empty array');
  } else {
    for (const entry of raw.sections) {
      if (
        !isObject(entry) ||
        typeof entry.name !== 'string' ||
        entry.name.trim() === '' ||
        !isRow(entry.firstRow) ||
        !isRow(entry.lastRow) ||
        entry.firstRow > entry.lastRow
      ) {
        issues.push(`invalid sections entry ${JSON.stringify(entry)}`);
        continue;
      }
      sections.push({ name: entry.name.trim(), firstRow: entry.firstRow, lastRow: entry.lastRow });
    }
  }

  const confidence = raw.confidence;
  if (confidence !== 'high' && confidence !== 'medium' && confidence !== 'low') {
    issues.push('confidence must be "high", "medium" or "low"');
  }

  if (issues.length > 0) throw new PlanError(issues);
  return {
    plan: { sheet, labelColumn, dateRow, nameRow, periodColumns, sections },
    confidence: confidence as SheetPlanResult['confidence'],
    reasoning: typeof raw.reasoning === 'string' ? raw.reasoning : '',
    openQuestions: Array.isArray(raw.openQuestions) ? raw.openQuestions.filter((q): q is string => typeof q === 'string') : [],
  };
}

/** JSON Schema handed to the provider; mirrors `SheetPlanResult`. */
export const SHEET_PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['sheet', 'labelColumn', 'dateRow', 'nameRow', 'periodColumns', 'sections', 'confidence', 'reasoning', 'openQuestions'],
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
    sections: {
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
    openQuestions: { type: 'array', items: { type: 'string' } },
  },
} as const;
