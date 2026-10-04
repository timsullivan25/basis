# Roadmap

Status: **the plan of record, in order.** Revised 2026-10-04 from a loose idea list into a sequenced
plan. Each phase says what it is, why it comes where it does, and what's still open. Details below
a phase's first paragraph are working notes, not commitments; edit freely as a phase gets scoped.

Started 2026-09-15, after the statement-editing convergence work and a first audit of what a
"comprehensive" model still needs.

## Where we are

The core model and a first set of standalone analyses are in place, enough to be useful today:

- **Model core.** Schema-driven statements, real linkage (equity roll-forward, Change in NWC,
  generic Checks, convergence flags for circular calcs), scenarios with per-line driver overrides,
  driver charts, and a generated Debt Schedule.
- **Standalone analyses.** DCF, Recovery Waterfall (fulcrum security, valuation sensitivity) and
  LBO (tranche editor, Ability-to-Pay solve). All three link live to the base model for the active
  scenario rather than storing copies. DCF and LBO also write a versioned `AnalysisResult` cache
  per (model, scenario) for future cross-model readers.

Expect plenty of refinement to the analyses, especially their workflow. That happens alongside the
phases below rather than as its own phase (see [Ongoing](#ongoing-refinement)).

## Sequence

1. [Sensitivity analysis](#1-sensitivity-analysis): next.
2. [Overlays](#2-overlays): templated sections and lines added to an existing model.
3. [Data-dependent analyses](#3-data-dependent-analyses): public comps, relative value, PIT/PF
   capital structure.
4. [AI-assisted modeling](#4-ai-assisted-modeling): generated side analyses and model edits that
   plug into existing inputs.
5. [Portfolio-level shocks](#5-portfolio-level-shocks): one macro shock applied across every
   company's base case.

[Platform capabilities](#platform-capabilities-parallel-track) (Relative Value, Swap Finder,
Holdings, etc.) run as a parallel track that can start whenever the modeling side is useful enough
to merge into.

## Principle: schedules are schema, not generated code

Supporting schedules with a predictable shape (PP&E, NWC, opex build-ups and the like) are built by
extending the model schema, not by an automated generator. Generation is reserved for structures
whose **number of lines is unpredictable**, which so far means the Debt Schedule (any number of
tranches with a shared cash-sweep waterfall).

So the Net PP&E roll-forward is a schema addition: a Balance Sheet line
`priorPeriod(Net PP&E) + Cash Flow Statement.Capital Expenditures - Income Statement.Depreciation &
Amortization`, folded into Total Assets, validated by the existing Balance Sheet Check. Per-class
breakdowns use the existing sub-lines mechanism. It's small enough to land alongside any phase.
Not yet built; the default schema has Capex and D&A but no Net PP&E line.

## 1. Sensitivity analysis

Being able to sensitize the model is a key capability. Reference points: Oracle Crystal Ball (the
Excel add-in) and Tim's earlier [SimulationSandbox](https://github.com/timsullivan25/SimulationSandbox).

**Why it's feasible now:** `evaluateModel(schema, { timeline, historicals, driverValues })` is pure,
and scenarios already work by layering driver overrides onto `driverValues` (`lib/scenario.ts`). A
sensitivity run is the same move repeated: perturb some driver values, evaluate, read outputs. No
engine changes are needed to get started.

**Shape:**

- **Inputs to sensitize.** The user picks drivers (with in-app suggested defaults: revenue growth,
  margins, capex %, rates, exit multiple and so on). For each, a range and/or a function: low/high
  bounds and step count, ± percent around base, or a distribution (uniform, normal, triangular) for
  sampling. Decide whether a shift applies to every projected period or a chosen window.
- **Outputs to monitor.** Model lines at a period (EBITDA, FCF, leverage, ending cash, min
  liquidity) and analysis outputs (DCF value, LBO IRR/MOIC, recovery %), again with suggested
  defaults.
- **One at a time.** Step each input through its range with everything else at base, record the
  outputs, and rank inputs by output swing in a **tornado / butterfly chart**.
- **All together.** Vary every input at once to see the full range of outcomes, including
  interactions: a deterministic grid (feasible for 2-3 inputs, also gives the classic two-way data
  table) or Monte Carlo sampling (distribution / histogram of outputs, percentiles, probability of
  breaching a threshold such as a leverage covenant).

**Running on top of analyses:**

- **Step 1: outputs only.** Because DCF, LBO and Recovery all resolve live off the model's
  evaluation, a sensitivity run can capture analysis outputs as model inputs move, with the
  linking doing the work. Each iteration has to call the analysis's pure compute function directly
  rather than going through the panel UI.
- **Step 2: analysis variables as inputs.** Let the analyses' own inputs (WACC, terminal growth,
  exit multiple, leverage, target IRR) be sensitized alongside model drivers. They're already
  stored per scenario, so the same override layering applies.

**Built (on branch, not yet merged):** a Sensitivity tab on the model workspace
(`lib/sensitivity.ts`, `lib/sensitivityAnalyses.ts`, `components/models/sensitivity/`) with
three views over the same inputs and outputs:

- **One at a time:** a tornado for any output.
- **Two-way grid:** two inputs varied together, the classic data table. It defaults to the two
  inputs that move the output most.
- **Monte Carlo:** every input drawn at once (triangular, uniform or normal over its range). It
  shows a histogram, the mean, P5/P50/P95 and the chance of ending above or below a threshold.

Inputs are model drivers plus the assumptions of enabled analyses (DCF WACC and terminal growth,
LBO leverage and exit multiple, Recovery multiple or distributable value). Outputs are any model
line at any period plus analysis results (DCF EV and equity value, LBO entry multiple and ability
to pay at each target IRR, Recovery to equity and recovery % per tranche). Analysis results come
from each analysis's own pure compute function, so step 1 and step 2 below are both in.

Defaults taken, open to revisit:

- Runs are ad hoc. Nothing is saved or cached. The tornado and grid re-run live; Monte Carlo runs
  on demand with a seed so a run can be reproduced.
- A driver shift applies to every projected period, to the driver's effective value (a blank cell
  shifts from the engine's own default). Rates and ratios move ±2 points, days-of ±5 days,
  hardcoded amounts ±10%, WACC ±1 point, terminal growth ±0.5 point, multiples ±0.5x to ±1x. There
  is no per-period window yet.
- The starting case is the active scenario.
- Performance: one evaluation of the bundled template takes about 0.5 ms, and 1,000 Monte Carlo
  trials with LBO results ran in about 0.5 s in the browser. That's synchronous on the main
  thread, with no Web Worker yet.
- Inputs are sampled independently. Correlated inputs are not in v1.

**Open questions:**

- Where a run lives: a saved "sensitivity case" per model (like an LboCase) vs. ad hoc.
- Performance budget for Monte Carlo. Full re-evaluation per sample in the browser may need a Web
  Worker and a cap on iterations; check before choosing sample counts.
- Whether to support correlated inputs (e.g. growth and margin moving together) in v1.
- Whether results are cached the way `AnalysisResult` is, for later portfolio-level reuse.

## 2. Overlays

Overlays add **templated sections and lines** to an existing model to reflect a transaction or
situation, then use ordinary formulas and the existing engine. The Debt Schedule is the pattern
already shipped (eligibility scan, generated `StatementLine`s tagged with a role, a UI toggle; see
`lib/debtSchedule.ts`). Per the principle above, prefer a static template unless the line count is
genuinely variable. Every overlay with a sources & uses gets a Check for free.

Candidates, roughly in order:

- **Refinancing:** pay off existing debt, issue new, fees/OID/breakage.
- **Recapitalization:** issue debt to fund a dividend. Same shape as refinancing.
- **M&A / acquisition:** goodwill, purchase price allocation, pro forma combination, synergies,
  transaction costs. The biggest lift here, and the prerequisite for accretion/dilution.
- **Divestiture:** carve-out / discontinued operations.
- **NOL / tax carryforward:** an optional module for distressed or early-stage names.
- **Share count / dilution:** buybacks, issuance, treasury method. Needed once EPS or per-share
  value matters.
- **Lease accounting (ROU asset/liability):** only if real-estate or retail-heavy names are in
  scope.

## 3. Data-dependent analyses

Analyses that need data beyond a single company's model, so they're likely gated on market-data
access (see the platform track):

- **Public comps** (trading comps; precedent transactions fit here too).
- **Relative value.**
- **PIT or PF capital structure:** point-in-time and pro forma views of the capital stack.
- **Accretion/dilution** once the M&A overlay exists, and a **value-creation bridge** (growth vs.
  margin vs. multiple vs. deleveraging), which is cheap once DCF/LBO outputs exist.

## 4. AI-assisted modeling

Use AI to do more of the modeling work, always landing in existing infrastructure rather than
free-floating output:

- Generate **side analyses** that plug directly into model inputs or drivers.
- **Edit the model**: propose schema or driver changes for the user to accept.
- AI-generated custom modeling structures (schema generation).

The AI import follow-ups below are related and could share plumbing.

## 5. Portfolio-level shocks

An app-level modeling capability, possibly more deterministic than phase 4. Define a macro shock
(recession as slower growth, inflation as higher expenses, a rate move, etc.), apply it broadly
across every company's **base case**, non-destructively, and record the impact on outputs like
leverage and FCF to **identify the most exposed companies**.

Builds directly on phase 1: a shock is a sensitivity input applied portfolio-wide, and the
per-(model, scenario) result cache is the natural place to read outcomes from. Open question: how a
generic shock maps onto company models whose schemas differ (likely via the standard concepts
analyses already require, such as Revenue, EBITDA and interest expense).

## Platform capabilities (parallel track)

Non-modeling capabilities that will merge in, possibly in parallel with the phases above since the
modeling side is close to useful on its own:

- Relative Value
- Swap Finder
- Holdings
- Data Sheets
- Market Data
- Linking to memos / recommendations

Most need additional data. Even before that data exists, it helps to know these are coming so the
framework accommodates them: an issuer/security identity that models, holdings and market data all
key off; a place for external market data to land; and model outputs (the `AnalysisResult` cache)
readable across issuers.

## Ongoing refinement

Picked up opportunistically between phases:

- **Analysis workflow refinement** for DCF, LBO and Recovery. DCF in particular hasn't been scoped
  in detail.
- **UI/UX pass:** two-tier workspace nav (Financials | Summary | Scenarios | analyses, with
  Financials' own statement sub-nav), the persistent "Live output" rail from the mockup, mockup
  1b's driver-first workspace, and a driver's value shown inline in the grid.
- **Quarterly / semi-annual modeling** with annual aggregation, expand/collapse.
- **AI import follow-ups** (first pass, historicals only, is on `feature/ai-import`): sub-lines for
  debt tranches and segments (likely proposing schema additions during mapping), importing
  projections with scenario cases, post-mapping checks (likely errors, suggested fits with
  confidence), and confirming where the financials are in an ambiguous workbook.
- **Mapping QoL:** step-through review (auto-advance to the next flagged line after approving), and
  cross-company alias memory, which compounds with AI-assisted matching.
- **Known rough edge:** `FormulaInput` silently discards an invalid formula if the row is collapsed
  before blur.

## Open questions

- **Autosave vs. undo.** `docs/backend-storage-design.md` intends write-through autosave once a real
  backend exists. We tried eager debounced save for schema edits and reverted to explicit Save
  because there was no undo/restore behind it. Autosave and versioning are separable, but autosave
  without restore is a net negative. Reconcile before the backend migration.
- **No restore from snapshots.** Snapshot/History only supports viewing an old snapshot; there's no
  rollback anywhere. Any move back toward autosave should wait for real restore.

## Done

- **Correctness:** equity roll-forward and real Change in NWC (`3507938`), generic Checks
  (`69409bb`), convergence indicator for circular calcs.
- **Model:** Debt Schedule engine and capital structure (`9d64332`), per-model private schemas,
  scenario driver overrides per line (`557b8de`), driver charts (`6516706`, `77018c3`).
- **Analyses:** Recovery Waterfall, LBO returns with its review fixes (PRs #14 to #16), DCF.
