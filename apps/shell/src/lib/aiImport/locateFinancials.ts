import type { LlmProvider } from './llmProvider';
import { LAYOUT_MAP_SCHEMA, parseLayoutMap, type LayoutMap } from './layoutMap';
import { buildOutline } from './outline';
import type { SheetGrid } from './workbookGrid';

const SYSTEM_PROMPT = `You are helping import a company's historical financial statements from an arbitrary Excel financial model.
Your only job is to LOCATE the statements — you never transcribe numbers. Software will copy the cells you point at.

You are given an outline of every sheet: the top rows verbatim (period headers usually live there) and the labels of header-like rows below.
Rows are 1-based ("r310"); columns are letters. Respond with a layout map:

- sheet: the single sheet holding the primary Income Statement, Balance Sheet and Cash Flow Statement (they normally sit together, one under another). Prefer the working model over summary or output sheets. List any other sheet that also looked like plausible financials under "alternatives".
- labelColumn: the column containing line-item names (e.g. "Revenue", "Total Assets").
- dateRow / nameRow: rows holding each period's end date and display label (e.g. "FY-2023"), or null if absent.
- periodColumns: EVERY period column in the model (history and projections), each classified:
    kind: FY (full fiscal year), Quarter, Semi-Annual, LTM (last twelve months), NTM (next twelve months), or Other.
    actual: true only for reported history; false for projections/forecasts. Use status headers such as "Actual"/"Proj"/"A"/"E" when present. A column can be labelled actual and still be LTM — classify kind independently.
- statements: one entry per statement found, using the names "Income Statement", "Balance Sheet", "Cash Flow Statement". firstRow is the first line item after the statement's header; lastRow is its last line (totals and check rows included). Sub-headers inside a statement (e.g. "Assets", "Liabilities & Equity") stay inside one range.
- confidence: "high" only if there is one unambiguous location. Use "medium"/"low" if you had to guess, the layout is unusual, or several sheets could plausibly be the primary financials.
- reasoning: two or three sentences a human can check.`;

/** Asks the provider where a workbook's financials are, and validates the answer against the workbook. Throws LayoutMapError if the answer is malformed or points outside the file. */
export async function locateFinancials(provider: LlmProvider, grids: SheetGrid[]): Promise<LayoutMap> {
  const raw = await provider.generateStructured({
    system: SYSTEM_PROMPT,
    prompt: `Workbook outline:\n\n${buildOutline(grids)}`,
    schemaName: 'financials_layout_map',
    schema: LAYOUT_MAP_SCHEMA,
  });
  return parseLayoutMap(raw, grids);
}
