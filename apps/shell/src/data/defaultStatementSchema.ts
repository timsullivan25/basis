import { buildDaysFormula, buildFlatFormula, buildGrowthFormula, buildNameIndex, buildRatioFormula, compileFormula, type NameIndex } from '../lib/engine/resolve';
import { regenerateTemplateDebtSchedule } from '../lib/debtSchedule';
import type {
  DriverDefinition,
  LineAggregation,
  LineNumberFormat,
  LineRowFormat,
  LineSign,
  StatementLine,
  StatementSchema,
  StatementSection,
} from './types';

interface LineOptions {
  formula?: string;
  aliases?: string[];
  rowFormat?: LineRowFormat;
  numberFormat?: LineNumberFormat;
  sign?: LineSign;
  aggregation?: LineAggregation;
  /** Sourced lines default to required; calculated and optional memo lines pass false. */
  required?: boolean;
  /** See StatementLine.allowsSubLines' own doc comment. */
  allowsSubLines?: boolean;
  /** See StatementLine.lineKind' own doc comment. */
  lineKind?: 'debt' | 'check';
}

/** Authored with a raw formula string for readability — resolved into a real ResolvedFormula
 *  by compileSchema() once every line (and therefore every id) in the schema exists. */
interface DraftLine extends Omit<StatementLine, 'formula'> {
  formula: string;
}
interface DraftSection extends Omit<StatementSection, 'lines'> {
  lines: DraftLine[];
}

function line(name: string, options: LineOptions = {}): DraftLine {
  const formula = options.formula ?? '';
  return {
    id: crypto.randomUUID(),
    name,
    required: options.required ?? formula === '',
    rowFormat: options.rowFormat ?? (formula ? 'total' : 'normal'),
    numberFormat: options.numberFormat ?? 'number',
    sign: options.sign ?? 'natural',
    aggregation: options.aggregation ?? 'sum',
    formula,
    projection: null,
    aliases: options.aliases ?? [],
    allowsSubLines: options.allowsSubLines,
    lineKind: options.lineKind,
  };
}

function section(name: string, lines: DraftLine[]): DraftSection {
  return { id: crypto.randomUUID(), name, lines };
}

function incomeStatement(): DraftSection {
  return section('Income Statement', [
    line('Revenue', { aliases: ['Total revenue', 'Net revenue'] }),
    line('Cost of Revenue', { sign: 'absolute', aliases: ['COGS', 'Cost of goods sold', 'Cost of sales'] }),
    line('Gross Profit', { formula: 'Revenue - Cost of Revenue' }),
    line('Gross Margin %', { formula: 'Gross Profit / Revenue', rowFormat: 'metric', numberFormat: 'percentage', aggregation: 'none' }),
    line('Sales & Marketing', { sign: 'absolute', aliases: ['S&M', 'Sales and marketing'] }),
    line('Research & Development', { sign: 'absolute', aliases: ['R&D'] }),
    line('General & Administrative', { sign: 'absolute', aliases: ['G&A'] }),
    line('Total Operating Expenses', { formula: 'Sales & Marketing + Research & Development + General & Administrative' }),
    line('EBITDA', { formula: 'Gross Profit - Total Operating Expenses' }),
    line('EBITDA Margin %', { formula: 'EBITDA / Revenue', rowFormat: 'metric', numberFormat: 'percentage', aggregation: 'none' }),
    line('Depreciation & Amortization', { sign: 'absolute', aliases: ['D&A'] }),
    // "Depreciation & Amortization" also exists as a Cash Flow Statement pull-through — qualified
    // so this reads the Income Statement's own raw line, not that ambiguity.
    line('Operating Income', { formula: 'EBITDA - Income Statement.Depreciation & Amortization', aliases: ['EBIT'] }),
    // Formula set below, after the Debt Schedule section exists (see createDefaultStatementSchema)
    // — an ordinary cross-section reference to its always-present "Interest Expense" total
    // (sum of every debt tranche's own interest and any revolver's commitment fee), the exact
    // same qualified-name mechanism every other pull-through in this schema already uses. No
    // special field: a custom schema references it the same way, by typing the formula.
    line('Net Interest Expense', { sign: 'absolute' }),
    line('Pretax Income', { formula: 'Operating Income - Net Interest Expense', rowFormat: 'normal' }),
    line('Income Tax Expense', { sign: 'absolute' }),
    line('Net Income', { formula: 'Pretax Income - Income Tax Expense' }),
  ]);
}

