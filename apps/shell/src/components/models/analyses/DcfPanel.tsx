import { useState } from 'react';
import { Alert, Card, DataTable, Field, Icon, Input, MetricCard, Select } from '@basis/design-system';
import { statementSchemaRepository, type AnalysisSettings, type DcfInputs, type Model, type ScenarioKey, type StatementSchema } from '../../../data';
import { ANALYSIS_CATALOG } from '../../../data/analysisCatalog';
import { missingConceptsFor } from '../../../lib/analysisAvailability';
import { canonicalAliasFor, findSummaryLine, type SummaryConcept } from '../../../lib/summaryLines';
import type { LineValues } from '../../../lib/computedCache';
import {
  computeDcfOutputs,
  computeSensitivityGrid,
  computeUfcf,
  effectiveDcfInputs,
  lastActualIndex,
  type DcfConceptLines,
  type DcfUfcfRow,
} from '../../../lib/dcf';
import { formatPeriodValue } from '../mapping/mappingFormatting';

interface DcfPanelProps {
  schema: StatementSchema;
  model: Model;
  evaluation: LineValues;
  analysisSettings: AnalysisSettings | null;
  activeScenarioId: ScenarioKey;
  onUpdateDcfInputs: (scenarioId: ScenarioKey, patch: Partial<DcfInputs>) => void;
  onSchemaUpdated: (schema: StatementSchema) => void;
  onOpenStatementDefinitions: () => void;
}

const CONCEPT_LABELS: Record<SummaryConcept, string> = {
  revenue: 'Revenue', ebitda: 'EBITDA', netDebt: 'Net Debt', netLeverage: 'Net Leverage',
  interestCoverage: 'Interest Coverage', totalDebt: 'Total Debt', totalEquity: 'Total Equity',
  ebit: 'EBIT', da: 'D&A', capex: 'CapEx', nwc: 'Net Working Capital', taxRate: 'Effective Tax Rate',
};

const ADD_NEW_LINE = '__add_new_line__';

const UFCF_ROW_DEFS: Array<{ key: string; label: string; formula: string; get: (r: DcfUfcfRow) => number | null }> = [
  { key: 'ebit', label: 'EBIT', formula: 'The resolved EBIT line', get: (r) => r.ebit },
  {
    key: 'taxes', label: 'Taxes', formula: '− EBIT × Tax Rate',
    get: (r) => (r.ebit !== null && r.taxRate !== null ? -(r.ebit * r.taxRate) : null),
  },
  { key: 'nopat', label: 'NOPAT', formula: 'EBIT × (1 − Tax Rate)', get: (r) => r.nopat },
  { key: 'da', label: '+ D&A', formula: 'The resolved D&A line', get: (r) => r.da },
  { key: 'capex', label: '− CapEx', formula: '− the resolved CapEx line', get: (r) => (r.capex !== null ? -r.capex : null) },
  {
    key: 'deltaNwc', label: '− Δ NWC', formula: '− (Net Working Capital − prior period)',
    get: (r) => (r.deltaNwc !== null ? -r.deltaNwc : null),
  },
  { key: 'ufcf', label: 'Unlevered FCF', formula: 'NOPAT + D&A − CapEx − Δ NWC', get: (r) => r.ufcf },
];

function parsePercent(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isNaN(n) ? null : n / 100;
}

/** Local buffer + selectOnFocus + Enter/blur-commit, same pattern DriverValueInput already uses
 *  — simplified (no wasEditCancelled) since this lives in a plain Card, not a DataTable cell that
 *  can be force-unmounted mid-edit. */
function PercentInput({ value, onCommit }: { value: number | null; onCommit: (next: number | null) => void }) {
  const [text, setText] = useState(() => (value === null ? '' : String(value * 100)));
  return (
    <Input
      size="sm"
      mono
      type="number"
      selectOnFocus
      value={text}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onCommit(parsePercent(text));
      }}
      onBlur={() => onCommit(parsePercent(text))}
      style={{ width: 90 }}
    />
  );
}

