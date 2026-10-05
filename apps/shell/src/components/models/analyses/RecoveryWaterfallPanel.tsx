import { useState } from 'react';
import { Alert, Badge, Card, DataTable, Field, Input, MetricCard, Select } from '@basis/design-system';
import {
  statementSchemaRepository,
  type AnalysisSettings,
  type Model,
  type RecoveryInputs,
  type ScenarioKey,
  type StatementSchema,
} from '../../../data';
import type { LineValues } from '../../../lib/computedCache';
import {
  computeDistributableValue,
  computeRecoverySensitivity,
  computeRecoveryWaterfall,
  effectiveRecoveryInputs,
  orderedSeniorityTiers,
  type TrancheRecovery,
} from '../../../lib/recoveryWaterfall';
import { assignConceptLine, findSummaryLine } from '../../../lib/summaryLines';
import { formatPeriodValue } from '../mapping/mappingFormatting';
import { RecoverySensitivityChart, type RecoveryRangeRow } from './RecoverySensitivityChart';

/** A table row: real content (admin costs / a tranche / equity) or a `__group` seniority-tier
 *  divider — DataTable renders `__group` rows itself (a full-width label, see DataTable's own
 *  doc comment), never reaching these column `render` functions, so the content fields are safe
 *  to leave undefined on a group row. Equity and (when unset) admin costs carry no real "claim",
 *  only a residual/paid amount — `balance`/`recoveryPct` stay null there, which formatPeriodValue
 *  already renders as "—". */
interface DisplayRow {
  lineId: string;
  __group?: string;
  name?: string;
  tierName?: string;
  balance?: number | null;
  recoveryAmount?: number | null;
  recoveryPct?: number | null;
  isEquity?: boolean;
  isFulcrum?: boolean;
}

interface RecoveryWaterfallPanelProps {
  schema: StatementSchema;
  model: Model;
  evaluation: LineValues;
  analysisSettings: AnalysisSettings | null;
  activeScenarioId: ScenarioKey;
  onUpdateRecoveryInputs: (scenarioId: ScenarioKey, patch: Partial<RecoveryInputs>) => void;
  onSchemaUpdated: (schema: StatementSchema) => void;
  onOpenStatementDefinitions: () => void;
}

const METHOD_OPTIONS = [
  { value: 'ebitdaMultiple', label: 'EBITDA multiple' },
  { value: 'revenueMultiple', label: 'Revenue multiple' },
  { value: 'direct', label: 'Direct entry' },
];

const ADD_NEW_LINE = '__add_new_line__';

/** Local buffer + selectOnFocus + Enter/blur-commit, same pattern DcfPanel's own PercentInput
 *  uses — this one commits the raw number (a multiple or a dollar value), not a /100 percentage. */
function NumberInput({ value, onCommit }: { value: number | null; onCommit: (next: number | null) => void }) {
  const [text, setText] = useState(() => (value === null ? '' : String(value)));
  function commit() {
    const trimmed = text.trim();
    if (trimmed === '') return onCommit(null);
    const n = Number(trimmed);
    onCommit(Number.isNaN(n) ? null : n);
  }
  return (
    <Input
      size="sm"
      mono
      type="number"
      selectOnFocus
      value={text}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
      }}
      onBlur={commit}
      style={{ width: 120 }}
    />
  );
}

function tranche(t: TrancheRecovery, fulcrumLineId: string | null): DisplayRow {
  return {
    lineId: t.lineId,
    name: t.name,
    tierName: t.tierName,
    balance: t.balance,
    recoveryAmount: t.recoveryAmount,
    recoveryPct: t.recoveryPct,
    isFulcrum: t.lineId === fulcrumLineId,
  };
}