function balanceSheet(): DraftSection {
  return section('Balance Sheet', [
    // A genuine structural roll-forward (priorPeriod + the period's net change), same
    // "always meant to be a formula" convention as Gross Profit/EBITDA below — authored once,
    // directly, unlike Net Interest Expense below (which references the Debt Schedule's own
    // totals — see createDefaultStatementSchema). Every actual period's mapped historical still
    // wins over this, unchanged. Self-reference is
    // qualified (Balance Sheet.Cash & Equivalents) — the bare name is ambiguous with Credit
    // Metrics' own pull-through line below, and NameIndex's self-exclusion on a bare match would
    // otherwise resolve this to THAT line instead of a true self-reference.
    line('Cash & Equivalents', {
      formula: 'priorPeriod(Balance Sheet.Cash & Equivalents) + Cash Flow Statement.Net Change in Cash',
      required: true,
      aliases: ['Cash and cash equivalents'],
    }),
    line('Accounts Receivable', { aliases: ['AR', 'Trade receivables'] }),
    line('Other Current Assets', {}),
    // "Cash & Equivalents" also exists as a Credit Metrics pull-through — qualified so this
    // reads the Balance Sheet's own raw line, not that ambiguity.
    line('Total Current Assets', { formula: 'Balance Sheet.Cash & Equivalents + Accounts Receivable + Other Current Assets' }),
    line('Goodwill & Intangibles', { aliases: ['Goodwill and intangible assets'] }),
    line('Other Long Term Assets', {}),
    line('Total Assets', { formula: 'Total Current Assets + Goodwill & Intangibles + Other Long Term Assets' }),
    line('Accounts Payable', { sign: 'absolute', aliases: ['AP', 'Trade payables'] }),
    line('Deferred Revenue', { sign: 'absolute', aliases: ['Unearned revenue'] }),
    line('Other Current Liabilities', { sign: 'absolute' }),
    line('Total Current Liabilities', { formula: 'Accounts Payable + Deferred Revenue + Other Current Liabilities' }),
    // Debt is broken out by seniority tier so a capital-structure tranche can attach under the
    // right one via `parentLineId` — same allowsSubLines mechanism the EBITDA bridge's Delta
    // lines use, no engine changes needed. `sign: 'absolute'` moves onto the tiers (where a
    // mapped value or a tranche's own value actually lands); "Secured Debt"/"Total Debt" are
    // pure subtotals, same as any other formula line. A tier with zero children and no direct
    // mapping evaluates null and is ignored by sum()'s "ignore blanks" semantics, exactly like
    // an unused EBITDA bridge Delta level. Each tier line also sets `lineKind: 'debt'` — this
    // (not a hardcoded line-name check) is what the mapping screen uses to show a tranche's
    // debt-specific property fields (including the Term/Revolver choice, which is not a
    // separate schema flag at all); a custom schema is free to name its tiers anything, or have
    // any number of them.
    line('1L Debt', { sign: 'absolute', required: false, rowFormat: 'normal', allowsSubLines: true, lineKind: 'debt' }),
    line('2L Debt', { sign: 'absolute', required: false, rowFormat: 'normal', allowsSubLines: true, lineKind: 'debt' }),
    line('Secured Debt', { formula: 'sum(1L Debt, 2L Debt)' }),
    line('Unsecured Debt', { sign: 'absolute', required: false, rowFormat: 'normal', allowsSubLines: true, lineKind: 'debt' }),
    line('Total Debt', { formula: 'sum(Secured Debt, Unsecured Debt)', aliases: ['Total borrowings'] }),
    line('Other Long Term Liabilities', { sign: 'absolute' }),
    // "Total Debt" also exists as a Credit Metrics pull-through — qualified so this reads the
    // Balance Sheet's own raw line, not that ambiguity.
    line('Total Liabilities', { formula: 'Total Current Liabilities + Balance Sheet.Total Debt + Other Long Term Liabilities' }),
    line('Common Stock & APIC', { aliases: ['Common stock and additional paid-in capital', 'Additional paid-in capital', 'APIC'] }),
    // A genuine roll-forward (prior + Net Income − Dividends), same "always meant to be a
    // formula" convention as Cash & Equivalents above — this is what lets Total Equity below sum
    // real components instead of plugging. Self-reference qualified for the same reason Cash &
    // Equivalents' is. Dividends Paid lives in the Cash Flow Statement — an ordinary
    // cross-section reference, same mechanism Net Interest Expense uses for the Debt Schedule.
    line('Retained Earnings', {
      formula: 'priorPeriod(Balance Sheet.Retained Earnings) + Income Statement.Net Income - Cash Flow Statement.Dividends Paid',
      required: true,
      aliases: ['Accumulated deficit', 'Retained earnings (deficit)'],
    }),
    // No longer a plug (Total Assets − Total Liabilities) — a real subtotal over the two equity
    // components above. Only covers what most companies report; a real one with AOCI, treasury
    // stock, or non-controlling interests won't fully tie out here, and that's the Balance Sheet
    // Check's job to surface, not something to model speculatively ahead of a real need.
    line('Total Equity', { formula: 'sum(Common Stock & APIC, Retained Earnings)', aliases: ["Stockholders' equity"] }),
  ]);
}

