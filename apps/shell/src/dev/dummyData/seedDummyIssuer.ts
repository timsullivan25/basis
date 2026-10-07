// TEMPORARY test data — see ./README.md. Delete this whole folder to remove it.
//
// Builds a fully populated issuer in one click, through the same library calls the mapping
// screen's Save uses (fork the Basis Default template, match the workbook, add debt tranches,
// regenerate the Debt Schedule, resolve actuals, persist import/mapping/model), then goes a step
// further than a manual import would: 5 projected years with real revenue growth, a Downside
// scenario, and DCF / LBO / Recovery Waterfall enabled with their inputs filled in.
import {
  analysisSettingsRepository,
  companyRepository,
  lboCaseRepository,
  mappingRepository,
  modelImportRepository,
  modelRepository,
  scenarioRepository,
  statementSchemaRepository,
  type Company,
  type DebtTrancheProperties,
  type LineMapping,
  type StatementLine,
  type StatementSchema,
} from '../../data';
import { DEFAULT_ADJUSTMENT_INSTANCE_SEEDS, DEFAULT_ADJUSTMENT_TARGET_LINE_NAME, DEFAULT_SCHEMA_ID } from '../../data/defaultStatementSchema';
import { parseBasisTemplate } from '../../lib/parseBasisTemplate';
import { matchStatementLines } from '../../lib/matchStatementLines';
import { buildTimeline, extendTimeline } from '../../lib/periodTimeline';
import { resolveActuals } from '../../lib/resolveActuals';
import { cloneStatementSchemaStructure } from '../../lib/statementSchemaClone';
import { addChildLine } from '../../lib/statementLineChildren';
import { periodsPerYearFor, regenerateDebtSchedule } from '../../lib/debtSchedule';
import { buildNameIndex, compileFormula } from '../../lib/engine/resolve';
import { evaluateModel } from '../../lib/engine/evaluate';
import { recomputeAndCacheModel } from '../../lib/modelRecompute';
import { seedLboCase } from '../../lib/lbo';
import { buildDummyWorkbookGrid, DUMMY_COMPANY_NAME, DUMMY_TRANCHE_ROWS, DUMMY_WORKBOOK_FILE_NAME } from './dummyWorkbook';

const PROJECTED_YEARS = 5;
const BASE_REVENUE_GROWTH = [0.07, 0.06, 0.05, 0.05, 0.04];
const DOWNSIDE_REVENUE_GROWTH = [-0.05, -0.02, 0.01, 0.02, 0.02];
const MIN_CASH = 75;

/** Tier line name (Basis Default's Balance Sheet) → the tranches added under it. */
const TRANCHES: Array<{ tier: string; name: string; row: string; properties: DebtTrancheProperties }> = [
  {
    tier: '1L Debt',
    name: 'Revolver',
    row: DUMMY_TRANCHE_ROWS.revolver,
    properties: {
      debtType: 'revolver', couponType: 'floating', baseRate: 'SOFR', couponRate: 0.075, frequency: 'quarterly',
      maturity: '2029-06-30', commitmentAmount: 150, commitmentFeeRate: 0.00375, repayable: true,
    },
  },
  {
    tier: '1L Debt',
    name: 'Term Loan B',
    row: DUMMY_TRANCHE_ROWS.termLoan,
    properties: {
      debtType: 'term', couponType: 'floating', baseRate: 'SOFR', couponRate: 0.08, frequency: 'quarterly',
      maturity: '2031-03-31', originalFaceValue: 650, amortizationRate: 0.01, repayable: true,
    },
  },
  {
    tier: '2L Debt',
    name: 'Second Lien Term Loan',
    row: DUMMY_TRANCHE_ROWS.secondLien,
    properties: {
      debtType: 'term', couponType: 'fixed', couponRate: 0.095, frequency: 'quarterly',
      maturity: '2032-03-31', originalFaceValue: 200, amortizationRate: 0, repayable: true,
    },
  },
  {
    tier: 'Unsecured Debt',
    name: 'Senior Unsecured Notes',
    row: DUMMY_TRANCHE_ROWS.notes,
    properties: {
      debtType: 'term', couponType: 'fixed', couponRate: 0.0725, frequency: 'semiAnnual',
      maturity: '2033-12-31', originalFaceValue: 300, amortizationRate: 0, repayable: false,
    },
  },
];

function allLines(schema: StatementSchema): StatementLine[] {
  return schema.sections.flatMap((s) => s.lines);
}

