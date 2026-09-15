# Modeling feature roadmap

Status: **running list of ideas, not a committed plan.** Unlike `backend-storage-design.md`, nothing
here is sequenced beyond the rough tiers below, and nothing is agreed in detail — this is where we
park ideas as we have them, and pull from when scoping the next phase. Edit freely; add new ideas
at the bottom of whichever section fits, and move things between tiers as priorities shift.

Started 2026-09-15, after the statement-editing convergence work (shared editing core, Edit
schema/Edit mapping toggle) and a first pass at auditing what a "comprehensive" model still needs.

## Tier 0 — correctness (blocks real checks, do before the overlay work below)

The model currently "balances" by construction, not by real linkage — worth fixing before building
more on top of it:

- **Equity is a plug, not a roll-forward.** `Total Equity = Total Assets − Total Liabilities`
  (`defaultStatementSchema.ts`). No Retained Earnings line, no `prior + Net Income − Dividends`
  formula. Needs to become a genuine roll-forward before a balance check would mean anything.
- **No Change-in-NWC line in the Cash Flow Statement.** AR/AP/Deferred Revenue can move on the
  balance sheet with zero cash-flow effect — those movements currently vanish into the Equity plug
  above instead of hitting cash. `cashFlowStatement()` needs a real NWC line.
- **Generic "Checks" mechanism**, once the above two are real: a line type/section whose formula is
  expected to evaluate to ~0 (e.g. `Total Assets − Total Liabilities − Total Equity`, `Cash Flow
  Statement.Ending Cash − Balance Sheet.Cash & Equivalents`), flagged red when it isn't — same
  convention analysts already use in Excel models. Every future overlay below (an M&A/refi's
  sources & uses, in particular) gets a check for free once this exists — one more formula line, no
  new plumbing.
- **No visible convergence indicator for circular calcs.** The Gauss-Seidel solver either converges
  or it doesn't; worth surfacing if/when it fails to, rather than silently showing a stale number.

## Tier 1 — the overlay pattern, generalized

The Debt Schedule already *is* this pattern, shipped: scan the schema for eligibility, generate
real `StatementLine`s tagged with a role, wire them with ordinary formulas, let the existing
evaluation engine do the rest — no special-cased engine logic (see `lib/debtSchedule.ts`). Each of
these is the same shape: an eligibility rule + a `regenerateX(schema, ...)` function + a role tag +
a toggle in the UI. Not new architecture — the same pattern, run a few more times.

- **PP&E / Capex roll-forward** (Beginning + Capex − D&A = Ending). Highest priority of this group —
  most universally needed, and D&A/Capex today are just disconnected flat %-of-revenue lines.
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
- **LBO returns (IRR/MOIC)**.
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

## Already planned (restated here so this doc is the single source of truth going forward)

- Driver charts.
- Quarterly/semi-annual modeling with annual aggregation, expand/collapse.
- AI-assisted parsing of a generic (non-template) financial upload.
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
