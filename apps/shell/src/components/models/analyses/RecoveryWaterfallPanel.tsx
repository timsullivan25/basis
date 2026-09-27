import { useState } from 'react';
import { Alert, Card, DataTable, Field, Input, MetricCard, Select } from '@basis/design-system';
import {
  statementSchemaRepository,
  type AnalysisSettings,
  type Model,
  type RecoveryInputs,
  type ScenarioKey,
  type StatementSchema,
} from '../../../data';
import { lastActualIndex } from '../../../lib/dcf';
import type { LineValues } from '../../../lib/computedCache';
import {
  computeDistributableValue,
  computeRecoveryWaterfall,
  effectiveRecoveryInputs,
  orderedSeniorityTiers,
} from '../../../lib/recoveryWaterfall';
import { canonicalAliasFor, findSummaryLine } from '../../../lib/summaryLines';
import { formatPeriodValue } from '../mapping/mappingFormatting';

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
 *  uses — this one commits the raw number (a multiple or a direct dollar value), not a /100
 *  percentage. */
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
    : { method: null, multiple: null, periodIndex: null, directValue: null };

  const requiredConcept = inputs.method === 'ebitdaMultiple' ? 'ebitda' : inputs.method === 'revenueMultiple' ? 'revenue' : null;
  const conceptLine = requiredConcept ? findSummaryLine(schema, requiredConcept) : undefined;
  const conceptMissing = requiredConcept !== null && conceptLine === undefined;

  async function assignConceptLine(lineId: string) {
    if (!requiredConcept) return;
    const alias = canonicalAliasFor(requiredConcept);
    const sections = schema.sections.map((section) => ({
      ...section,
      lines: section.lines.map((line) =>
        line.id === lineId && !line.aliases.includes(alias) ? { ...line, aliases: [...line.aliases, alias] } : line,
      ),
    }));
    const updated = await statementSchemaRepository.save({ ...schema, sections });
    onSchemaUpdated(updated);
  }

  const lineGroups = schema.sections
    .map((s) => ({ label: s.name, options: s.lines.map((l) => ({ value: l.id, label: l.name })) }))
    .filter((g) => g.options.length > 0);

  const periodIndex = inputs.periodIndex ?? lastActualIndex(model.timeline);
  const conceptValue = conceptLine ? evaluation.getValue(conceptLine.id, periodIndex) : null;
  const distributableValue = computeDistributableValue(inputs, {
    ebitda: requiredConcept === 'ebitda' ? conceptValue : null,
    revenue: requiredConcept === 'revenue' ? conceptValue : null,
  });

  const tiers = orderedSeniorityTiers(schema);
  const waterfall = computeRecoveryWaterfall(tiers, (lineId) => evaluation.getValue(lineId, periodIndex), distributableValue);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      <Card title="Valuation" icon="calculator" padding="md">
        <div key={activeScenarioId} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
          <div style={{ display: 'flex', gap: 'var(--space-6)', alignItems: 'flex-end' }}>
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
          </div>

          {conceptMissing ? (
            <div
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-5)',
                padding: 'var(--space-4) var(--space-5)', background: 'var(--surface-sunken)', borderRadius: 'var(--radius-md)',
              }}
            >
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>
                {requiredConcept === 'ebitda' ? 'EBITDA' : 'Revenue'} isn't resolved on this schema yet
              </span>
              <Select
                size="sm"
                fullWidth={false}
                style={{ width: 220 }}
                value=""
                options={[{ value: '', label: 'Select a line…' }, { value: ADD_NEW_LINE, label: 'Add a new line…' }]}
                groups={lineGroups}
                onChange={(e) => {
                  const value = e.target.value;
                  if (!value) return;
                  if (value === ADD_NEW_LINE) onOpenStatementDefinitions();
                  else void assignConceptLine(value);
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
                : 'Recovery amounts and percentages will show once every input above is filled in. Tranche balances are shown regardless.'}
            </Alert>
          ) : null}

          <Card title="Recovery by tranche" padding="none">
            <DataTable
              dense
              stickyFirstColumn
              columns={[
                {
                  key: 'name',
                  label: 'Tranche',
                  width: 220,
                  render: (_: unknown, row: (typeof waterfall.tranches)[number]) => (
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', color: 'var(--text-primary)' }}>
                        {row.name}
                      </span>
                      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{row.tierName}</span>
                    </div>
                  ),
                },
                {
                  key: 'balance',
                  label: 'Balance',
                  numeric: true,
                  width: 120,
                  render: (_: unknown, row: (typeof waterfall.tranches)[number]) => formatPeriodValue(row.balance, 'number'),
                },
                {
                  key: 'recoveryAmount',
                  label: 'Recovery ($)',
                  numeric: true,
                  width: 120,
                  render: (_: unknown, row: (typeof waterfall.tranches)[number]) => formatPeriodValue(row.recoveryAmount, 'number'),
                },
                {
                  key: 'recoveryPct',
                  label: 'Recovery (%)',
                  numeric: true,
                  width: 120,
                  render: (_: unknown, row: (typeof waterfall.tranches)[number]) => formatPeriodValue(row.recoveryPct, 'percentage'),
                },
              ]}
              rows={waterfall.tranches}
              rowKey="lineId"
            />
          </Card>
        </>
      ) : null}
    </div>
  );
}
