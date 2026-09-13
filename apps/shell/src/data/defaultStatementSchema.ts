import { buildNameIndex, compileFormula, type NameIndex } from '../lib/engine/resolve';
import type {
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
    line('Net Interest Expense', { sign: 'absolute' }),
    line('Pretax Income', { formula: 'Operating Income - Net Interest Expense', rowFormat: 'normal' }),
    line('Income Tax Expense', { sign: 'absolute' }),
    line('Net Income', { formula: 'Pretax Income - Income Tax Expense' }),
  ]);
}

function balanceSheet(): DraftSection {
  return section('Balance Sheet', [
    line('Cash & Equivalents', { aliases: ['Cash and cash equivalents'] }),
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
    // Debt is broken out by seniority tier so a capital-structure tranche (a LineInstance, see
    // its own doc comment) can attach under the right one via `lineId` — same allowsSubLines
    // mechanism the EBITDA bridge's Delta lines use, no engine changes needed. `sign: 'absolute'`
    // moves onto the tiers (where a mapped value or a tranche's own value actually lands);
    // "Secured Debt"/"Total Debt" are pure subtotals, same as any other formula line. A tier with
    // zero instances and no direct mapping evaluates null and is ignored by sum()'s "ignore
    // blanks" semantics, exactly like an unused EBITDA bridge Delta level.
    line('1L Debt', { sign: 'absolute', required: false, rowFormat: 'normal', allowsSubLines: true }),
    line('2L Debt', { sign: 'absolute', required: false, rowFormat: 'normal', allowsSubLines: true }),
    line('Secured Debt', { formula: 'sum(1L Debt, 2L Debt)' }),
    line('Unsecured Debt', { sign: 'absolute', required: false, rowFormat: 'normal', allowsSubLines: true }),
    line('Total Debt', { formula: 'sum(Secured Debt, Unsecured Debt)', aliases: ['Total borrowings'] }),
    line('Other Long Term Liabilities', { sign: 'absolute' }),
    // "Total Debt" also exists as a Credit Metrics pull-through — qualified so this reads the
    // Balance Sheet's own raw line, not that ambiguity.
    line('Total Liabilities', { formula: 'Total Current Liabilities + Balance Sheet.Total Debt + Other Long Term Liabilities' }),
    line('Total Equity', { formula: 'Total Assets - Total Liabilities', aliases: ["Stockholders' equity"] }),
  ]);
}

function cashFlowStatement(): DraftSection {
  return section('Cash Flow Statement', [
    line('Net Income', { formula: 'Net Income', required: false }),
    line('Depreciation & Amortization', { formula: 'Depreciation & Amortization', required: false, rowFormat: 'normal' }),
    line('Stock Based Compensation', { sign: 'absolute', aliases: ['SBC'] }),
    // "Net Income" and "Depreciation & Amortization" are also Income Statement lines — qualified
    // so this reads the Cash Flow Statement's own pull-through lines defined just above.
    line('Cash Flow from Operations', {
      formula: 'Cash Flow Statement.Net Income + Cash Flow Statement.Depreciation & Amortization + Stock Based Compensation',
    }),
    line('Capital Expenditures', { sign: 'absolute', aliases: ['Capex'] }),
    line('Free Cash Flow', { formula: 'Cash Flow from Operations - Capital Expenditures', aliases: ['FCF'] }),
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

/** Seeded once, the first time no schema has been saved yet. Fully editable afterward. */
export function createDefaultStatementSchema(): StatementSchema {
  const draftSections = [
    incomeStatement(),
    balanceSheet(),
    cashFlowStatement(),
    ebitdaBridge(),
    workingCapital(),
    creditMetrics(),
  ];
  const index = buildNameIndex({ sections: draftSections });
  const now = new Date().toISOString();
  return {
    id: DEFAULT_SCHEMA_ID,
    name: 'Basis Default',
    createdAt: now,
    updatedAt: now,
    sections: draftSections.map((s) => compileSection(s, index)),
    drivers: [],
  };
}
