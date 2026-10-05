import type { DcfInputs, LboCase, LboFinancingInputs, LineNumberFormat, RecoveryInputs, ScenarioKey, StatementSchema, Timeline } from '../data';
import { ANALYSIS_CATALOG } from '../data/analysisCatalog';
import type { LineValues } from './computedCache';
import { missingConceptsFor } from './analysisAvailability';
import { computeDcfOutputs, computeUfcf, lastActualIndex } from './dcf';
import { computeLboOutput, effectiveLboFinancing } from './lbo';
import { adminClaimFor, computeDistributableValue, computeRecoveryWaterfall, defaultRecoveryPeriodIndex, orderedSeniorityTiers } from './recoveryWaterfall';
import { findSummaryLine } from './summaryLines';

/**
 * The analysis side of sensitivity runs: which analysis results can be read as outputs, and which
 * analysis assumptions can be shifted as inputs. Every result is computed by the analysis's own
 * pure compute function (the same one its panel and the AnalysisResult cache call) against one
 * sweep point's evaluation and assumptions, never through a panel.
 */

/** The active scenario's effective assumptions for every enabled analysis. A field is null when
 *  the analysis isn't enabled or has no case yet. Sweep points carry a copy with some fields
 *  shifted. */
export interface AnalysisParams {
  dcf: DcfInputs | null;
  lbo: LboFinancingInputs | null;
  recovery: RecoveryInputs | null;
}

export interface AnalysisContext {
  schema: StatementSchema;
  timeline: Timeline;
  scenarioId: ScenarioKey;
  /** Analyses whose results can be read: enabled and, for DCF, with every required line resolved. */
  enabledIds: string[];
  lboCase: LboCase | null;
  base: AnalysisParams;
}

export const NO_ANALYSIS_PARAMS: AnalysisParams = { dcf: null, lbo: null, recovery: null };

// --- Inputs ------------------------------------------------------------------------------------

export type AnalysisParamId = 'dcf.wacc' | 'dcf.terminalGrowth' | 'lbo.leverageMultiple' | 'lbo.exitMultiple' | 'recovery.multiple' | 'recovery.directValue';

export interface AnalysisParamDef {
  id: AnalysisParamId;
  analysisId: string;
  label: string;
  /** How the assumption's own value displays. */
  numberFormat: LineNumberFormat;
  /** The suggested range, same semantics as a driver's (lib/sensitivity.ts's ShiftKind). */
  kind: 'absolute' | 'relative';
  low: number;
  high: number;
  read(params: AnalysisParams): number | null;
  write(params: AnalysisParams, value: number): AnalysisParams;
}

const PARAM_DEFS: AnalysisParamDef[] = [
  {
    id: 'dcf.wacc', analysisId: 'dcf', label: 'DCF WACC', numberFormat: 'percentage', kind: 'absolute', low: -0.01, high: 0.01,
    read: (p) => p.dcf?.wacc ?? null,
    write: (p, v) => ({ ...p, dcf: { ...p.dcf!, wacc: v } }),
  },
  {
    id: 'dcf.terminalGrowth', analysisId: 'dcf', label: 'DCF Terminal Growth', numberFormat: 'percentage', kind: 'absolute', low: -0.005, high: 0.005,
    read: (p) => p.dcf?.terminalGrowth ?? null,
    write: (p, v) => ({ ...p, dcf: { ...p.dcf!, terminalGrowth: v } }),
  },
  {
    id: 'lbo.leverageMultiple', analysisId: 'lbo', label: 'LBO Leverage', numberFormat: 'multiple', kind: 'absolute', low: -0.5, high: 0.5,
    read: (p) => p.lbo?.leverageMultiple ?? null,
    write: (p, v) => ({ ...p, lbo: { ...p.lbo!, leverageMultiple: v } }),
  },
  {
    // Only offered once an exit multiple is set: a null exit multiple means "same as the implied
    // entry multiple", which has no single value to shift around.
    id: 'lbo.exitMultiple', analysisId: 'lbo', label: 'LBO Exit Multiple', numberFormat: 'multiple', kind: 'absolute', low: -1, high: 1,
    read: (p) => p.lbo?.exitMultiple ?? null,
    write: (p, v) => ({ ...p, lbo: { ...p.lbo!, exitMultiple: v } }),
  },
  {
    id: 'recovery.multiple', analysisId: 'recoveryWaterfall', label: 'Recovery Valuation Multiple', numberFormat: 'multiple', kind: 'absolute', low: -1, high: 1,
    read: (p) => (p.recovery && p.recovery.method !== 'direct' && p.recovery.method !== null ? p.recovery.multiple : null),
    write: (p, v) => ({ ...p, recovery: { ...p.recovery!, multiple: Math.max(0, v) } }),
  },
  {
    id: 'recovery.directValue', analysisId: 'recoveryWaterfall', label: 'Recovery Distributable Value', numberFormat: 'number', kind: 'relative', low: -0.2, high: 0.2,
    read: (p) => (p.recovery?.method === 'direct' ? p.recovery.directValue : null),
    write: (p, v) => ({ ...p, recovery: { ...p.recovery!, directValue: v } }),
  },
];