function cashFlowStatement(): DraftSection {
  return section('Cash Flow Statement', [
    line('Net Income', { formula: 'Net Income', required: false }),
    line('Depreciation & Amortization', { formula: 'Depreciation & Amortization', required: false, rowFormat: 'normal' }),
    line('Stock Based Compensation', { sign: 'absolute', aliases: ['SBC'] }),
    // The balance-sheet movements a pure income-statement-driven build misses: an increase in AR
    // is a cash outflow, an increase in AP/Deferred Revenue is a cash inflow. Each term uses
    // priorPeriod the same way Cash & Equivalents' own roll-forward does in the Balance Sheet —
    // null in the first period (nothing to diff against yet), same as any other roll-forward's
    // first period, not a bug.
    line('Change in Net Working Capital', {
      formula:
        '(Accounts Payable - priorPeriod(Accounts Payable)) + (Deferred Revenue - priorPeriod(Deferred Revenue)) - (Accounts Receivable - priorPeriod(Accounts Receivable))',
    }),
    // "Net Income" and "Depreciation & Amortization" are also Income Statement lines — qualified
    // so this reads the Cash Flow Statement's own pull-through lines defined just above.
    line('Cash Flow from Operations', {
      formula:
        'Cash Flow Statement.Net Income + Cash Flow Statement.Depreciation & Amortization + Stock Based Compensation + Change in Net Working Capital',
    }),
    line('Capital Expenditures', { sign: 'absolute', aliases: ['Capex'] }),
    line('Free Cash Flow', { formula: 'Cash Flow from Operations - Capital Expenditures', aliases: ['FCF'] }),
    // Formulas set below, after the Debt Schedule section exists — ordinary cross-section
    // references to its always-present "Borrowings"/"Repayments" totals (the latter bundling
    // mandatory amortization + swept repayment into one CFS line; the split only matters at the
    // per-tranche schedule level). Null for a company with no tranches, same as any sum() of
    // nothing — no special "blank until" handling needed.
    line('Debt Borrowings', { required: false }),
    line('Debt Repayments', { sign: 'absolute', required: false }),
    line('Dividends Paid', { sign: 'absolute', required: false, aliases: ['Dividends paid', 'Common dividends paid', 'Cash dividends paid'] }),
    line('Net Cash from Financing Activities', { formula: 'Debt Borrowings - Debt Repayments - Dividends Paid' }),
    line('Net Change in Cash', { formula: 'Free Cash Flow + Net Cash from Financing Activities' }),
  ]);
}