function lineNamed(schema: StatementSchema, sectionName: string, lineName: string): StatementLine {
  const line = schema.sections.find((s) => s.name === sectionName)?.lines.find((l) => l.name === lineName);
  if (!line) throw new Error(`Dummy data: "${sectionName} / ${lineName}" isn't in the Basis Default template any more.`);
  return line;
}

function patchLine(schema: StatementSchema, lineId: string, patch: Partial<StatementLine>): StatementSchema {
  return { ...schema, sections: schema.sections.map((s) => ({ ...s, lines: s.lines.map((l) => (l.id === lineId ? { ...l, ...patch } : l)) })) };
}

function manualMapping(targetLineId: string, sourceLineId: string): LineMapping {
  return { targetLineId, sourceLineIds: [sourceLineId], method: 'manual', confidence: 1, note: 'Dummy data', approved: true };
}

/** Basis Default has no tax-rate line, which DCF and LBO both require — add the one a user would
 *  add to resolve it: Income Tax Expense / Pretax Income, right under Income Tax Expense. */
function withEffectiveTaxRate(schema: StatementSchema): StatementSchema {
  const anchor = lineNamed(schema, 'Income Statement', 'Income Tax Expense');
  const id = crypto.randomUUID();
  const compiled = compileFormula('Income Tax Expense / Pretax Income', buildNameIndex(schema), id);
  if (!compiled.ok) throw new Error(`Dummy data: tax rate formula failed to compile: ${compiled.errors.join('; ')}`);
  const line: StatementLine = {
    id, name: 'Effective Tax Rate', role: 'calculated', rowFormat: 'metric', numberFormat: 'percentage', sign: 'natural',
    aggregation: 'none', formula: compiled.formula, projection: null, aliases: [],
  };
  return {
    ...schema,
    sections: schema.sections.map((s) => {
      const at = s.lines.findIndex((l) => l.id === anchor.id);
      if (at === -1) return s;
      const lines = [...s.lines];
      lines.splice(at + 1, 0, line);
      return { ...s, lines };
    }),
  };
}

/** The Basis Template workbook the seed imports — also offered as a download for testing the
 *  manual upload → mapping flow. */