export function RecoveryWaterfallPanel({
  schema,
  model,
  evaluation,
  analysisSettings,
  activeScenarioId,
  onUpdateRecoveryInputs,
  onSchemaUpdated,
  onOpenStatementDefinitions,
}: RecoveryWaterfallPanelProps) {
  const inputs: RecoveryInputs = analysisSettings
    ? effectiveRecoveryInputs(analysisSettings, activeScenarioId)
    : { method: null, multiple: null, periodIndex: null, directValue: null, adminCosts: null };

  const requiredConcept = inputs.method === 'ebitdaMultiple' ? 'ebitda' : inputs.method === 'revenueMultiple' ? 'revenue' : null;
  const conceptLine = requiredConcept ? findSummaryLine(schema, requiredConcept) : undefined;
  const conceptMissing = requiredConcept !== null && conceptLine === undefined;

  async function assignConcept(lineId: string) {
    if (!requiredConcept) return;
    onSchemaUpdated(await statementSchemaRepository.save(assignConceptLine(schema, requiredConcept, lineId)));
  }

  const lineGroups = schema.sections
    .map((s) => ({ label: s.name, options: s.lines.map((l) => ({ value: l.id, label: l.name })) }))
    .filter((g) => g.options.length > 0);

  // Defaults to the LAST period in the timeline, not the last actual — a recovery analysis is
  // normally run against a future exit/distress point, not today's balance sheet (unlike DCF's
  // Net Debt, which deliberately reads "now"). Projected periods are always appended after
  // actuals here, so this naturally lands on the last projection when one exists, and degrades
  // to the last actual for a historicals-only model.
  const periodIndex = inputs.periodIndex ?? model.timeline.length - 1;
  const conceptValue = conceptLine ? evaluation.getValue(conceptLine.id, periodIndex) : null;
  const concepts = { ebitda: requiredConcept === 'ebitda' ? conceptValue : null, revenue: requiredConcept === 'revenue' ? conceptValue : null };
  const distributableValue = computeDistributableValue(inputs, concepts);

  const tiers = orderedSeniorityTiers(schema);
  const getBalance = (lineId: string) => evaluation.getValue(lineId, periodIndex);
  const waterfall = computeRecoveryWaterfall(tiers, getBalance, distributableValue, inputs.adminCosts);

  const equityRow: DisplayRow = {
    lineId: '__equity__',
    name: 'Equity',
    tierName: 'Equity',
    balance: null,
    recoveryAmount: waterfall.residualToEquity,
    recoveryPct: null,
    isEquity: true,
  };

  // Grouped by seniority, most senior first — a `__group` divider per tier (see DisplayRow's own
  // doc comment) makes it visible at a glance which claims are pari passu (same group) vs.
  // strictly senior/junior (different groups), the same question the table alone couldn't answer
  // when every row just carried its tier name as a small caption.
  const displayRows: DisplayRow[] = [
    ...(inputs.adminCosts !== null
      ? [
          { lineId: '__group-admin__', __group: 'Priority (paid before any secured debt)' },
          tranche(waterfall.adminCosts, waterfall.fulcrumLineId),
        ]
      : []),
    ...tiers.flatMap((tier) => [
      { lineId: `__group-${tier.tierLineId}__`, __group: tier.tierName },
      ...tier.tranches
        .map((t) => waterfall.tranches.find((r) => r.lineId === t.id))
        .filter((r): r is TrancheRecovery => r !== undefined)
        .map((r) => tranche(r, waterfall.fulcrumLineId)),
    ]),
    { lineId: '__group-equity__', __group: 'Equity' },
    equityRow,
  ];

  const sensitivity = computeRecoverySensitivity(inputs, concepts, tiers, getBalance);
  const sensitivityRows: RecoveryRangeRow[] = sensitivity
    ? [
        ...(inputs.adminCosts !== null
          ? [
              {
                key: waterfall.adminCosts.lineId,
                label: 'Administrative & Priority Claims',
                tierName: 'Priority (paid before any secured debt)',
                low: sensitivity[0].waterfall.adminCosts.recoveryPct,
                base: sensitivity[2].waterfall.adminCosts.recoveryPct,
                high: sensitivity[4].waterfall.adminCosts.recoveryPct,
              },
            ]
          : []),
        ...tiers.flatMap((tier) =>
          tier.tranches.map((t) => ({
            key: t.id,
            label: t.name,
            tierName: tier.tierName,
            low: sensitivity[0].waterfall.tranches.find((r) => r.lineId === t.id)?.recoveryPct ?? null,
            base: sensitivity[2].waterfall.tranches.find((r) => r.lineId === t.id)?.recoveryPct ?? null,
            high: sensitivity[4].waterfall.tranches.find((r) => r.lineId === t.id)?.recoveryPct ?? null,
          })),
        ),
      ]
    : [];
  const equitySensitivityRange =
    sensitivity && sensitivity[0].waterfall.residualToEquity !== null && sensitivity[4].waterfall.residualToEquity !== null
      ? { low: sensitivity[0].waterfall.residualToEquity!, base: sensitivity[2].waterfall.residualToEquity ?? 0, high: sensitivity[4].waterfall.residualToEquity! }
      : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      <Card title="Valuation" icon="calculator" padding="md">
        <div key={activeScenarioId} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
          <div style={{ display: 'flex', gap: 'var(--space-6)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <Field label="Method">
              <Select
                size="sm"
                fullWidth={false}
                style={{ width: 180 }}
                value={inputs.method ?? ''}
                options={[{ value: '', label: 'Choose a method…' }, ...METHOD_OPTIONS]}
                onChange={(e) =>
                  onUpdateRecoveryInputs(activeScenarioId, { method: (e.target.value || null) as RecoveryInputs['method'] })
                }
              />
            </Field>

            {inputs.method === 'ebitdaMultiple' || inputs.method === 'revenueMultiple' ? (
              <>
                <Field label="Multiple">
                  <NumberInput value={inputs.multiple} onCommit={(multiple) => onUpdateRecoveryInputs(activeScenarioId, { multiple })} />
                </Field>
                <Field label="Period">
                  <Select
                    size="sm"
                    fullWidth={false}
                    style={{ width: 140 }}
                    value={String(periodIndex)}
                    options={model.timeline.map((period, i) => ({ value: String(i), label: period.label }))}
                    onChange={(e) => onUpdateRecoveryInputs(activeScenarioId, { periodIndex: Number(e.target.value) })}
                  />
                </Field>
              </>
            ) : null}

            {inputs.method === 'direct' ? (
              <Field label="Distributable value">
                <NumberInput
                  value={inputs.directValue}
                  onCommit={(directValue) => onUpdateRecoveryInputs(activeScenarioId, { directValue })}
                />
              </Field>
            ) : null}

            {inputs.method !== null ? (
              <Field label="Admin & priority costs">
                <NumberInput value={inputs.adminCosts} onCommit={(adminCosts) => onUpdateRecoveryInputs(activeScenarioId, { adminCosts })} />
              </Field>
            ) : null}
          </div>

          {requiredConcept !== null ? (
            <div
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-5)',
                padding: 'var(--space-4) var(--space-5)', background: 'var(--surface-sunken)', borderRadius: 'var(--radius-md)',
              }}
            >
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>
                {conceptMissing
                  ? `${requiredConcept === 'ebitda' ? 'EBITDA' : 'Revenue'} isn't resolved on this schema yet`
                  : `${requiredConcept === 'ebitda' ? 'EBITDA' : 'Revenue'} line`}
              </span>
              <Select
                size="sm"
                fullWidth={false}
                style={{ width: 220 }}
                value={conceptLine?.id ?? ''}
                invalid={conceptMissing}
                options={[
                  ...(conceptLine ? [] : [{ value: '', label: 'Select a line…' }]),
                  { value: ADD_NEW_LINE, label: 'Add a new line…' },
                ]}
                groups={lineGroups}
                onChange={(e) => {
                  const value = e.target.value;
                  if (!value || value === conceptLine?.id) return;
                  if (value === ADD_NEW_LINE) onOpenStatementDefinitions();
                  else void assignConcept(value);
                }}
              />
            </div>
          ) : null}
        </div>
      </Card>

      {inputs.method !== null ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--space-5)' }}>
            <MetricCard label="Distributable Value" value={formatPeriodValue(waterfall.distributableValue, 'number')} />
            <MetricCard label="Total Debt" value={formatPeriodValue(waterfall.totalDebtBalance, 'number')} />
            <MetricCard label="Residual to Equity" value={formatPeriodValue(waterfall.residualToEquity, 'number')} />
          </div>

          {waterfall.distributableValue === null ? (
            <Alert tone="caution" title="Distributable value isn't set yet">
              {conceptMissing
                ? `Resolve ${requiredConcept === 'ebitda' ? 'EBITDA' : 'Revenue'} above, or switch to Direct entry.`
                : 'Recovery amounts and percentages will show once every input above is filled in. Balances are shown regardless.'}
            </Alert>
          ) : null}

          {waterfall.fulcrumLineId !== null ? (
            <Alert tone="caution" icon="split" title="Fulcrum security" compact>
              <strong>{[waterfall.adminCosts, ...waterfall.tranches].find((t) => t.lineId === waterfall.fulcrumLineId)?.name}</strong> is the
              most senior claim not fully recovered at this valuation — restructuring negotiating leverage concentrates here. Everything senior
              is unimpaired; everything junior recovers nothing regardless of how this claim is negotiated.
            </Alert>
          ) : null}

          <Card title="Recovery Waterfall" padding="none">
            <DataTable
              dense
              stickyFirstColumn
              columns={[
                {
                  key: 'name',
                  label: 'Claim',
                  width: 260,
                  render: (_: unknown, row: DisplayRow) => (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                      <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', color: 'var(--text-primary)' }}>{row.name}</span>
                      {row.isFulcrum ? (
                        <Badge
                          tone="caution"
                          size="sm"
                          icon="split"
                          title="Fulcrum security — the most senior claim not fully recovered at this valuation. Everything senior is unimpaired; everything junior recovers nothing regardless. This is where restructuring negotiating leverage concentrates."
                        >
                          Fulcrum
                        </Badge>
                      ) : null}
                    </span>
                  ),
                },
                {
                  key: 'balance',
                  label: 'Balance',
                  numeric: true,
                  width: 120,
                  render: (_: unknown, row: DisplayRow) => formatPeriodValue(row.balance ?? null, 'number'),
                },
                {
                  key: 'recoveryAmount',
                  label: 'Recovery ($)',
                  numeric: true,
                  width: 120,
                  render: (_: unknown, row: DisplayRow) => formatPeriodValue(row.recoveryAmount ?? null, 'number'),
                },
                {
                  key: 'recoveryPct',
                  label: 'Recovery (%)',
                  numeric: true,
                  width: 120,
                  render: (_: unknown, row: DisplayRow) => formatPeriodValue(row.recoveryPct ?? null, 'percentage'),
                },
              ]}
              rows={displayRows}
              rowKey="lineId"
              rowStyle={(row: DisplayRow) => {
                if (row.isEquity) return { fontStyle: 'italic', background: 'var(--surface-sunken)', borderTop: '1px solid var(--border-default)' };
                if (row.isFulcrum) return { background: 'var(--status-caution-bg)' };
                return {};
              }}
            />
          </Card>

          {sensitivityRows.length > 0 || equitySensitivityRange ? (
            <Card
              title="Recovery Sensitivity"
              icon="waves"
              padding="md"
              subtitle={
                inputs.method === 'direct'
                  ? 'Distributable value stepped ±10% / ±20% around today\'s entry.'
                  : 'Multiple stepped ±0.5x / ±1.0x around today\'s entry.'
              }
            >
              <RecoverySensitivityChart rows={sensitivityRows} equityRange={equitySensitivityRange} fulcrumKey={waterfall.fulcrumLineId} />
            </Card>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
