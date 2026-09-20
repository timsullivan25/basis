import type { LlmProvider } from './llmProvider';
import { parseSheetPlan, SHEET_PLAN_SCHEMA, type ExtractionPlan, type SheetPlanResult } from './extractionPlan';
import type { SchemaLineIndex } from './schemaLineIndex';
import type { TriageSheet } from './triage';
import { buildSheetWindows, windowsToText } from './windows';
import type { SheetGrid } from './workbookGrid';

const SYSTEM_PROMPT = `You are helping import a company's historical financials from an Excel financial model.
Your job is to write an EXTRACTION PLAN for one sheet — you never transcribe numbers; software will copy the cells you point at.

You are shown the sheet's top rows (period headers usually live there, at full width) and, for every non-empty row, its label cells, how many numbers it holds ("#n"), the first number as a sample, and — when the label matches a known Basis line — that line ("→ Revenue (Income Statement)"). Rows are 1-based ("r310"); columns are letters.

Produce:
- labelColumn: the column holding line-item names (e.g. "Revenue", "Total Assets").
- dateRow / nameRow: rows holding each period's end date and display label (e.g. "FY-2023"), or null if absent.
- periodColumns: EVERY period column on the sheet (history and projections), each classified:
    kind: FY (full fiscal year), Quarter, Semi-Annual, LTM (last twelve months), NTM (next twelve months), or Other.
    actual: true only for reported history; false for projections. Use status headers such as "Actual"/"Proj"/"A"/"E" when present. A column can be labelled actual and still be LTM — classify kind independently of status.
- sections: one entry per BLOCK OF HISTORICAL LINE ITEMS on the sheet. That means the primary statements AND supporting schedules that carry reported history: segment breakouts, KPIs, EBITDA build and adjustments, working capital, debt and capital structure schedules, credit metrics. Name a block with the exact Basis section name when it corresponds to one (the names are given); otherwise use the sheet's own heading for it. firstRow is the first line item after the block's title; lastRow is its last line (totals and check rows included). Sub-headers inside a block (e.g. "Assets", "Liabilities & Equity") stay inside one range. A block ends where the next block begins — use the row labels to find that boundary — and ranges must not overlap.
  groups (inside each section): when a section has titled sub-blocks — a segment's block, a debt sub-block such as "Ending Debt Balance", "Revenue by Geography" — list each as a group so lines that share a label (e.g. "Revenue" under several segments, a tranche name under several sub-blocks) can be told apart. A group is a title, the header row that introduces it (it carries no numbers), and the inclusive range of its rows. Headers usually have a name and no numbers, often in a shallower label column than the lines under them; a header ends at the next header of the same or shallower depth. Groups may nest: list the inner group separately, with a range inside its parent's. Use the header's text as the title, cleaned of trailing colons. Use an empty groups list when a section's labels are already unambiguous.
  Leave OUT: assumptions and input tables, projection drivers, scenario or case selectors, valuation, returns or comps analysis, and anything that only holds forecasts.
- confidence: "high" only if every choice above was clear from what you were shown.
- reasoning: two or three sentences a human can check.
- openQuestions: anything you could not settle from what you were shown (empty if none).`;

/** Asks the provider for a per-sheet extraction plan from top-row and label windows; one call per sheet. Each answer is validated against its sheet. */
export async function planSheets(
  provider: LlmProvider,
  grids: SheetGrid[],
  index: SchemaLineIndex,
  chosen: TriageSheet[],
  sectionNames: string[],
): Promise<ExtractionPlan> {
  const results: SheetPlanResult[] = await Promise.all(
    chosen.map(async ({ name, sections }) => {
      const grid = grids.find((g) => g.name === name);
      if (!grid) throw new Error(`Sheet "${name}" not found.`);
      const raw = await provider.generateStructured({
        system: SYSTEM_PROMPT,
        prompt: `Basis section names: ${sectionNames.join(', ')}\nSections the triage step expects on this sheet: ${sections.join(', ') || '(none listed)'}\n\n${windowsToText(buildSheetWindows(grid, index))}`,
        schemaName: 'sheet_extraction_plan',
        schema: SHEET_PLAN_SCHEMA,
      });
      return parseSheetPlan(raw, name, grids);
    }),
  );
  return { sheets: results.map((r) => r.plan), results };
}
