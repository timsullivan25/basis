# AI import — design

Status: **in progress on `feature/ai-import`.** Goal of the first pass: take a generic (non-template) Excel
financial model, extract its **historical** statements into the Basis Template shape, and feed that through
the existing mapping flow unchanged. Everything else (below, "Deferred") is intentionally later.

## Principle

Code reads, measures, cuts and executes. The LLM interprets and plans. Anything code computes that *looks*
like a judgment (alias hits, balance checks, density) is passed on as **evidence or a warning, never a gate**.
The LLM never transcribes numbers — it produces a plan, and code copies the cells.

## Flow

| # | Step | Who | What |
|---|---|---|---|
| 1 | Read workbook | Code | Parse every sheet, trim to its used range (dimensions, hidden flag). |
| 2 | Sheet evidence | Code | Per sheet: scan text in the left columns against the Basis schema's line names and aliases (exact match only); record distinct lines hit, grouped by schema section; numeric density; whether the top rows look like period headers. Evidence only. |
| 3 | Triage | LLM | Given sheet names + evidence: one sheet or several holds the historical statements? Which sheets, which statements on each? Confidence, alternatives. |
| 4 | Confirm sheets | User | Only when confidence < high or alternatives exist. |
| 5 | Cut windows | Code | Per chosen sheet: the **top rows** at full width (period headers) and the **left columns** at full height (labels), with per-row number count, one sample value, and inline alias annotation. No other numbers are sent. |
| 6 | Extraction plan | LLM | Label column, header rows, period columns (kind, actual/projected), statement row ranges, confidence, open questions. Schema-validated. |
| 7 | Plan check | Code, advisory | Ranges/columns exist, dates parse, each period column has numbers, ranges don't overlap; signals such as alias density inside vs outside ranges and whether the balance sheet balances. On failure: one targeted LLM follow-up with the specific issue and rows, max two rounds, then a human. |
| 8 | Confirm plan | User | Plan + data preview + warnings; edits go back into the plan. |
| 9 | Execute | Code | Copy cells per the plan; write the Basis Template. Multiple sheets merge into one template with a section per statement, **periods aligned by name**; anything unaligned is flagged, not guessed. |
| 10 | Mapping | Existing | The normal import flow. |

The original upload is stored as the root file (name and blob); the generated template sits alongside it.

## Decisions

- Annual actuals first. Later: import the lowest grain (quarters over years) and let Basis aggregate.
- Zeros import as zeros. Ratio and Check rows import as-is — mapping sorts them out.
- Cross-sheet period alignment is by **period name** (as written in the sheet).
- Provider seam: `LlmProvider` (`generateStructured`) so model/vendor is swappable; `FakeLlmProvider` for tests.
- The API key never reaches the browser: dev-server proxy reading `.env.local` (not built yet).

## Deferred

Units/scale detection, duplicate/version-sheet handling, sign convention, debt/segment sub-lines (importer may
propose schema additions), projections, post-mapping AI checks (flag errors, suggest fits with confidence).

## Modules (`apps/shell/src/lib/aiImport/`)

| Module | Step |
|---|---|
| `workbookGrid.ts` | 1 |
| `schemaLineIndex.ts`, `sheetEvidence.ts` | 2 |
| `triage.ts` | 3 (prompt, schema, validation, confirm rule) |
| `windows.ts` | 5 |
| `extractionPlan.ts`, `planSheets.ts` | 6 (plan shape + validation, one prompt per sheet) |
| `extractHistoricals.ts`, `writeBasisTemplate.ts` | 9 (multi-sheet, periods aligned by name) |
| `llmProvider.ts`, `fakeLlmProvider.ts` | provider seam |

UI: `components/models/aiImport/` — a full-viewport, three-step screen (`AiImportScreen`) with the same step
tracker as mapping (`ImportStepper`), opened from `FinancialsTab` when Create Model's "Extract with AI" option is
chosen. 1 **Choose sheets** (model's pick preselected; changing it re-plans on Next). 2 **Choose data**: period
types and individual periods (projections and LTM/NTM shown but never imported; types may be mixed), then a
section list beside a **worksheet viewer** (`SheetViewer`) that shows the label column and the chosen period
columns, tints and outlines the section, and lets its top and bottom edges be dragged (snapping to real rows,
auto-scrolling near the edges); sections can be switched off and flipped through. 3 **Preview** what mapping will
receive, with warnings, Download template, and Continue to mapping. `analyzeWorkbook.ts` orchestrates steps 1-3
and 5-6 of the pipeline. `ModelImport.originalFile` keeps the user's upload as the root file/name while `file`
holds the generated template (so Edit mapping re-parses the template unchanged).

`provider.ts` is the one place that picks the model; it returns a dev-only `DemoLlmProvider` (recognizes one
private test workbook by sheet name) until a real adapter exists.

Triage flags the sheet choice only when confidence is below high; alternatives are shown as information.

Scope: the plan covers every **block of historical line items** on a sheet — the three primary statements and
supporting schedules (segments, KPIs, EBITDA build, working capital, debt, credit metrics, ...). A block that
matches a Basis section is written under that exact name; otherwise under the sheet's own heading. Assumptions,
drivers, scenarios and valuation/returns analysis are left out. Known limitation: sub-headers *inside* a block
(a segment's name, a debt sub-block like "Ending balance") are dropped, so repeated labels ("Revenue", tranche
names) lose their context — addressed by **groups** below.

Groups: each planned section may list titled sub-blocks (title, header row, inclusive row range; nesting by
containment). Extraction keeps the group (nested titles joined with " › ") as its own field, separate from the line's label, so matching runs on the label alone; the Basis Template carries it in a Group column. Same-named lines under different groups match the same schema line equally well, so the match is proposed as the first, the rest are listed as alternatives, and it is flagged for review until the user picks or approves one.
Code then flags any (group, label) pairs that *still* repeat in a section — a mechanical check for a missing group. Planned
next: use that flag to trigger one targeted LLM follow-up for just that section, then re-check.

Not built yet: step 7 (advisory plan check + follow-up loop), the Anthropic adapter and dev proxy.

## AI-assisted mapping (after import)

Both run from buttons on the mapping screen, so the deterministic pass stays instant. Both send line names,
groups, sections and each line's **latest value** (not the full series) to the model; every id in an answer is
validated against what was sent, and every result lands flagged for review (`method: 'ai'`, confidence below the
0.8 review threshold) — code never lets the model settle a mapping on its own.

- **Review with AI** (`aiImport/suggestMappings.ts`): unmapped lines and ties only, one request per statement
  section. Sources already used by a settled match are marked and rejected. Empty answers are allowed and preferred
  to guesses. Saving accepted matches back as aliases is deliberately not done yet.
- **Suggest sub-lines** (`aiImport/proposeStructure.ts`): the model proposes `addSubLine` ops (closed vocabulary,
  `StructureOp`) — a parent that allows sub-lines, a clean name, and the unassigned imported lines behind it. Ops
  are applied only through `addChildLine`, so schema invariants hold, and are reviewed one by one in
  `StructureProposalDialog` with code-computed evidence (sub-line total vs the parent's mapped total). Debt tranche
  settings (coupon, maturity, ...) and new lines/sections are later ops on the same path; settings usually live outside
  the historical window, so they need a second extraction window.

