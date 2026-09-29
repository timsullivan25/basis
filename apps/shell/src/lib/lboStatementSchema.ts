import { buildGrowthFormula, buildNameIndex, buildRatioFormula, compileFormula, type NameIndex } from './engine/resolve';
import { regenerateDebtSchedule } from './debtSchedule';
import type { DriverDefinition, LineNumberFormat, LineRole, LineSign, StatementLine, StatementSchema, StatementSection } from '../data/types';

interface LineOptions {
  formula?: string;
  aliases?: string[];
  sign?: LineSign;
  numberFormat?: LineNumberFormat;
  role?: LineRole;
  allowsSubLines?: boolean;
  lineKind?: 'debt';
}

/** Same two-phase draft/compile idiom as data/defaultStatementSchema.ts (authored as a raw
 *  formula string, resolved once every line's id exists) — duplicated rather than imported,
 *  since that file's own line()/section() are private and this schema's shape (no rowFormat/
 *  aggregation variety, no Standard-projection seed table keyed by name) is different enough
 *  that sharing them would mean threading unused options through both call sites. */
interface DraftLine extends Omit<StatementLine, 'formula'> {
  formula: string;
}
interface DraftSection extends Omit<StatementSection, 'lines'> {
  lines: DraftLine[];
}

function line(name: string, options: LineOptions = {}): DraftLine {
  const formula = options.formula ?? '';
  const role: LineRole = options.role ?? (formula !== '' ? 'calculated' : 'required');
  const sourced = role === 'required' || role === 'optional';
  return {
    id: crypto.randomUUID(),
    name,
    role,
    rowFormat: formula ? 'total' : 'normal',
    numberFormat: options.numberFormat ?? 'number',
    sign: options.sign ?? 'natural',
    aggregation: name === 'Net Working Capital' || name === 'Total Debt' || name === 'Net Debt' ? 'last' : 'sum',
    formula,
    projection: sourced && formula !== '' ? { method: 'formula' } : null,
    aliases: options.aliases ?? [],
    allowsSubLines: options.allowsSubLines,
    lineKind: options.lineKind,
  };
}

function section(name: string, lines: DraftLine[]): DraftSection {
  return { id: crypto.randomUUID(), name, lines };
}

function compileSection(draft: DraftSection, index: NameIndex): StatementSection {
  return {
    id: draft.id,
    name: draft.name,
    lines: draft.lines.map((draftLine): StatementLine => {
      const result = compileFormula(draftLine.formula, index, draftLine.id);
      if (!result.ok) throw new Error(`LBO schema formula failed to compile for "${draftLine.name}": ${result.errors.join('; ')}`);
      return { ...draftLine, formula: result.formula };
    }),
  };
}

/** Points Net Interest Expense / Debt Borrowings / Debt Repayments at the Debt Schedule's own
 *  always-present totals — same ordinary cross-section formula reference every other pull-through
 *  in this app uses (see data/defaultStatementSchema.ts's own applyDebtScheduleReferences), run
 *  after regenerateDebtSchedule has created those totals to compile against. */
function applyDebtScheduleReferences(schema: StatementSchema): StatementSchema {
  const index = buildNameIndex(schema);
  const refs: Array<{ sectionName: string; lineName: string; formulaText: string }> = [
    { sectionName: 'Income Statement', lineName: 'Net Interest Expense', formulaText: 'Debt Schedule.Interest Expense' },
    { sectionName: 'Cash Flow Statement', lineName: 'Debt Borrowings', formulaText: 'Debt Schedule.Borrowings' },
    { sectionName: 'Cash Flow Statement', lineName: 'Debt Repayments', formulaText: 'Debt Schedule.Repayments' },
  ];
  let next = schema;
  for (const r of refs) {
    const target = next.sections.find((s) => s.name === r.sectionName)!.lines.find((l) => l.name === r.lineName)!;
    const result = compileFormula(r.formulaText, index, target.id);
    if (!result.ok) throw new Error(`LBO schema cross-reference failed to compile for "${r.lineName}": ${result.errors.join('; ')}`);
    next = {
      ...next,
      sections: next.sections.map((s) =>
        s.name === r.sectionName
          ? { ...s, lines: s.lines.map((l) => (l.id === target.id ? { ...l, formula: result.formula, projection: { method: 'formula' as const } } : l)) }
          : s,
      ),
    };
  }
  return next;
}

/** One standard-method driver (growth or percent-of) applied directly by id — no name lookup
 *  needed (unlike data/defaultStatementSchema.ts's own DEFAULT_PROJECTION_SEEDS), since this
 *  schema is small enough to build and drive off the same in-scope line objects in one pass. */
