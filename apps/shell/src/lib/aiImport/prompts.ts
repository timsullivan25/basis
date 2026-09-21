import { loadAiSettings } from './aiSettings';

export type PromptId = 'triage' | 'plan' | 'fill' | 'consolidate' | 'checks' | 'subLines';

export interface PromptDef {
  id: PromptId;
  label: string;
  /** Which part of the flow it belongs to, for grouping in Settings. */
  group: 'import' | 'mapping' | 'structure';
  description: string;
  /** Where in the app it runs. */
  usedBy: string;
  /** The instructions the model gets. The response format is fixed in code and checked after, so wording can change freely. */
  defaultText: string;
}

/** Every instruction the AI import sends to the model, in the order a run uses them. */
export const PROMPTS: PromptDef[] = [
  {
    id: 'triage',
    label: 'Triage sheets',
    group: 'import',
    description: 'Decides which sheet or sheets hold the historical financials.',
    usedBy: 'Import, step 1',
    defaultText: `You are helping import a company's historical financials from an arbitrary Excel financial model.
Step one: decide WHICH SHEETS hold the historical financials: the three primary statements (Income Statement, Balance Sheet, Cash Flow Statement) and any supporting schedules of historical line items (segment breakouts, KPIs, EBITDA build and adjustments, working capital, debt and capital structure, credit metrics). You are shown one line of facts per sheet.

The facts include how many distinct Basis lines (Revenue, Total Assets, Net Income, ...) appear as row labels on the sheet, grouped by Basis section. Treat them as hints, not answers:
- Analysis and output sheets (valuation, LBO, comps, summaries, charts) often reproduce a handful of lines. The sheet where the financials are BUILT — the working model — is usually the one with the most matches, and the one to prefer.
- Choose layout "single" when one sheet holds the financials (typically stacked one section under another), and list it.
- Choose "multiple" only when they are genuinely split across sheets (e.g. one tab per statement), and list each.
- Choose "none" if nothing looks like historical financials.
- For each chosen sheet, list the sections it holds: use the exact Basis section names given where a block corresponds to one, and add any other schedule of historical line items under the sheet's own heading.
- Do not choose sheets that only hold projections, scenarios, market data or presentation output. Prefer visible sheets.
- confidence is "high" only when the choice is unambiguous. Put other plausible sheets under "alternatives" with a short note.
- reasoning: two or three sentences a human can check.`,
  },
  {
    id: 'plan',
    label: 'Extraction plan',
    group: 'import',
    description: 'Plans, for one sheet, the label column, period columns, statement blocks and their groups.',
    usedBy: 'Import, step 2',
    defaultText: `You are helping import a company's historical financials from an Excel financial model.
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
- openQuestions: anything you could not settle from what you were shown (empty if none).`,
  },
  {
    id: 'fill',
    label: 'Fill: unmapped lines',
    group: 'mapping',
    description: 'Places unmapped and tied target lines onto imported lines.',
    usedBy: 'Review with AI, pass 1',
    defaultText: `You are helping map the line items of an imported financial model onto a company's standard statement lines.
Exact, alias and fuzzy name matching have already been tried and failed (or found several equally good candidates) for the target lines below. Your job is to find the imported line that belongs on each one.

Rules:
- Answer only with ids from the lists you are given. Never invent an id.
- Choose the imported line that reports the same thing as the target, judging by its name, its group, its section, and its latest value. A group is the sub-heading the line sits under in the source file, so "Academia > Revenue" is segment revenue, not total revenue.
- Prefer one imported line. Give several only when the target is genuinely the sum of them (for example a target "Cash" made up of "Cash" and "Restricted cash").
- Do not choose a line marked as already used by another target.
- If nothing fits, return an empty "sources" list for that target. An empty answer is better than a guess.
- Do not map subtotals or totals onto a component line, or the reverse.
- confidence is "high" only when you would be surprised to be wrong. "reason" is one short sentence a reviewer can check.`,
  },
  {
    id: 'consolidate',
    label: 'Consolidate: leftover lines',
    group: 'mapping',
    description: 'Adds unmapped imported lines onto an existing weak match.',
    usedBy: 'Review with AI, pass 2',
    defaultText: `You are helping finish mapping an imported financial model onto a company's standard statement lines.
Each standard ("target") line below is already mapped to zero or more imported lines, which are added together. Some imported lines from the same statement are still unmapped. Decide which unmapped lines are further components of a target line and should be ADDED to what it already sums.

Rules:
- Answer only with target ids and imported-line ids you are given. Never invent an id.
- Add an unmapped line to a target only when it is part of the same thing the target reports. Examples: "Goodwill" added to a target "Goodwill & Intangibles" that is mapped only to "Intangible Assets"; "Restricted Cash" added to "Cash & Equivalents"; "Other Long-Term Debt" added to a "Debt" target that has one tranche; an unmapped add-back added to an EBITDA adjustments line.
- Do not add totals, subtotals, ratios, percentages, per-share figures or other memo lines. A line that reads like a subtotal of lines already mapped is not a component.
- Do not add a line just because it is unmapped. Many unmapped lines belong to no target; leave them.
- A line can be added to only one target.
- If a target already represents everything it should, add nothing to it. Returning no additions at all is a fine answer.
- confidence is "high" only when the line clearly belongs. "reason" is one short sentence a reviewer can check.`,
  },
  {
    id: 'checks',
    label: 'Checks: close a failing check',
    group: 'mapping',
    description: 'Adds, removes or moves lines to close a failing check, up to three rounds.',
    usedBy: 'Review with AI, pass 3',
    defaultText: `You are helping fix the mapping of an imported financial model onto a company's standard statement lines. A check that should equal zero does not, so the mapping is probably wrong or incomplete somewhere in this statement.

Each target line below is mapped to zero or more imported lines, which are added together. You may change that: ADD an unmapped imported line to a target, REMOVE an imported line from a target (only targets marked removable), or MOVE a line by removing it from one target and adding it to another.

Rules:
- Answer only with target ids and imported-line ids you are given. Never invent an id.
- Use the numbers. The gap is what is missing or double counted; a change should move the gap toward zero. You are told what earlier attempts did to the gap — do not repeat one that made it worse.
- Every change must also make sense on its own. A line goes on a target because it is that kind of item, never only because the numbers tie: debt does not belong in an operating liability, and a subtotal is not a component.
- Prefer the smallest change that explains the gap. Do not remap lines that look correct.
- Remove a line only when it looks wrongly placed, and say why.
- If you can see no sensible change, return no changes. That is a fine answer.
- confidence is "high" only when the change clearly belongs. "reason" is one short sentence a reviewer can check.`,
  },
  {
    id: 'subLines',
    label: 'Sub-lines',
    group: 'structure',
    description: 'Proposes sub-lines (segments, adjustments, debt tranches) under parent lines.',
    usedBy: 'Suggest sub-lines',
    defaultText: `You are helping fit an imported financial model onto a company's standard statement structure.
The standard statement has some "parent" lines that break down into sub-lines: revenue splits into segments, EBITDA splits into adjustments, and each debt class (secured, unsecured, ...) splits into its tranches. Some imported lines were not matched to any standard line. Decide which of those left-over lines are the sub-lines of which parent, and propose them.

Rules:
- Answer only with parent ids and imported-line ids you are given. Never invent an id.
- Propose a sub-line only when imported lines clearly break down that parent. Focus on: revenue by segment, product or geography under a revenue parent; the matching cost of revenue by that same segment under a cost-of-revenue parent; add-backs and adjustments under an EBITDA delta line; individual loans, notes and revolvers under a debt class.
- Cost of revenue is only broken down by segments that revenue is also broken down by. If the file gives no revenue breakdown, propose none for cost of revenue.
- Ignore segment-level EBITDA, margin, gross profit and growth lines: they are calculations, not components.
- Imported lines are shown in clusters by the group they sit under in the file. A group with several lines is the strongest sign of a breakdown, so consider each group before single lines.
- A sub-line's name is a clean, short label (for example "Academia", "Restructuring", "Term Loan B"). Do not include the group or section in it.
- One sub-line normally comes from one imported line. Use several only when they are pieces of the same item.
- Use each imported line at most once. Do not use lines marked as used.
- Do not propose sub-lines for totals or subtotals, ratios, or lines that belong on a standard line of their own.
- If nothing fits a parent, propose nothing for it. No proposals at all is a fine answer.
- confidence is "high" only when the breakdown is obvious. "reason" is one short sentence a reviewer can check.`,
  },
];

/** The prompt a run should use: the user's edit from Settings, or the built-in default. */
export function getPrompt(id: PromptId): string {
  const override = loadAiSettings().prompts[id];
  return override !== undefined && override.trim() !== '' ? override : (PROMPTS.find((p) => p.id === id)?.defaultText ?? '');
}