/** Each Delta line is an ordinary allowsSubLines line — a schema author (or a seeded default,
 *  see DEFAULT_ADJUSTMENT_INSTANCE_SEEDS in Phase 9 Slice 4) adds instances under it exactly the
 *  same way a revenue segment gets added under Revenue; nothing here is bridge-specific. Each
 *  bridge level's own formula uses `sum(...)`, not `+`, so a Delta line with zero instances (and
 *  no direct mapping) evaluates to null and is skipped by sum()'s "ignore blanks" semantics —
 *  the level above then reads as EXACTLY equal to the level below, with no separate "collapse
 *  unused levels" logic needed anywhere. */
function ebitdaBridge(): DraftSection {
  return section('EBITDA', [
    line('Reported EBITDA', { formula: 'EBITDA', required: false }),
    line('Adjusted EBITDA Delta', { required: false, rowFormat: 'normal', allowsSubLines: true }),
    line('Adjusted EBITDA', { formula: 'sum(Reported EBITDA, Adjusted EBITDA Delta)' }),
    line('Cash EBITDA Delta', { required: false, rowFormat: 'normal', allowsSubLines: true }),
    line('Cash EBITDA', { formula: 'sum(Adjusted EBITDA, Cash EBITDA Delta)' }),
    line('Pro Forma EBITDA Delta', { required: false, rowFormat: 'normal', allowsSubLines: true }),
    line('Pro Forma EBITDA', { formula: 'sum(Cash EBITDA, Pro Forma EBITDA Delta)' }),
    line('Adjusted EBITDA Margin %', { formula: 'Adjusted EBITDA / Revenue', rowFormat: 'metric', numberFormat: 'percentage', aggregation: 'none' }),
  ]);
}

function workingCapital(): DraftSection {
  return section('Working Capital', [
    line('Days Sales Outstanding', { required: false, rowFormat: 'metric', aggregation: 'none', aliases: ['DSO'] }),
    line('Days Payable Outstanding', { required: false, rowFormat: 'metric', aggregation: 'none', aliases: ['DPO'] }),
    line('Net Working Capital', {
      formula: 'Accounts Receivable - Accounts Payable - Deferred Revenue',
      aggregation: 'last',
    }),
  ]);
}

function creditMetrics(): DraftSection {
  return section('Credit Metrics', [
    line('Total Debt', { formula: 'Total Debt', required: false, aggregation: 'last' }),
    line('Cash & Equivalents', { formula: 'Cash & Equivalents', required: false, rowFormat: 'normal', aggregation: 'last' }),
    // "Total Debt" and "Cash & Equivalents" are also Balance Sheet lines — qualified so this
    // reads the Credit Metrics section's own pull-through lines defined just above.
    line('Net Debt', {
      formula: 'Credit Metrics.Total Debt - Credit Metrics.Cash & Equivalents',
      aggregation: 'last',
    }),
    line('Net Leverage', {
      formula: 'Net Debt / Adjusted EBITDA',
      rowFormat: 'metric',
      numberFormat: 'multiple',
      aggregation: 'none',
    }),
    line('Interest Coverage', {
      formula: 'Adjusted EBITDA / Net Interest Expense',
      rowFormat: 'metric',
      numberFormat: 'multiple',
      aggregation: 'none',
    }),
  ]);
}

/** Flags whether the statements actually tie out — ordinary formulas over lines that already
 *  exist, nothing generated/overlay-like needed (contrast lib/debtSchedule.ts, which exists
 *  because tranches are per-model instance data). Each is a relative (% of Total Assets, not raw
 *  dollars) difference so one materiality threshold works across companies of very different
 *  scale; lineKind 'check' + checkTolerance (see types.ts) is what the workspace grid reads to
 *  flag a failing period red instead of just showing the number like any other metric. Both read
 *  0.1%+ as a real tie-out gap worth investigating, not rounding noise. */