function applyStandardProjections(
  schema: StatementSchema,
  seeds: Array<{ lineId: string; sectionName: string; driverName: string; basisId?: string }>,
): { schema: StatementSchema; driverIdByLineId: Record<string, string> } {
  let next = schema;
  const drivers: DriverDefinition[] = [];
  const driverIdByLineId: Record<string, string> = {};
  function setFormula(sectionName: string, lineId: string, formula: StatementLine['formula'], projection: StatementLine['projection']) {
    next = { ...next, sections: next.sections.map((s) => (s.name === sectionName ? { ...s, lines: s.lines.map((l) => (l.id === lineId ? { ...l, formula, projection } : l)) } : s)) };
  }
  for (const seed of seeds) {
    const driverId = crypto.randomUUID();
    driverIdByLineId[seed.lineId] = driverId;
    if (seed.basisId) {
      drivers.push({ id: driverId, name: seed.driverName, unit: '%', targetLineId: seed.lineId, method: 'percent-of', basisLineId: seed.basisId });
      setFormula(seed.sectionName, seed.lineId, buildRatioFormula(seed.basisId, driverId), { method: 'percent-of', driverId });
    } else {
      drivers.push({ id: driverId, name: seed.driverName, unit: '%', targetLineId: seed.lineId, method: 'growth' });
      setFormula(seed.sectionName, seed.lineId, buildGrowthFormula(seed.lineId, driverId), { method: 'growth', driverId });
    }
  }
  return { schema: { ...next, drivers: [...(next.drivers ?? []), ...drivers] }, driverIdByLineId };
}

/** Every id this schema's own seeding logic (lib/lbo.ts) needs to reach directly, without a
 *  name-based findSummaryLine lookup — returned alongside the schema itself since the caller
 *  builds this schema and immediately needs to seed historicals/driverValues onto these exact
 *  lines. */
export interface LboSchemaLineIds {
  revenue: string;
  ebitda: string;
  da: string;
  capex: string;
  nwc: string;
  taxExpense: string;
  cash: string;
  totalDebt: string;
  /** The standard-method driver id backing each of these lines' own projection — see
   *  applyStandardProjections. */
  revenueGrowthDriverId: string;
  ebitdaMarginDriverId: string;
  daDriverId: string;
  capexDriverId: string;
  nwcDriverId: string;
  taxRateDriverId: string;
}

/**
 * A deliberately thin, purpose-built schema — Revenue → EBITDA → FCF, nothing else — for an
 * LboCase's own private, embedded schema fork (see LboCase's own doc comment for why it's a
 * fresh build here rather than a fork of the base model's own, usually much larger, schema: the
 * user only ever wants to flex a leverage multiple and a handful of growth/margin assumptions
 * here, not re-litigate a full 3-statement build). Every driver-backed line (Revenue, EBITDA
 * margin, D&A/CapEx/NWC % of revenue, tax rate) starts with NO historical/driver values set —
 * lib/lbo.ts's seedLboCase fills those in from the base model's own resolved concepts, and adds
 * the default Term Loan/Revolver tranches under "Total Debt" once entry EBITDA is known.
 */