const PARAM_PREFIX = 'analysis:';

/** Sensitivity inputs share one id space: a driver's id, or `analysis:<param id>`. */
export function analysisInputId(paramId: AnalysisParamId): string {
  return PARAM_PREFIX + paramId;
}

export function analysisParamFor(inputId: string): AnalysisParamDef | undefined {
  return inputId.startsWith(PARAM_PREFIX) ? PARAM_DEFS.find((d) => PARAM_PREFIX + d.id === inputId) : undefined;
}

/** Assumptions of enabled analyses that have a value to shift. */
export function availableAnalysisParams(ctx: AnalysisContext | null): AnalysisParamDef[] {
  if (!ctx) return [];
  return PARAM_DEFS.filter((d) => ctx.enabledIds.includes(d.analysisId) && d.read(ctx.base) !== null);
}

// --- Outputs -----------------------------------------------------------------------------------

export interface AnalysisMetricDef {
  id: string;
  analysisId: string;
  label: string;
  numberFormat: LineNumberFormat;
  compute(ctx: AnalysisContext, evaluation: LineValues, params: AnalysisParams): number | null;
}

/** Reads the analysis results one sweep point produces. Several metrics come out of one
 *  computation (every LBO metric is one computeLboOutput call), so results are cached per
 *  (evaluation, params) pair — the two things a point is made of. Driver-only points share the
 *  starting params object and param-only points share the baseline evaluation, so neither alone
 *  identifies a point. */
const analysisCache = new WeakMap<object, WeakMap<object, Map<string, unknown>>>();

function cached<T>(evaluation: LineValues, params: AnalysisParams, analysisId: string, compute: () => T): T {
  let byParams = analysisCache.get(evaluation);
  if (!byParams) {
    byParams = new WeakMap();
    analysisCache.set(evaluation, byParams);
  }
  let byAnalysis = byParams.get(params);
  if (!byAnalysis) {
    byAnalysis = new Map();
    byParams.set(params, byAnalysis);
  }
  if (!byAnalysis.has(analysisId)) byAnalysis.set(analysisId, compute());
  return byAnalysis.get(analysisId) as T;
}

function dcfOutputs(ctx: AnalysisContext, evaluation: LineValues, params: AnalysisParams) {
  return cached(evaluation, params, 'dcf', () => {
    if (!params.dcf) return null;
    const line = (c: Parameters<typeof findSummaryLine>[1]) => findSummaryLine(ctx.schema, c)?.id;
    const ebit = line('ebit'), da = line('da'), capex = line('capex'), nwc = line('nwc'), taxRate = line('taxRate');
    if (!ebit || !da || !capex || !nwc || !taxRate) return null;
    const ufcfRows = computeUfcf(evaluation, ctx.timeline, { ebit, da, capex, nwc, taxRate });
    if (ufcfRows.length === 0) return null;
    const netDebtLine = findSummaryLine(ctx.schema, 'netDebt');
    const netDebt = netDebtLine ? evaluation.getValue(netDebtLine.id, lastActualIndex(ctx.timeline)) : null;
    return computeDcfOutputs(ufcfRows, ctx.timeline, params.dcf, netDebt);
  });
}

function lboOutput(ctx: AnalysisContext, evaluation: LineValues, params: AnalysisParams) {
  return cached(evaluation, params, 'lbo', () => {
    if (!ctx.lboCase || !params.lbo) return null;
    // The point's financing (already the active scenario's effective values, possibly shifted)
    // becomes the case's Base so computeLboOutput reads it as-is.
    return computeLboOutput({ ...ctx.lboCase, financing: { base: params.lbo } }, 'base', ctx.schema, evaluation, ctx.timeline);
  });
}