function checks(): DraftSection {
  return section('Checks', [
    line('Balance Sheet Check', {
      formula: 'abs(Total Assets - Total Liabilities - Total Equity) / Total Assets',
      rowFormat: 'normal',
      numberFormat: 'percentage',
      aggregation: 'none',
      lineKind: 'check',
    }),
    line('Cash Flow Check', {
      formula: 'abs(Cash Flow Statement.Net Change in Cash - (Balance Sheet.Cash & Equivalents - priorPeriod(Balance Sheet.Cash & Equivalents))) / Total Assets',
      rowFormat: 'normal',
      numberFormat: 'percentage',
      aggregation: 'none',
      lineKind: 'check',
    }),
  ]);
}

/** Fixed (not random) so concurrent seed attempts on an empty store converge on one row instead of racing to create duplicates — see IndexedDbStatementSchemaRepository.list(). */
export const DEFAULT_SCHEMA_ID = 'seed-basis-default';

/** A handful of common EBITDA adjustments the mapping screen tries to auto-populate as
 *  sub-line instances under "Adjusted EBITDA Delta" for a brand-new model built on this
 *  default schema — reusing matchStatementLines' own exact/alias/fuzzy matching (see
 *  ModelMappingScreen's auto-seed effect), the same mechanism any ordinary schema line's
 *  aliases already get matched by, so a common adjustment can auto-populate from an upload
 *  with no manual mapping step. Each stays at zero (unmatched, but still present, still
 *  editable) when a company's file doesn't have it — the "smart defaults, full power still
 *  there for the rest" case this seed list exists for. */
export interface DefaultAdjustmentInstanceSeed {
  name: string;
  aliases: string[];
}
export const DEFAULT_ADJUSTMENT_INSTANCE_SEEDS: DefaultAdjustmentInstanceSeed[] = [
  {
    name: 'Stock-Based Compensation Addback',
    aliases: ['Stock Based Compensation', 'Stock-based compensation expense', 'Stock Comp Expense', 'SBC'],
  },
  {
    name: 'Restructuring & Severance',
    aliases: ['Restructuring', 'Restructuring Costs', 'Severance', 'Severance Expense'],
  },
  {
    name: 'Transaction & Integration Costs',
    aliases: ['Transaction Costs', 'Integration Costs', 'M&A Costs', 'Deal Costs'],
  },
];
/** The default schema line the seeds above roll up into — matched by name at the mapping
 *  screen's use site rather than hardcoded here, since every fresh seed of this schema mints
 *  new line ids (see createDefaultStatementSchema). */
export const DEFAULT_ADJUSTMENT_TARGET_LINE_NAME = 'Adjusted EBITDA Delta';

/** A sensible projection assumption for every line that would otherwise sit blank (null) in a
 *  projected period — so a brand-new model built on this template is immediately projectable
 *  (Free Cash Flow, Cash & Equivalents, and therefore the Debt Schedule all compute real numbers
 *  the moment periods are extended) with zero manual driver setup. Every basis line named here
 *  lives in Income Statement, the only section that needs disambiguating (its lines are the ones
 *  also pulled through into other sections — see e.g. Depreciation & Amortization). Values default
 *  through the engine's own unset-driver fallback (0% growth; the last-actual-implied ratio for
 *  percent-of/days-of — see evaluate.ts's defaultDriverValue), not hardcoded here — a real
 *  assumption is one edit away in the Drivers panel, never fabricated by this seed. */
