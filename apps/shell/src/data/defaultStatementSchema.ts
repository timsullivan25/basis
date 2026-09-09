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
    line('Total Debt', { sign: 'absolute', aliases: ['Total borrowings'] }),
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

function ebitdaBridge(): DraftSection {
  return section('EBITDA', [
    line('Reported EBITDA', { formula: 'EBITDA', required: false }),
    line('Stock Based Compensation Addback', { formula: 'Stock Based Compensation', required: false, rowFormat: 'normal' }),
    line('Restructuring & Severance', { sign: 'absolute' }),
    line('Transaction & Integration Costs', { sign: 'absolute' }),
    line(
      'Total Adjustments',
      { formula: 'Stock Based Compensation Addback + Restructuring & Severance + Transaction & Integration Costs' },
    ),
    line('Adjusted EBITDA', { formula: 'Reported EBITDA + Total Adjustments' }),
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
  return {
    id: DEFAULT_SCHEMA_ID,
    name: 'Basis Default',
    createdAt: new Date().toISOString(),
    sections: draftSections.map((s) => compileSection(s, index)),
    drivers: [],
  };
}