export function DcfPanel({
  schema,
  model,
  evaluation,
  analysisSettings,
  activeScenarioId,
  onUpdateDcfInputs,
  onSchemaUpdated,
  onOpenStatementDefinitions,
}: DcfPanelProps) {
  const catalogEntry = ANALYSIS_CATALOG.find((e) => e.id === 'dcf')!;
  const missing = missingConceptsFor(schema, catalogEntry);

  async function assignConceptLine(concept: SummaryConcept, lineId: string) {
    const alias = canonicalAliasFor(concept);
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

  const inputs = analysisSettings ? effectiveDcfInputs(analysisSettings, activeScenarioId) : { wacc: null, terminalGrowth: null };

  const conceptLines: DcfConceptLines | null =
    missing.length === 0
      ? {
          ebit: findSummaryLine(schema, 'ebit')!.id,
          da: findSummaryLine(schema, 'da')!.id,
          capex: findSummaryLine(schema, 'capex')!.id,
          nwc: findSummaryLine(schema, 'nwc')!.id,
          taxRate: findSummaryLine(schema, 'taxRate')!.id,
        }
      : null;

  const ufcfRows = conceptLines ? computeUfcf(evaluation, model.timeline, conceptLines) : [];

  const netDebtLine = findSummaryLine(schema, 'netDebt');
  const netDebt = netDebtLine ? evaluation.getValue(netDebtLine.id, lastActualIndex(model.timeline)) : null;

  const dcfOutputs = ufcfRows.length > 0 ? computeDcfOutputs(ufcfRows, model.timeline, inputs, netDebt) : null;

  const waccExceedsGrowth = inputs.wacc !== null && inputs.terminalGrowth !== null && inputs.wacc <= inputs.terminalGrowth;

  const sensitivity =
    dcfOutputs && inputs.wacc !== null && inputs.terminalGrowth !== null && !waccExceedsGrowth
      ? computeSensitivityGrid(ufcfRows, model.timeline, inputs.wacc, inputs.terminalGrowth)
      : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      {missing.length > 0 ? (
        <Card title="Required lines" icon="list-checks" padding="none">
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {catalogEntry.requiredConcepts.map((concept) => {
              const resolved = findSummaryLine(schema, concept);
              return (
                <div
                  key={concept}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-5)',
                    padding: 'var(--space-4) var(--space-6)', borderBottom: '1px solid var(--border-default)',
                  }}
                >
                  <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>{CONCEPT_LABELS[concept]}</span>
                  {resolved ? (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
                      <Icon name="check" size={12} color="var(--status-positive-fg)" />
                      {resolved.name}
                    </span>
                  ) : (
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
                        else void assignConceptLine(concept, value);
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      ) : null}

      <Card title="DCF" icon="calculator" padding="md">
        <div key={activeScenarioId} style={{ display: 'flex', gap: 'var(--space-6)' }}>
          <Field label="WACC">
            <PercentInput value={inputs.wacc} onCommit={(wacc) => onUpdateDcfInputs(activeScenarioId, { wacc })} />
          </Field>
          <Field label="Terminal growth">
            <PercentInput
              value={inputs.terminalGrowth}
              onCommit={(terminalGrowth) => onUpdateDcfInputs(activeScenarioId, { terminalGrowth })}
            />
          </Field>
        </div>
      </Card>

      {conceptLines && ufcfRows.length > 0 ? (
        <Card title="Unlevered Free Cash Flow" padding="none">
          <DataTable
            dense
            stickyFirstColumn
            columns={[
              {
                key: 'name',
                label: 'Line',
                width: 200,
                render: (_: unknown, row: (typeof UFCF_ROW_DEFS)[number]) => (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', color: 'var(--text-primary)' }}>
                      {row.label}
                    </span>
                    <span title={`Formula: ${row.formula}`}>
                      <Icon name="sigma" size={11} color="var(--text-tertiary)" />
                    </span>
                  </span>
                ),
              },
              ...ufcfRows.map((ufcfRow) => ({
                key: `p${ufcfRow.periodIndex}`,
                label: model.timeline[ufcfRow.periodIndex].label,
                numeric: true,
                width: 110,
                render: (_: unknown, row: (typeof UFCF_ROW_DEFS)[number]) => {
                  const value = row.get(ufcfRow);
                  return (
                    <span
                      style={{
                        fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', fontVariantNumeric: 'var(--numeric-tabular)',
                        color: value === null ? 'var(--text-disabled)' : 'var(--text-body)',
                      }}
                    >
                      {formatPeriodValue(value, 'number')}
                    </span>
                  );
                },
              })),
            ]}
            rows={UFCF_ROW_DEFS}
            rowKey="key"
            rowStyle={(row: (typeof UFCF_ROW_DEFS)[number]) =>
              row.key === 'ufcf'
                ? { fontWeight: 'var(--weight-semibold)', background: 'var(--surface-sunken)', borderTop: '1px solid var(--border-default)' }
                : {}
            }
          />
        </Card>
      ) : null}

      {waccExceedsGrowth ? (
        <Alert tone="negative" title="WACC must exceed the terminal growth rate">
          Enterprise value, the equity bridge and the sensitivity grid can't compute until WACC is higher than terminal growth.
        </Alert>
      ) : null}

      {dcfOutputs && dcfOutputs.enterpriseValue !== null ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--space-5)' }}>
            <MetricCard label="Enterprise Value" value={formatPeriodValue(dcfOutputs.enterpriseValue, 'number')} />
            <MetricCard label="Equity Value" value={formatPeriodValue(dcfOutputs.equityValue, 'number')} />
          </div>

          <Card title="Valuation bridge" padding="none">
            <DataTable
              dense
              columns={[
                { key: 'name', label: 'Line', width: 220, render: (_: unknown, row: { label: string }) => row.label },
                {
                  key: 'value',
                  label: 'Value',
                  numeric: true,
                  render: (_: unknown, row: { value: number | null }) => formatPeriodValue(row.value, 'number'),
                },
              ]}
              rows={[
                { key: 'pvUfcf', label: 'PV of Unlevered FCF', value: dcfOutputs.presentValueOfUfcf },
                { key: 'pvTv', label: 'PV of Terminal Value', value: dcfOutputs.presentValueOfTerminalValue },
                { key: 'ev', label: 'Enterprise Value', value: dcfOutputs.enterpriseValue },
                { key: 'netDebt', label: 'Less: Net Debt', value: dcfOutputs.netDebt === null ? null : -dcfOutputs.netDebt },
                { key: 'equity', label: 'Equity Value', value: dcfOutputs.equityValue },
              ]}
              rowKey="key"
              rowStyle={(row: { key: string }) =>
                row.key === 'ev' || row.key === 'equity'
                  ? { fontWeight: 'var(--weight-semibold)', background: 'var(--surface-sunken)', borderTop: '1px solid var(--border-default)' }
                  : {}
              }
            />
          </Card>

          {sensitivity ? (
            <Card title="Sensitivity — Enterprise Value" padding="none">
              <DataTable
                dense
                stickyFirstColumn
                columns={[
                  {
                    key: 'wacc',
                    label: 'WACC',
                    width: 100,
                    render: (_: unknown, row: { rowIndex: number }) => `${(sensitivity.waccValues[row.rowIndex] * 100).toFixed(2)}%`,
                  },
                  ...sensitivity.terminalGrowthValues.map((g, colIndex) => ({
                    key: `g${colIndex}`,
                    label: `${(g * 100).toFixed(2)}%`,
                    numeric: true,
                    width: 100,
                    background: colIndex === 2 ? 'var(--alpha-blue-06)' : undefined,
                    render: (_: unknown, row: { rowIndex: number }) =>
                      formatPeriodValue(sensitivity.rows[row.rowIndex][colIndex].enterpriseValue, 'number'),
                  })),
                ]}
                rows={sensitivity.waccValues.map((_, rowIndex) => ({ key: `r${rowIndex}`, rowIndex }))}
                rowKey="key"
                rowStyle={(row: { rowIndex: number }) => (row.rowIndex === 2 ? { background: 'var(--alpha-blue-06)' } : {})}
              />
            </Card>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