interface DefaultProjectionSeed {
  sectionName: string;
  lineName: string;
  method: 'growth' | 'percent-of' | 'days-of' | 'flat';
  /** Required for percent-of/days-of — always an Income Statement line (see above). */
  basisLineName?: string;
}
const DEFAULT_PROJECTION_SEEDS: DefaultProjectionSeed[] = [
  { sectionName: 'Income Statement', lineName: 'Revenue', method: 'growth' },
  { sectionName: 'Income Statement', lineName: 'Cost of Revenue', method: 'percent-of', basisLineName: 'Revenue' },
  { sectionName: 'Income Statement', lineName: 'Sales & Marketing', method: 'percent-of', basisLineName: 'Revenue' },
  { sectionName: 'Income Statement', lineName: 'Research & Development', method: 'percent-of', basisLineName: 'Revenue' },
  { sectionName: 'Income Statement', lineName: 'General & Administrative', method: 'percent-of', basisLineName: 'Revenue' },
  { sectionName: 'Income Statement', lineName: 'Depreciation & Amortization', method: 'percent-of', basisLineName: 'Revenue' },
  // Net Interest Expense is NOT seeded here — it already has a permanent, ordinary formula
  // referencing the Debt Schedule's own "Interest Expense" total (see
  // createDefaultStatementSchema), which is null with zero tranches and real the moment
  // Capital Structure has any — no separate fallback needed.
  { sectionName: 'Income Statement', lineName: 'Income Tax Expense', method: 'percent-of', basisLineName: 'Pretax Income' },
  { sectionName: 'Balance Sheet', lineName: 'Accounts Receivable', method: 'days-of', basisLineName: 'Revenue' },
  { sectionName: 'Balance Sheet', lineName: 'Other Current Assets', method: 'percent-of', basisLineName: 'Revenue' },
  { sectionName: 'Balance Sheet', lineName: 'Goodwill & Intangibles', method: 'flat' },
  { sectionName: 'Balance Sheet', lineName: 'Other Long Term Assets', method: 'flat' },
  { sectionName: 'Balance Sheet', lineName: 'Accounts Payable', method: 'days-of', basisLineName: 'Cost of Revenue' },
  { sectionName: 'Balance Sheet', lineName: 'Deferred Revenue', method: 'percent-of', basisLineName: 'Revenue' },
  { sectionName: 'Balance Sheet', lineName: 'Other Current Liabilities', method: 'percent-of', basisLineName: 'Revenue' },
  { sectionName: 'Balance Sheet', lineName: 'Other Long Term Liabilities', method: 'flat' },
  { sectionName: 'Balance Sheet', lineName: 'Common Stock & APIC', method: 'flat' },
  { sectionName: 'Cash Flow Statement', lineName: 'Stock Based Compensation', method: 'percent-of', basisLineName: 'Revenue' },
  { sectionName: 'Cash Flow Statement', lineName: 'Capital Expenditures', method: 'percent-of', basisLineName: 'Revenue' },
  { sectionName: 'Cash Flow Statement', lineName: 'Dividends Paid', method: 'flat' },
];

function findSeedLine(schema: StatementSchema, sectionName: string, lineName: string): StatementLine {
  const line = schema.sections.find((s) => s.name === sectionName)?.lines.find((l) => l.name === lineName);
  if (!line) throw new Error(`Default projection seed: line not found — ${sectionName} / ${lineName}`);
  return line;
}

/** Applies DEFAULT_PROJECTION_SEEDS to an already-compiled schema — real ids exist by now, so
 *  this uses the exact same hand-built-formula + DriverDefinition construction
 *  StatementDefinitionsScreen's own setLineProjection uses at runtime, just seeded once here. */
function applyDefaultProjections(schema: StatementSchema): StatementSchema {
  let next = schema;
  const drivers: DriverDefinition[] = [];

  function setLine(sectionName: string, lineName: string, patch: Pick<StatementLine, 'formula' | 'projection'>) {
    next = {
      ...next,
      sections: next.sections.map((s) =>
        s.name === sectionName ? { ...s, lines: s.lines.map((l) => (l.name === lineName ? { ...l, ...patch } : l)) } : s,
      ),
    };
  }

  for (const seed of DEFAULT_PROJECTION_SEEDS) {
    const target = findSeedLine(next, seed.sectionName, seed.lineName);

    if (seed.method === 'flat') {
      setLine(seed.sectionName, seed.lineName, { formula: buildFlatFormula(target.id), projection: { method: 'flat' } });
      continue;
    }
    if (seed.method === 'growth') {
      const driverId = crypto.randomUUID();
      drivers.push({ id: driverId, name: `${target.name} Growth Rate`, unit: '%', targetLineId: target.id, method: 'growth' });
      setLine(seed.sectionName, seed.lineName, { formula: buildGrowthFormula(target.id, driverId), projection: { method: 'growth', driverId } });
      continue;
    }
    const basis = findSeedLine(next, 'Income Statement', seed.basisLineName!);
    const driverId = crypto.randomUUID();
    const methodLabel = seed.method === 'percent-of' ? '% of' : 'Days of';
    drivers.push({
      id: driverId,
      name: `${target.name} ${methodLabel} ${basis.name}`,
      unit: seed.method === 'percent-of' ? '%' : 'days',
      targetLineId: target.id,
      method: seed.method,
      basisLineId: basis.id,
    });
    const formula = seed.method === 'days-of' ? buildDaysFormula(basis.id, driverId) : buildRatioFormula(basis.id, driverId);
    setLine(seed.sectionName, seed.lineName, { formula, projection: { method: seed.method, driverId } });
  }

  return { ...next, drivers };
}

