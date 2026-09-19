import type { LlmProvider } from './llmProvider';
import { parseSheetPlan, SHEET_PLAN_SCHEMA, type ExtractionPlan, type SheetPlanResult } from './extractionPlan';
import type { SchemaLineIndex } from './schemaLineIndex';
import type { TriageSheet } from './triage';
import { buildSheetWindows, windowsToText } from './windows';
import type { SheetGrid } from './workbookGrid';

const SYSTEM_PROMPT = `You are helping import a company's historical financial statements from an Excel financial model.
Your job is to write an EXTRACTION PLAN for one sheet — you never transcribe numbers; software will copy the cells you point at.

You are shown the sheet's top rows (period headers usually live there, at full width) and, for every non-empty row, its label cells, how many numbers it holds ("#n"), the first number as a sample, and — when the label matches a known Basis line — that line ("→ Revenue (Income Statement)"). Rows are 1-based ("r310"); columns are letters.

Produce:
- labelColumn: the column holding line-item names (e.g. "Revenue", "Total Assets").
- dateRow / nameRow: rows holding each period's end date and display label (e.g. "FY-2023"), or null if absent.
- periodColumns: EVERY period column on the sheet (history and projections), each classified:
    kind: FY (full fiscal year), Quarter, Semi-Annual, LTM (last twelve months), NTM (next twelve months), or Other.
    actual: true only for reported history; false for projections. Use status headers such as "Actual"/"Proj"/"A"/"E" when present. A column can be labelled actual and still be LTM — classify kind independently of status.
- statements: one entry per requested statement present on this sheet, named exactly as requested. firstRow is the first line item after the statement's title; lastRow is its last line (totals and check rows included). Sub-headers inside a statement (e.g. "Assets", "Liabilities & Equity") stay inside one range. A statement ends where the next section (a different schedule or analysis) begins — look at the row labels to find that boundary.
- confidence: "high" only if every choice above was clear from what you were shown.
- reasoning: two or three sentences a human can check.
- openQuestions: anything you could not settle from what you were shown (empty if none).`;

/** Asks the provider for a per-sheet extraction plan from top-row and label windows; one call per sheet. Each answer is validated against its sheet. */
export async function planSheets(
  provider: LlmProvider,
  grids: SheetGrid[],
  index: SchemaLineIndex,
  chosen: TriageSheet[],
): Promise<ExtractionPlan> {
  const results: SheetPlanResult[] = await Promise.all(
    chosen.map(async ({ name, statements }) => {
      const grid = grids.find((g) => g.name === name);
      if (!grid) throw new Error(`Sheet "${name}" not found.`);
      const raw = await provider.generateStructured({
        system: SYSTEM_PROMPT,
        prompt: `Requested statements on this sheet: ${statements.join(', ')}\n\n${windowsToText(buildSheetWindows(grid, index))}`,
        schemaName: 'sheet_extraction_plan',
        schema: SHEET_PLAN_SCHEMA,
      });
      return parseSheetPlan(raw, name, grids);
    }),
  );
  return { sheets: results.map((r) => r.plan), results };
}
