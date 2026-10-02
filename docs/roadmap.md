# Modeling feature roadmap

Status: **running list of ideas, not a committed plan.** Unlike `backend-storage-design.md`, nothing
here is sequenced beyond the rough tiers below, and nothing is agreed in detail — this is where we
park ideas as we have them, and pull from when scoping the next phase. Edit freely; add new ideas
at the bottom of whichever section fits, and move things between tiers as priorities shift.

Started 2026-09-15, after the statement-editing convergence work (shared editing core, Edit
schema/Edit mapping toggle) and a first pass at auditing what a "comprehensive" model still needs.

## Tier 0 — correctness (mostly done)

The model used to "balance" by construction, not by real linkage. Fixed:

- ~~**Equity is a plug, not a roll-forward.**~~ **Done** (`3507938`) — equity is now a genuine
  roll-forward.
- ~~**No Change-in-NWC line in the Cash Flow Statement.**~~ **Done** (`3507938`) — real Change in
  NWC line.
- ~~**Generic "Checks" mechanism.**~~ **Done** (`69409bb`) — check line type with tolerance, flagged
  in the grid. Every future overlay (an M&A/refi's sources & uses, in particular) gets a check for
  free: one more formula line, no new plumbing.
- **Convergence indicator for circular calcs — partly done.** The engine records a per-line
  "didn't converge" error (`lib/engine/evaluate.ts`) instead of silently showing a stale number.
  Still to confirm: whether that error is actually surfaced visibly in the workspace UI.

## Tier 1 — the overlay pattern, generalized

The Debt Schedule already *is* this pattern, shipped (`9d64332`): scan the schema for eligibility, generate
real `StatementLine`s tagged with a role, wire them with ordinary formulas, let the existing
evaluation engine do the rest — no special-cased engine logic (see `lib/debtSchedule.ts`). Each of
these is the same shape: an eligibility rule + a `regenerateX(schema, ...)` function + a role tag +
a toggle in the UI. Not new architecture — the same pattern, run a few more times.

- **PP&E / Capex roll-forward** (Beginning + Capex − D&A = Ending). **Next up.** Highest priority of
  this group — most universally needed, and D&A/Capex today are just disconnected flat
  %-of-revenue lines. Tier 0 checks now exist to verify it ties to the balance sheet.
- **Refinancing overlay** — payoff existing debt, issue new, fees/OID/breakage costs. Naturally
  "sources & uses" shaped, pairs with the Tier 0 Checks mechanism.
- **Recapitalization overlay** — issue debt to fund a shareholder dividend. Same shape as
  refinancing.
- **M&A / acquisition overlay** — goodwill, purchase price allocation, pro forma combination,
  synergies, transaction costs. Bigger lift than the others in this tier.
- **Divestiture overlay** — carve-out / discontinued-operations treatment.
- **NOL / tax carryforward overlay** — an alternative to building this into the core tax line;
  frame it as an optional module a distressed/early-stage company toggles on, since it's
  irrelevant for stable profitable names.
- **Share count / dilution roll-forward** (buybacks, issuance, treasury method) — needed the
  moment EPS or per-share value output matters.
- **Lease accounting (ROU asset/liability)** — only worth it if real-estate/retail-heavy companies
  are actually in scope. Lower priority than the rest of this tier; revisit if that changes.

## Tier 2 — standalone analyses (mostly downstream of Tier 1)

- **Recovery waterfall** — worth building specifically because the Debt Schedule already encodes
  seniority order (revolver first, then term tranches in schema order) for the cash-sweep logic. A
  downside-scenario recovery waterfall reuses that ordering directly rather than re-deriving
  capital structure.
- ~~**LBO returns (IRR/MOIC)**~~ **Done** — a standalone LboCase (own schema/timeline, extended
  5-7yr beyond the base model) with a full tranche editor (default Term Loan + Revolver, sized by
  leverage multiple) and an "Ability to Pay" back-solve: fixes the financing package (leverage ×
  entry EBITDA, independent of price) and a target IRR, solves backward for the max entry
  multiple/EV, closed-form even with "no multiple expansion" (see `lib/lbo.ts`). Consistent with
  every other analysis's own linking contract: an LboCase stores only its OWN inputs (the
  financing package's tranches/terms, structural; leverage/target IRR/exit assumptions, per-
  scenario via `financing: Record<ScenarioKey, LboFinancingInputs>`, same sparse-cascade-off-Base
  convention as DCF's WACC/terminal growth) — never a copy of Revenue/EBITDA/D&A/CapEx/NWC/tax
  rate or the Term Loan's own face value, all of which resolve live off the base model's current
  evaluation for whichever scenario is active, every render (`buildLboEvaluationInputs`). No
  analysis (LBO included) persists its own OUTPUTS yet — Ability to Pay is recomputed live, same
  as DCF; if that changes later, the plan is to store either the base case's output or every
  scenario's, not a single ambiguous snapshot, so cross-issuer/over-time comparison stays honest.
- **Accretion/dilution analysis** — needs the M&A overlay first.
- **Value-creation bridge** (growth vs. margin vs. multiple vs. deleveraging) — cheap once DCF/LBO
  outputs exist.
- **Trading comps / precedent transactions** — different category of problem from everything above:
  needs external market-data ingestion, not just more schema plumbing. Keep sequenced separately,
  don't bundle with the rest of this tier.

## Tier 3 — workflow quality-of-life (low priority, revisit opportunistically)

- **Step-through review in mapping** — auto-advance to the next flagged line after approving one, as
  a lighter alternative to true bulk-approve (which probably isn't worth building — clicking a line
  and hitting Approve isn't meaningfully slower than a bulk UI would be for most cases).
- **Cross-company alias/mapping memory** — today, learned mapping only carries forward for the
  *same* company's next import; a new portfolio company mapped against the same template starts
  cold except for exact matches and the schema's own static aliases. Low priority on its own since
  Financial Statement Definitions' aliases already cover most of this — but worth revisiting
  alongside AI-assisted matching (below), where a cross-company "this source name has meant X
  before" memory would compound in value.

## Done since this list started

- Driver charts (drag-to-edit, mockup mechanic 1a) — merged to main (`6516706`, `77018c3`).
- Scenario driver overrides are per-line, all-or-nothing (`557b8de`).
- Debt Schedule engine, capital structure, per-model private schemas.

## Already planned (restated here so this doc is the single source of truth going forward)

- Code review of the modeling feature, then a UI/UX pass. The pass covers: two-tier workspace nav
  (Financials | Summary | Scenarios | DCF | Recovery, with Financials' own statement sub-nav), the
  persistent "Live output" rail from the mockup (never built), mockup 1b's driver-first workspace
  (depends on the two-tier nav), and showing a driver's value inline in the financials grid.
- Known rough edge: `FormulaInput` silently discards an invalid formula if the row is collapsed
  before blur.
- Quarterly/semi-annual modeling with annual aggregation, expand/collapse.
- AI-assisted parsing of a generic (non-template) financial upload. In progress on
  `feature/ai-import`; first pass is **historicals only**, extracted into the Basis Template shape
  and fed through the existing mapping flow. Deferred from that first pass, to revisit:
  - **Sub-lines for debt tranches and segments.** A real model breaks these out (e.g. per-tranche
    debt, per-segment revenue); the importer will likely need to *propose schema additions* as part
    of the mapping phase, not just map onto the existing schema.
  - **Projections.** Real models carry them (with scenario cases); import them in a later pass.
  - **Post-mapping AI passes** (nice to have): flag likely errors in mapped lines, and suggest
    fits for unmapped lines with a confidence level.
  - **Confirming where the financials are** when the workbook layout is ambiguous.
- AI-generated custom modeling structures (schema generation).

## Open questions / notes

- `docs/backend-storage-design.md` describes client-side debounced autosave as the intended pattern
  once a real backend exists ("Decision: no sync engine — write-through autosave instead"). We
  tried an eager-debounced-save for schema edits in this session and reverted it back to explicit
  Save, specifically because it shipped without any undo/restore capability behind it. Worth
  reconciling these two before the backend migration: autosave-for-durability and undo/versioning
  are separable concerns, but autosave without the latter is a net negative, as this session found.
- The existing Snapshot/History feature only supports *viewing* an old snapshot, not restoring from
  one — there's no rollback action anywhere in the codebase today. Any future move back toward
  autosave for schema edits should probably wait until real restore exists.