/** Resolves every draft line's raw formula string against a NameIndex built from the whole
 *  draft schema (every line's id already exists by now, even though formulas haven't been
 *  compiled yet — buildNameIndex only needs id/name/section, not formula). */
function compileSection(draft: DraftSection, index: NameIndex): StatementSection {
  return {
    id: draft.id,
    name: draft.name,
    lines: draft.lines.map((draftLine): StatementLine => {
      const result = compileFormula(draftLine.formula, index, draftLine.id);
      if (!result.ok) {
        throw new Error(`Seed schema formula failed to compile for "${draftLine.name}": ${result.errors.join('; ')}`);
      }
      return { ...draftLine, formula: result.formula };
    }),
  };
}

/** Points Net Interest Expense / Debt Borrowings / Debt Repayments at the Debt Schedule's own
 *  always-present totals — an ordinary formula, compiled the normal way (not a special
 *  mechanism), so a custom schema does the exact same thing by typing the same reference into
 *  any line it chooses. Runs after regenerateDebtSchedule has created those totals, since
 *  compiling a qualified reference needs the target line to already exist. */
function applyDebtScheduleReferences(schema: StatementSchema): StatementSchema {
  const index = buildNameIndex(schema);
  const refs: Array<{ sectionName: string; lineName: string; formulaText: string }> = [
    { sectionName: 'Income Statement', lineName: 'Net Interest Expense', formulaText: 'Debt Schedule.Interest Expense' },
    { sectionName: 'Cash Flow Statement', lineName: 'Debt Borrowings', formulaText: 'Debt Schedule.Borrowings' },
    { sectionName: 'Cash Flow Statement', lineName: 'Debt Repayments', formulaText: 'Debt Schedule.Repayments' },
  ];
  let next = schema;
  for (const r of refs) {
    const target = findSeedLine(next, r.sectionName, r.lineName);
    const result = compileFormula(r.formulaText, index, target.id);
    if (!result.ok) {
      throw new Error(`Default schema cross-reference failed to compile for "${r.lineName}": ${result.errors.join('; ')}`);
    }
    next = {
      ...next,
      sections: next.sections.map((s) =>
        s.name === r.sectionName ? { ...s, lines: s.lines.map((l) => (l.id === target.id ? { ...l, formula: result.formula } : l)) } : s,
      ),
    };
  }
  return next;
}

/** Seeded once, the first time no schema has been saved yet. Fully editable afterward. */
export function createDefaultStatementSchema(): StatementSchema {
  const draftSections = [
    incomeStatement(),
    balanceSheet(),
    cashFlowStatement(),
    ebitdaBridge(),
    workingCapital(),
    creditMetrics(),
    checks(),
  ];
  const index = buildNameIndex({ sections: draftSections });
  const now = new Date().toISOString();
  let schema: StatementSchema = {
    id: DEFAULT_SCHEMA_ID,
    name: 'Basis Default',
    createdAt: now,
    updatedAt: now,
    sections: draftSections.map((s) => compileSection(s, index)),
    drivers: [],
  };

  // Seeds the "Debt Schedule" section's three always-present totals (zero tranches yet, so each
  // is a sum() of nothing) — see lib/debtSchedule.ts's own doc comment for why these exist from
  // the start, before applyDebtScheduleReferences below can point ordinary formulas at them.
  schema = regenerateTemplateDebtSchedule(schema);
  schema = applyDebtScheduleReferences(schema);

  return applyDefaultProjections(schema);
}
