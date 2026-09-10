import { Button, Card, ChartLegend, DataTable, LineChart, MetricCard, BarChart } from '@basis/design-system';
import type { Model, StatementLine, StatementSchema } from '../../data';
import { formatPeriodValue } from './mapping/mappingFormatting';
import { findSummaryLine, type SummaryConcept } from '../../lib/summaryLines';
import type { LineValues } from '../../lib/computedCache';

interface SummaryPanelProps {
  schema: StatementSchema;
  /** Only `timeline` is actually read — widened to a Pick so a frozen Snapshot (which has no
   *  live Model, just its own embedded timeline) can feed this panel too, via a plain
   *  `{ timeline: snapshot.timeline }`. */
  model: Pick<Model, 'timeline'>;
  /** The minimal shape both a live EvaluationResult and a materialized/cached ComputedResult
   *  satisfy — see lib/computedCache.ts. Callers never need to say which one this is. */
  result: LineValues;
  /** Renders an "Open model" CTA when provided (issuer-page context). Omit on the workspace's own
   *  Summary tab, where you're already inside the workspace. */
  onOpenWorkspace?: () => void;
}

/** The model's own latest ACTUAL period — periods are always built/extended so actuals form a
 *  prefix, but this scans defensively rather than assuming that (same convention evaluate.ts's
 *  own lastActualIndex scan uses). Falls back to the last period overall if the timeline somehow
 *  has no actuals at all. */
function lastActualIndex(model: Pick<Model, 'timeline'>): number {
  for (let i = model.timeline.length - 1; i >= 0; i--) {
    if (model.timeline[i].kind === 'actual') return i;
  }
  return model.timeline.length - 1;
}

function resolveLine(schema: StatementSchema, concept: SummaryConcept): StatementLine | undefined {
  return findSummaryLine(schema, concept);
}

/** Percent change vs. the prior period, for MetricCard's `delta` prop — null (no delta shown)
 *  when there's no prior period, or the prior value is null/zero (division would be meaningless). */
function periodOverPeriodDelta(result: LineValues, lineId: string, index: number): number | null {
  if (index <= 0) return null;
  const latest = result.getValue(lineId, index);
  const prior = result.getValue(lineId, index - 1);
  if (latest === null || prior === null || prior === 0) return null;
  return ((latest - prior) / Math.abs(prior)) * 100;
}

/** Full-timeline trend for a sparkline/chart series. LineChart and Sparkline both have no gap-
 *  rendering for a missing value, so a null is shown as 0 here — the same accepted simplification
 *  already used for the Compare tab's chart (see ModelWorkspaceScreen), not a claim that 0 was
 *  actually mapped for that period. */
function trend(result: LineValues, lineId: string, model: Pick<Model, 'timeline'>): number[] {
  return model.timeline.map((_, i) => result.getValue(lineId, i) ?? 0);
}

export function SummaryPanel({ schema, model, result, onOpenWorkspace }: SummaryPanelProps) {
  const latest = lastActualIndex(model);
  const revenueLine = resolveLine(schema, 'revenue');
  const ebitdaLine = resolveLine(schema, 'ebitda');
  const netDebtLine = resolveLine(schema, 'netDebt');
  const netLeverageLine = resolveLine(schema, 'netLeverage');
  const interestCoverageLine = resolveLine(schema, 'interestCoverage');
  const totalDebtLine = resolveLine(schema, 'totalDebt');
  const totalEquityLine = resolveLine(schema, 'totalEquity');

  const creditMetricLines = [netDebtLine, netLeverageLine, interestCoverageLine].filter((l): l is StatementLine => Boolean(l));
  const hasAnything = Boolean(
    revenueLine || ebitdaLine || totalDebtLine || totalEquityLine || creditMetricLines.length > 0,
  );

  if (!hasAnything) {
    return (
      <div style={{ padding: 'var(--space-8) 0', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
        No summary yet — this schema doesn't have a Revenue, EBITDA or credit-metric line to show.
      </div>
    );
  }

  const trendLines = [revenueLine, ebitdaLine].filter((l): l is StatementLine => Boolean(l));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      {onOpenWorkspace ? (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button variant="primary" iconLeft="layout-dashboard" onClick={onOpenWorkspace}>
            Open model
          </Button>
        </div>
      ) : null}

      {revenueLine || ebitdaLine ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--space-5)' }}>
          {revenueLine ? (
            <MetricCard
              label="Revenue"
              value={formatPeriodValue(result.getValue(revenueLine.id, latest), revenueLine.numberFormat)}
              delta={periodOverPeriodDelta(result, revenueLine.id, latest)}
              deltaLabel="vs prior period"
              spark={trend(result, revenueLine.id, model)}
            />
          ) : null}
          {ebitdaLine ? (
            <MetricCard
              label={ebitdaLine.name}
              value={formatPeriodValue(result.getValue(ebitdaLine.id, latest), ebitdaLine.numberFormat)}
              delta={periodOverPeriodDelta(result, ebitdaLine.id, latest)}
              deltaLabel="vs prior period"
              spark={trend(result, ebitdaLine.id, model)}
            />
          ) : null}
        </div>
      ) : null}

      {trendLines.length > 0 ? (
        <Card title="Trend" padding="md">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <ChartLegend
              size="sm"
              series={trendLines.map((l, i) => ({ key: l.id, label: l.name, color: `var(--chart-${i + 1})` }))}
            />
            <LineChart
              series={trendLines.map((l, i) => ({ key: l.id, data: trend(result, l.id, model), color: `var(--chart-${i + 1})` }))}
              labels={model.timeline.map((p) => p.label)}
              zeroLine
            />
          </div>
        </Card>
      ) : null}

      {(totalDebtLine || totalEquityLine) || creditMetricLines.length > 0 ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 'var(--space-5)' }}>
          {totalDebtLine || totalEquityLine ? (
            <Card title="Capital structure" padding="md">
              <BarChart
                orientation="horizontal"
                showValues
                formatValue={(v) => formatPeriodValue(v, 'number')}
                data={[
                  totalDebtLine
                    ? { label: 'Total Debt', value: result.getValue(totalDebtLine.id, latest) ?? 0, color: 'var(--chart-4)' }
                    : null,
                  totalEquityLine
                    ? { label: 'Total Equity', value: result.getValue(totalEquityLine.id, latest) ?? 0, color: 'var(--chart-1)' }
                    : null,
                ].filter((d): d is { label: string; value: number; color: string } => Boolean(d))}
              />
            </Card>
          ) : null}
          {creditMetricLines.length > 0 ? (
            <Card title="Credit metrics" padding="none">
              <DataTable
                dense
                columns={[
                  { key: 'name', label: 'Metric', render: (_: unknown, row: StatementLine) => row.name },
                  {
                    key: 'value',
                    label: model.timeline[latest]?.label ?? 'Latest',
                    numeric: true,
                    render: (_: unknown, row: StatementLine) => formatPeriodValue(result.getValue(row.id, latest), row.numberFormat),
                  },
                ]}
                rows={creditMetricLines}
                rowKey="id"
              />
            </Card>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