function recoveryOutput(ctx: AnalysisContext, evaluation: LineValues, params: AnalysisParams) {
  return cached(evaluation, params, 'recoveryWaterfall', () => {
    const inputs = params.recovery;
    if (!inputs) return null;
    const periodIndex = inputs.periodIndex ?? defaultRecoveryPeriodIndex(ctx.timeline);
    const concept = inputs.method === 'ebitdaMultiple' ? 'ebitda' : inputs.method === 'revenueMultiple' ? 'revenue' : null;
    const conceptLine = concept ? findSummaryLine(ctx.schema, concept) : undefined;
    const conceptValue = conceptLine ? evaluation.getValue(conceptLine.id, periodIndex) : null;
    const distributableValue = computeDistributableValue(inputs, {
      ebitda: concept === 'ebitda' ? conceptValue : null,
      revenue: concept === 'revenue' ? conceptValue : null,
    });
    const getBalance = (lineId: string) => evaluation.getValue(lineId, periodIndex);
    return computeRecoveryWaterfall(orderedSeniorityTiers(ctx.schema, getBalance), getBalance, distributableValue, adminClaimFor(inputs, distributableValue));
  });
}

/** Every analysis result readable in this context. LBO offers one pair per target IRR; Recovery
 *  one recovery rate per tranche. */
export function availableAnalysisMetrics(ctx: AnalysisContext | null): AnalysisMetricDef[] {
  if (!ctx) return [];
  const metrics: AnalysisMetricDef[] = [];
  if (ctx.enabledIds.includes('dcf') && ctx.base.dcf?.wacc != null && ctx.base.dcf.terminalGrowth != null) {
    metrics.push(
      { id: 'dcf.enterpriseValue', analysisId: 'dcf', label: 'DCF Enterprise Value', numberFormat: 'number', compute: (c, e, p) => dcfOutputs(c, e, p)?.enterpriseValue ?? null },
      { id: 'dcf.equityValue', analysisId: 'dcf', label: 'DCF Equity Value', numberFormat: 'number', compute: (c, e, p) => dcfOutputs(c, e, p)?.equityValue ?? null },
    );
  }
  if (ctx.enabledIds.includes('lbo') && ctx.lboCase && ctx.base.lbo) {
    ctx.base.lbo.targetIrrs.forEach((irr, i) => {
      const pct = `${Math.round(irr * 1000) / 10}%`;
      metrics.push(
        {
          id: `lbo.impliedEntryMultiple.${i}`, analysisId: 'lbo', label: `LBO Entry Multiple at ${pct} IRR`, numberFormat: 'multiple',
          compute: (c, e, p) => lboOutput(c, e, p)?.abilityToPay[i]?.impliedEntryMultiple ?? null,
        },
        {
          id: `lbo.impliedEntryEnterpriseValue.${i}`, analysisId: 'lbo', label: `LBO Ability to Pay at ${pct} IRR`, numberFormat: 'number',
          compute: (c, e, p) => lboOutput(c, e, p)?.abilityToPay[i]?.impliedEntryEnterpriseValue ?? null,
        },
      );
    });
  }
  if (ctx.enabledIds.includes('recoveryWaterfall') && ctx.base.recovery?.method) {
    metrics.push({
      id: 'recovery.residualToEquity', analysisId: 'recoveryWaterfall', label: 'Recovery to Equity', numberFormat: 'number',
      compute: (c, e, p) => recoveryOutput(c, e, p)?.residualToEquity ?? null,
    });
    for (const tier of orderedSeniorityTiers(ctx.schema)) {
      for (const tranche of tier.tranches) {
        metrics.push({
          id: `recovery.pct.${tranche.id}`, analysisId: 'recoveryWaterfall', label: `Recovery % — ${tranche.name}`, numberFormat: 'percentage',
          compute: (c, e, p) => recoveryOutput(c, e, p)?.tranches.find((t) => t.lineId === tranche.id)?.recoveryPct ?? null,
        });
      }
    }
  }
  return metrics;
}

/** Which enabled analyses can be read for this schema. DCF also needs every required line to
 *  resolve (the same gate the workspace's DCF cache write uses); LBO and Recovery degrade line by
 *  line in their own panels, so they're readable whenever enabled and their results simply come
 *  back null where an input is missing. */
export function readableAnalysisIds(schema: StatementSchema, enabledIds: string[]): string[] {
  return enabledIds.filter((id) => {
    if (id !== 'dcf') return true;
    const entry = ANALYSIS_CATALOG.find((e) => e.id === id);
    return entry !== undefined && missingConceptsFor(schema, entry).length === 0;
  });
}

/** The effective LBO financing for a scenario, or null without a case. */
export function lboParamsFor(lboCase: LboCase | null, scenarioId: ScenarioKey): LboFinancingInputs | null {
  return lboCase ? effectiveLboFinancing(lboCase.financing, scenarioId) : null;
}