export function createLboStatementSchema(periodsPerYear: number): { schema: StatementSchema; lineIds: LboSchemaLineIds } {
  const revenue = line('Revenue', { role: 'required' });
  const ebitda = line('EBITDA', { role: 'required', aliases: ['Adjusted EBITDA'] });
  const da = line('D&A', { role: 'required', sign: 'absolute', aliases: ['Depreciation & Amortization'] });
  // "D&A" also exists as a Cash Flow Statement pull-through — qualified so this reads the
  // Income Statement's own raw line, same convention data/defaultStatementSchema.ts uses for the
  // identical ambiguity.
  const ebit = line('EBIT', { formula: 'EBITDA - Income Statement.D&A' });
  const netInterestExpense = line('Net Interest Expense', { sign: 'absolute' });
  const pretaxIncome = line('Pretax Income', { formula: 'EBIT - Net Interest Expense' });
  const taxExpense = line('Income Tax Expense', { role: 'required', sign: 'absolute' });
  const netIncome = line('Net Income', { formula: 'Pretax Income - Income Tax Expense' });
  const incomeStatement = section('Income Statement', [revenue, ebitda, da, ebit, netInterestExpense, pretaxIncome, taxExpense, netIncome]);

  const cfNetIncome = line('Net Income', { formula: 'Net Income' });
  const cfDa = line('D&A', { formula: 'D&A' });
  const changeInNwc = line('Change in Net Working Capital', { formula: 'priorPeriod(Net Working Capital) - Net Working Capital' });
  const cfo = line('Cash Flow from Operations', { formula: 'Cash Flow Statement.Net Income + Cash Flow Statement.D&A + Change in Net Working Capital' });
  const capex = line('Capital Expenditures', { role: 'required', sign: 'absolute', aliases: ['Capex'] });
  const fcf = line('Free Cash Flow', { formula: 'Cash Flow from Operations - Capital Expenditures', aliases: ['FCF'] });
  const debtBorrowings = line('Debt Borrowings', { role: 'optional' });
  const debtRepayments = line('Debt Repayments', { role: 'optional', sign: 'absolute' });
  const netFinancing = line('Net Cash from Financing Activities', { formula: 'Debt Borrowings - Debt Repayments' });
  const netChangeInCash = line('Net Change in Cash', { formula: 'Free Cash Flow + Net Cash from Financing Activities' });
  const cashFlowStatement = section('Cash Flow Statement', [
    cfNetIncome, cfDa, changeInNwc, cfo, capex, fcf, debtBorrowings, debtRepayments, netFinancing, netChangeInCash,
  ]);

  const cash = line('Cash & Equivalents', { formula: 'priorPeriod(Balance Sheet.Cash & Equivalents) + Cash Flow Statement.Net Change in Cash', role: 'required' });
  const nwc = line('Net Working Capital', { role: 'required' });
  const totalDebt = line('Total Debt', { role: 'optional', sign: 'absolute', allowsSubLines: true, lineKind: 'debt' });
  const netDebt = line('Net Debt', { formula: 'Total Debt - Cash & Equivalents' });
  const balanceSheet = section('Balance Sheet', [cash, nwc, totalDebt, netDebt]);

  const draftSections = [incomeStatement, cashFlowStatement, balanceSheet];
  const index = buildNameIndex({ sections: draftSections });
  const now = new Date().toISOString();
  let schema: StatementSchema = {
    id: crypto.randomUUID(),
    name: 'LBO',
    createdAt: now,
    updatedAt: now,
    sections: draftSections.map((s) => compileSection(s, index)),
    drivers: [],
  };

  schema = regenerateDebtSchedule(schema, periodsPerYear, false);
  schema = applyDebtScheduleReferences(schema);
  const projected = applyStandardProjections(schema, [
    { lineId: revenue.id, sectionName: 'Income Statement', driverName: 'Revenue Growth Rate' },
    { lineId: ebitda.id, sectionName: 'Income Statement', driverName: 'EBITDA Margin', basisId: revenue.id },
    { lineId: da.id, sectionName: 'Income Statement', driverName: 'D&A % of Revenue', basisId: revenue.id },
    { lineId: capex.id, sectionName: 'Cash Flow Statement', driverName: 'CapEx % of Revenue', basisId: revenue.id },
    { lineId: nwc.id, sectionName: 'Balance Sheet', driverName: 'Net Working Capital % of Revenue', basisId: revenue.id },
    { lineId: taxExpense.id, sectionName: 'Income Statement', driverName: 'Effective Tax Rate', basisId: pretaxIncome.id },
  ]);
  schema = projected.schema;
  const d = projected.driverIdByLineId;

  return {
    schema,
    lineIds: {
      revenue: revenue.id, ebitda: ebitda.id, da: da.id, capex: capex.id, nwc: nwc.id,
      taxExpense: taxExpense.id, cash: cash.id, totalDebt: totalDebt.id,
      revenueGrowthDriverId: d[revenue.id], ebitdaMarginDriverId: d[ebitda.id], daDriverId: d[da.id],
      capexDriverId: d[capex.id], nwcDriverId: d[nwc.id], taxRateDriverId: d[taxExpense.id],
    },
  };
}

/** The Debt Schedule's generated "Minimum Cash Target" driver — only present once the schema has
 *  ≥1 real tranche (regenerateDebtSchedule's own canRunCashLogic gate — see its doc comment), so
 *  this only resolves to something after lib/lbo.ts's seedLboCase adds the default Term
 *  Loan/Revolver and regenerates the schedule again. Found by debtScheduleRole tag rather than
 *  assumed to be debtSchedule.ts's own private fallback id constant, since that constant isn't
 *  exported and isn't this module's to depend on. */
export function findMinCashTargetDriverId(schema: StatementSchema): string | undefined {
  const minCashTargetLine = schema.sections.flatMap((s) => s.lines).find((l) => l.debtScheduleRole?.role === 'minimumCashTarget');
  return minCashTargetLine?.projection && 'driverId' in minCashTargetLine.projection ? minCashTargetLine.projection.driverId : undefined;
}
