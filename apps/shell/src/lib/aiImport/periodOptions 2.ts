import type { ExtractionPlan, PeriodColumn, PeriodColumnKind, SheetPlan } from './extractionPlan';
import { columnIndex, type GridCell, type SheetGrid } from './workbookGrid';

/** Which period columns to pull. 'lowest' takes the finest grain present (quarters over years), for when Basis aggregates annuals itself. */
export type Granularity = 'annual' | 'lowest';

/** Period kinds Basis can model. LTM / NTM / Other columns are shown to the user but can't be imported. */
const IMPORTABLE_KINDS: readonly PeriodColumnKind[] = ['FY', 'Quarter', 'Semi-Annual'];
const GRAIN_ORDER: PeriodColumnKind[] = ['Quarter', 'Semi-Annual', 'FY'];

export function isImportableKind(kind: PeriodColumnKind): boolean {
  return IMPORTABLE_KINDS.includes(kind);
}

/** How periods from different sheets are matched up: by name, ignoring case and punctuation ("FY-2024" = "FY 2024"). */
export function periodKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** A period's display name: the plan's name row when it has one there, otherwise the column letter. */
export function periodName(grid: SheetGrid, plan: SheetPlan, column: PeriodColumn): string {
  if (plan.nameRow === null) return column.column;
  const cell: GridCell = grid.rows.find((r) => r.rowNumber === plan.nameRow)?.cells[columnIndex(column.column)] ?? null;
  return cell === null ? column.column : String(cell);
}

/** One selectable period in the review UI — the same period on several sheets is one option. */
export interface PeriodOption {
  key: string;
  name: string;
  kind: PeriodColumnKind;
  actual: boolean;
  /** Reported history of a kind Basis can model. Projections and LTM/NTM columns are listed but not importable. */
  importable: boolean;
}

/** Every period column the plan knows about, de-duplicated by name across sheets, in left-to-right order of first appearance. */
export function periodOptions(grids: SheetGrid[], plan: ExtractionPlan): PeriodOption[] {
  const seen = new Map<string, PeriodOption>();
  for (const sheetPlan of plan.sheets) {
    const grid = grids.find((g) => g.name === sheetPlan.sheet);
    if (!grid) continue;
    for (const column of sheetPlan.periodColumns) {
      const name = periodName(grid, sheetPlan, column);
      const key = periodKey(name);
      if (!seen.has(key)) {
        seen.set(key, { key, name, kind: column.kind, actual: column.actual, importable: column.actual && isImportableKind(column.kind) });
      }
    }
  }
  return [...seen.values()];
}

/** The periods selected by default: the requested grain's reported columns (annuals, or the finest grain present). */
export function defaultPeriodKeys(options: PeriodOption[], granularity: Granularity = 'annual'): Set<string> {
  const importable = options.filter((o) => o.importable);
  const kind = granularity === 'annual' ? importable.find((o) => o.kind === 'FY')?.kind : GRAIN_ORDER.find((k) => importable.some((o) => o.kind === k));
  return new Set(importable.filter((o) => o.kind === kind).map((o) => o.key));
}