export async function buildDummyWorkbookFile(): Promise<File> {
  const XLSX = await import('xlsx');
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(buildDummyWorkbookGrid()), 'Basis Template');
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new File([bytes], DUMMY_WORKBOOK_FILE_NAME, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export async function seedDummyIssuer(): Promise<Company> {
  const file = await buildDummyWorkbookFile();
  const workbook = await parseBasisTemplate(file);

  const template = (await statementSchemaRepository.list()).find((s) => s.id === DEFAULT_SCHEMA_ID);
  if (!template) throw new Error('Dummy data: the Basis Default template is missing.');

  const existing = (await companyRepository.list()).filter((c) => c.name.startsWith(DUMMY_COMPANY_NAME));
  const company = await companyRepository.create({ name: existing.length === 0 ? DUMMY_COMPANY_NAME : `${DUMMY_COMPANY_NAME} ${existing.length + 1}` });
  await companyRepository.update(company.id, { isPublic: false, valuationMultiple: 9 });

  let { schema } = cloneStatementSchemaStructure(template, crypto.randomUUID(), company.name);
  const mapping = matchStatementLines(schema.sections, workbook.lines);

  // Same default EBITDA adjustment sub-lines the mapping screen seeds for a Basis Default import.
  const adjustmentParent = allLines(schema).find((l) => l.name === DEFAULT_ADJUSTMENT_TARGET_LINE_NAME);
  if (adjustmentParent) {
    for (const seed of DEFAULT_ADJUSTMENT_INSTANCE_SEEDS) {
      const added = addChildLine(schema, { kind: 'line', parentLineId: adjustmentParent.id }, seed.name);
      schema = patchLine(added.schema, added.lineId, { aliases: seed.aliases });
      const newLine = allLines(schema).find((l) => l.id === added.lineId)!;
      Object.assign(mapping, matchStatementLines([{ id: 'seed', name: adjustmentParent.name, lines: [newLine] }], workbook.lines));
    }
  }

  for (const tranche of TRANCHES) {
    const tier = lineNamed(schema, 'Balance Sheet', tranche.tier);
    const added = addChildLine(schema, { kind: 'line', parentLineId: tier.id }, tranche.name);
    schema = patchLine(added.schema, added.lineId, { debtProperties: tranche.properties });
    const source = workbook.lines.find((l) => l.group === 'Debt' && l.name === tranche.row);
    if (!source) throw new Error(`Dummy data: workbook row "${tranche.row}" is missing.`);
    mapping[added.lineId] = manualMapping(added.lineId, source.id);
  }
  // A tier with tranches under it is a rollup now — its own mapping no longer applies.
  for (const tierName of new Set(TRANCHES.map((t) => t.tier))) {
    const tierId = lineNamed(schema, 'Balance Sheet', tierName).id;
    if (mapping[tierId]) mapping[tierId] = { ...mapping[tierId], sourceLineIds: [], method: 'none', confidence: 0 };
  }

  schema = withEffectiveTaxRate(schema);
  const actualTimeline = buildTimeline(workbook.periods);
  schema = regenerateDebtSchedule(schema, periodsPerYearFor(actualTimeline[0].type), false);

  const actuals = resolveActuals(Object.values(mapping), workbook, actualTimeline);
  const savedSchema = await statementSchemaRepository.save(schema);
  const modelImport = await modelImportRepository.create({
    companyId: company.id, templateType: 'basis-template', statementSchemaId: savedSchema.id, file,
  });
  const savedMapping = await mappingRepository.create({
    modelImportId: modelImport.id, statementSchemaId: savedSchema.id, lines: Object.values(mapping),
  });
  let model = await modelRepository.create({
    companyId: company.id, name: modelImport.fileName, statementSchemaId: savedSchema.id, modelImportId: modelImport.id,
    mappingId: savedMapping.id, timeline: actualTimeline, historicals: actuals,
  });

  // Projection horizon, revenue growth and a minimum cash balance so the debt sweep runs (every
  // other driver falls back to its last-actual ratio).
  const timeline = extendTimeline(actualTimeline, PROJECTED_YEARS);
  const revenue = lineNamed(savedSchema, 'Income Statement', 'Revenue');
  const growthDriver = savedSchema.drivers.find((d) => d.targetLineId === revenue.id && d.method === 'growth');
  const projectedOnly = (rates: number[]): (number | null)[] => [...actualTimeline.map(() => null), ...rates];
  const minCashLine = allLines(savedSchema).find((l) => l.debtScheduleRole?.role === 'minimumCashTarget');
  const minCashDriverId = minCashLine?.projection && 'driverId' in minCashLine.projection ? minCashLine.projection.driverId : undefined;
  model = await modelRepository.update(model.id, {
    timeline,
    historicals: Object.fromEntries(Object.entries(actuals).map(([id, values]) => [id, [...values, ...Array(PROJECTED_YEARS).fill(null)]])),
    driverValues: {
      ...(growthDriver ? { [growthDriver.id]: projectedOnly(BASE_REVENUE_GROWTH) } : {}),
      ...(minCashDriverId ? { [minCashDriverId]: projectedOnly(Array(PROJECTED_YEARS).fill(MIN_CASH)) } : {}),
    },
  });
  if (growthDriver) {
    await scenarioRepository.create({ modelId: model.id, name: 'Downside', driverValues: { [growthDriver.id]: projectedOnly(DOWNSIDE_REVENUE_GROWTH) } });
  }

  const evaluation = evaluateModel(savedSchema, model);
  await recomputeAndCacheModel(savedSchema, model, evaluation);

  await analysisSettingsRepository.create(model.id);
  await analysisSettingsRepository.update(model.id, {
    enabledAnalysisIds: ['dcf', 'lbo', 'recoveryWaterfall'],
    dcfInputs: { base: { wacc: 0.09, terminalGrowth: 0.025 } },
    recoveryInputs: { base: { method: 'ebitdaMultiple', multiple: 3, periodIndex: actualTimeline.length - 1, directValue: null, adminCostsPct: 0.025 } },
  });
  await lboCaseRepository.create(
    seedLboCase({ modelId: model.id, baseSchema: savedSchema, baseTimeline: model.timeline, baseEvaluation: evaluation, entryPeriodIndex: actualTimeline.length - 1 }),
  );

  return (await companyRepository.get(company.id)) ?? company;
}

/** Deletes every dummy issuer (by name) and everything hanging off its model. Returns how many. */
export async function removeDummyIssuers(): Promise<number> {
  const dummies = (await companyRepository.list()).filter((c) => c.name.startsWith(DUMMY_COMPANY_NAME));
  for (const company of dummies) {
    const model = await modelRepository.getForCompany(company.id);
    if (model) await modelRepository.remove(model.id);
    await companyRepository.remove(company.id);
  }
  return dummies.length;
}
