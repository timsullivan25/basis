import { useMemo, useState } from 'react';
import { Alert, Badge, Button, Card, DataTable, Field, Icon, IconButton, Input, MetricCard, Select, Switch } from '@basis/design-system';
import { statementSchemaRepository, type LboCase, type LboFinancingInputs, type Model, type StatementSchema } from '../../../data';
import { ANALYSIS_CATALOG } from '../../../data/analysisCatalog';
import { missingConceptsFor } from '../../../lib/analysisAvailability';
import { canonicalAliasFor, findSummaryLine, type SummaryConcept } from '../../../lib/summaryLines';
import { addChildLine, childrenOf, removeChildLine } from '../../../lib/statementLineChildren';
import { periodsPerYearFor, regenerateDebtSchedule } from '../../../lib/debtSchedule';
import { applyLeverageMultiple, computeAbilityToPay, DEFAULT_HORIZON_YEARS, type SeedLboCaseParams } from '../../../lib/lbo';
import { evaluateModel } from '../../../lib/engine/evaluate';
import { formatPeriodValue } from '../mapping/mappingFormatting';
import { DebtTranchePropertiesEditor } from '../instances/DebtTranchePropertiesEditor';

interface LboPanelProps {
  schema: StatementSchema;
  model: Model;
  lboCase: LboCase | null;
  onCreateLboCase: (params: Omit<SeedLboCaseParams, 'baseSchema' | 'baseTimeline' | 'baseEvaluation'>) => void;
  onUpdateLboCase: (patch: Partial<Pick<LboCase, 'schema' | 'historicals' | 'driverValues' | 'financing'>>) => void;
  onRemoveLboCase: () => void;
  onSchemaUpdated: (schema: StatementSchema) => void;
  onOpenStatementDefinitions: () => void;
}

const CONCEPT_LABELS: Record<SummaryConcept, string> = {
  revenue: 'Revenue', ebitda: 'EBITDA', netDebt: 'Net Debt', netLeverage: 'Net Leverage',
  interestCoverage: 'Interest Coverage', totalDebt: 'Total Debt', totalEquity: 'Total Equity',
  ebit: 'EBIT', da: 'D&A', capex: 'CapEx', nwc: 'Net Working Capital', taxRate: 'Effective Tax Rate',
  cash: 'Cash & Equivalents', fcf: 'Free Cash Flow',
};
const ADD_NEW_LINE = '__add_new_line__';

function parseNumber(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isNaN(n) ? null : n;
}

function parsePercent(text: string): number | null {
  const n = parseNumber(text);
  return n === null ? null : n / 100;
}

function NumberField({ value, onCommit, suffix }: { value: number | null; onCommit: (next: number | null) => void; suffix?: string }) {
  const [text, setText] = useState(() => (value === null ? '' : String(value)));
  return (
    <Input
      size="sm" mono type="number" selectOnFocus value={text}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter') onCommit(parseNumber(text)); }}
      onBlur={() => onCommit(parseNumber(text))}
      suffix={suffix}
      style={{ width: 110 }}
    />
  );
}

function PercentField({ value, onCommit }: { value: number | null; onCommit: (next: number | null) => void }) {
  const [text, setText] = useState(() => (value === null ? '' : String(value * 100)));
  return (
    <Input
      size="sm" mono type="number" selectOnFocus value={text}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter') onCommit(parsePercent(text)); }}
      onBlur={() => onCommit(parsePercent(text))}
      style={{ width: 90 }}
    />
  );
}

const PROJECTION_ROWS = ['revenue', 'ebitda', 'fcf', 'totalDebt', 'netDebt'] as const;
const PROJECTION_LABELS: Record<(typeof PROJECTION_ROWS)[number], string> = {
  revenue: 'Revenue', ebitda: 'EBITDA', fcf: 'Free Cash Flow', totalDebt: 'Total Debt', netDebt: 'Net Debt',
};

/**
 * LBO — a standalone, extended-horizon projection reusing this app's own schema/debt-schedule
 * engine on a purpose-built LboCase (see data/types.ts's own doc comment for why it's not a
 * second Model row) rather than the base model's own timeline. Setup is a one-time choice (entry
 * period + horizon); after that, only leverage, the financing package's own tranches, and the
 * Ability to Pay targets are meant to be touched — "should basically work when the analysis is
 * turned on," per this analysis's own design goal.
 */
export function LboPanel({
  schema, model, lboCase, onCreateLboCase, onUpdateLboCase, onRemoveLboCase, onSchemaUpdated, onOpenStatementDefinitions,
}: LboPanelProps) {
  const [entryPeriodIndex, setEntryPeriodIndex] = useState(model.timeline.length - 1);
  const [horizonYears, setHorizonYears] = useState(DEFAULT_HORIZON_YEARS);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const catalogEntry = ANALYSIS_CATALOG.find((e) => e.id === 'lbo')!;
  const missing = missingConceptsFor(schema, catalogEntry);

  async function assignConceptLine(concept: SummaryConcept, lineId: string) {
    const alias = canonicalAliasFor(concept);
    const sections = schema.sections.map((section) => ({
      ...section,
      lines: section.lines.map((line) => (line.id === lineId && !line.aliases.includes(alias) ? { ...line, aliases: [...line.aliases, alias] } : line)),
    }));
    const updated = await statementSchemaRepository.save({ ...schema, sections });
    onSchemaUpdated(updated);
  }

  const lineGroups = schema.sections
    .map((s) => ({ label: s.name, options: s.lines.map((l) => ({ value: l.id, label: l.name })) }))
    .filter((g) => g.options.length > 0);

  // Computed unconditionally, ahead of the early return below, so hook order stays stable
  // regardless of whether a case exists yet — falls back to evaluating the base schema itself
  // (a throwaway result, discarded immediately by that return) rather than skipping the hook.
  const lboEvaluation = useMemo(() => {
    const source = lboCase ?? { schema, timeline: model.timeline, historicals: {}, driverValues: {} };
    return evaluateModel(source.schema, { timeline: source.timeline, historicals: source.historicals, driverValues: source.driverValues });
  }, [lboCase, schema, model.timeline]);

  if (!lboCase) {
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

        <Card title="LBO" icon="landmark" padding="md">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
            {missing.includes('revenue') || missing.includes('ebitda') ? (
              <Alert tone="negative" title="Revenue and EBITDA must resolve before an LBO case can be seeded">
                Assign or add lines matching Revenue/EBITDA above first.
              </Alert>
            ) : (
              <>
                {missing.length > 0 ? (
                  <Alert tone="caution" title="Some inputs are missing — the seeded case will show gaps for them">
                    D&A, CapEx, Net Working Capital and the tax rate all improve the seed (see above) but aren't required to get started.
                  </Alert>
                ) : null}
                <div style={{ display: 'flex', gap: 'var(--space-6)' }}>
                  <Field label="Entry period" hint="LTM figures at close — new debt is drawn the period after">
                    <Select
                      size="sm"
                      value={String(entryPeriodIndex)}
                      options={model.timeline.map((p, i) => ({ value: String(i), label: p.label }))}
                      onChange={(e) => setEntryPeriodIndex(Number(e.target.value))}
                    />
                  </Field>
                  <Field label="Horizon (years)">
                    <NumberField value={horizonYears} onCommit={(v) => setHorizonYears(v ?? DEFAULT_HORIZON_YEARS)} />
                  </Field>
                </div>
                <Button
                  variant="primary"
                  iconLeft="landmark"
                  onClick={() => onCreateLboCase({ modelId: model.id, entryPeriodIndex, horizonYears })}
                >
                  Create LBO Case
                </Button>
              </>
            )}
          </div>
        </Card>
      </div>
    );
  }

  const lineIds = {
    revenue: findSummaryLine(lboCase.schema, 'revenue')?.id,
    ebitda: findSummaryLine(lboCase.schema, 'ebitda')?.id,
    fcf: findSummaryLine(lboCase.schema, 'fcf')?.id,
    totalDebt: findSummaryLine(lboCase.schema, 'totalDebt')?.id,
    netDebt: findSummaryLine(lboCase.schema, 'netDebt')?.id,
    cash: findSummaryLine(lboCase.schema, 'cash')?.id,
  };

  const periodsPerYear = periodsPerYearFor(lboCase.timeline[0]?.type ?? 'FY');

  function regenerateAndUpdate(nextSchema: StatementSchema, historicals = lboCase!.historicals) {
    const regenerated = regenerateDebtSchedule(nextSchema, periodsPerYear, false);
    onUpdateLboCase({ schema: regenerated, historicals });
  }

  function updateFinancing(patch: Partial<LboFinancingInputs>) {
    onUpdateLboCase({ financing: { ...lboCase!.financing, ...patch } });
  }

  function commitLeverage(next: number | null) {
    if (next === null || !lineIds.totalDebt || !lineIds.ebitda) return;
    const resized = applyLeverageMultiple(lboCase!, lineIds.totalDebt, lineIds.ebitda, next);
    onUpdateLboCase({ schema: resized.schema, historicals: resized.historicals, financing: { ...lboCase!.financing, leverageMultiple: next } });
  }

  const tranches = lineIds.totalDebt ? childrenOf(lboCase.schema, lineIds.totalDebt) : [];

  function addTranche() {
    if (!lineIds.totalDebt) return;
    const { schema: withLine, lineId } = addChildLine(lboCase!.schema, { kind: 'line', parentLineId: lineIds.totalDebt }, 'New Tranche');
    const patched: StatementSchema = {
      ...withLine,
      sections: withLine.sections.map((s) => ({
        ...s,
        lines: s.lines.map((l) => (l.id === lineId ? { ...l, debtProperties: { debtType: 'term', couponType: 'fixed', repayable: true } } : l)),
      })),
    };
    const historicals = { ...lboCase!.historicals, [lineId]: lboCase!.timeline.map((_, i) => (i === 0 ? 0 : null)) };
    regenerateAndUpdate(patched, historicals);
  }

  function removeTranche(lineId: string) {
    regenerateAndUpdate(removeChildLine(lboCase!.schema, lineId));
  }

  function updateTrancheProperties(lineId: string, patch: Partial<NonNullable<(typeof tranches)[number]['debtProperties']>>) {
    const nextSchema: StatementSchema = {
      ...lboCase!.schema,
      sections: lboCase!.schema.sections.map((s) => ({
        ...s,
        lines: s.lines.map((l) => (l.id === lineId ? { ...l, debtProperties: { ...l.debtProperties, ...patch } } : l)),
      })),
    };
    regenerateAndUpdate(nextSchema);
  }

  const abilityToPay =
    lineIds.ebitda && lineIds.totalDebt && lineIds.cash
      ? computeAbilityToPay(lboCase, lboEvaluation, { ebitda: lineIds.ebitda, totalDebt: lineIds.totalDebt, cash: lineIds.cash })
      : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
          Entry: {lboCase.entryPeriodLabel} · {lboCase.timeline.length - 1}yr horizon
        </span>
        {confirmRemove ? (
          <span style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>Delete this LBO case?</span>
            <Button size="sm" variant="danger" onClick={onRemoveLboCase}>Delete</Button>
            <Button size="sm" variant="secondary" onClick={() => setConfirmRemove(false)}>Cancel</Button>
          </span>
        ) : (
          <IconButton icon="trash-2" label="Delete LBO case" size="sm" variant="ghost" onClick={() => setConfirmRemove(true)} />
        )}
      </div>

      <Card title="Financing" icon="landmark" padding="md">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
          <div style={{ display: 'flex', gap: 'var(--space-6)' }}>
            <Field label="Leverage" hint="× entry EBITDA — sizes the Term Loan">
              <NumberField value={lboCase.financing.leverageMultiple} onCommit={commitLeverage} suffix="x" />
            </Field>
            <Field label="Transaction expenses" hint="% of entry EBITDA">
              <PercentField value={lboCase.financing.transactionExpensesPct} onCommit={(v) => updateFinancing({ transactionExpensesPct: v })} />
            </Field>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <span style={{ fontSize: 'var(--text-2xs)', fontWeight: 'var(--weight-semibold)', letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>
              Tranches
            </span>
            {tranches.map((tranche) => (
              <TrancheRow
                key={tranche.id}
                name={tranche.name}
                properties={tranche.debtProperties ?? {}}
                onChange={(patch) => updateTrancheProperties(tranche.id, patch)}
                onRemove={() => removeTranche(tranche.id)}
              />
            ))}
            <Button size="sm" variant="secondary" iconLeft="plus" onClick={addTranche}>
              Add tranche
            </Button>
          </div>
        </div>
      </Card>

      {lineIds.ebitda && lineIds.fcf && lineIds.totalDebt && lineIds.netDebt && lineIds.revenue ? (
        <Card title="Projection" padding="none">
          <DataTable
            dense
            stickyFirstColumn
            columns={[
              { key: 'name', label: 'Line', width: 160, render: (_: unknown, row: { label: string }) => row.label },
              ...lboCase.timeline.map((period, i) => ({
                key: `p${i}`,
                label: period.label,
                numeric: true,
                width: 100,
                render: (_: unknown, row: { key: string }) => {
                  const id = lineIds[row.key as (typeof PROJECTION_ROWS)[number]];
                  const value = id ? lboEvaluation.getValue(id, i) : null;
                  return formatPeriodValue(value, 'number');
                },
              })),
            ]}
            rows={PROJECTION_ROWS.map((key) => ({ key, label: PROJECTION_LABELS[key] }))}
            rowKey="key"
          />
        </Card>
      ) : null}

      <Card title="Ability to Pay" icon="target" padding="md">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
          <div style={{ display: 'flex', gap: 'var(--space-6)', alignItems: 'flex-end' }}>
            <Field label="Exit period">
              <Select
                size="sm"
                value={String(lboCase.financing.exitPeriodIndex ?? lboCase.timeline.length - 1)}
                options={lboCase.timeline.map((p, i) => ({ value: String(i), label: p.label }))}
                onChange={(e) => updateFinancing({ exitPeriodIndex: Number(e.target.value) })}
              />
            </Field>
            <Field label="Exit multiple">
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                <Switch
                  size="sm"
                  checked={lboCase.financing.exitMultiple === null}
                  onChange={(sameAsEntry) => updateFinancing({ exitMultiple: sameAsEntry ? null : (lboCase.financing.exitMultiple ?? 8) })}
                  label="No expansion"
                />
                {lboCase.financing.exitMultiple !== null ? (
                  <NumberField value={lboCase.financing.exitMultiple} onCommit={(v) => updateFinancing({ exitMultiple: v })} suffix="x" />
                ) : null}
              </div>
            </Field>
          </div>

          <DataTable
            dense
            columns={[
              {
                key: 'targetIrr', label: 'Target IRR', width: 110,
                render: (_: unknown, row: { rowIndex: number }) => (
                  <PercentField
                    value={lboCase.financing.targetIrrs[row.rowIndex]}
                    onCommit={(v) => {
                      if (v === null) return;
                      const next = [...lboCase.financing.targetIrrs];
                      next[row.rowIndex] = v;
                      updateFinancing({ targetIrrs: next });
                    }}
                  />
                ),
              },
              {
                key: 'multiple', label: 'Implied Entry Multiple', numeric: true, width: 150,
                render: (_: unknown, row: { rowIndex: number }) => {
                  const v = abilityToPay[row.rowIndex]?.impliedEntryMultiple;
                  return v != null ? `${v.toFixed(2)}x` : '—';
                },
              },
              {
                key: 'ev', label: 'Implied Entry EV', numeric: true, width: 140,
                render: (_: unknown, row: { rowIndex: number }) => formatPeriodValue(abilityToPay[row.rowIndex]?.impliedEntryEnterpriseValue ?? null, 'number'),
              },
              {
                key: 'equity', label: 'Sponsor Equity Check', numeric: true, width: 150,
                render: (_: unknown, row: { rowIndex: number }) => formatPeriodValue(abilityToPay[row.rowIndex]?.sponsorEquityCheck ?? null, 'number'),
              },
              {
                key: 'exitEquity', label: 'Exit Equity Value', numeric: true, width: 140,
                render: (_: unknown, row: { rowIndex: number }) => formatPeriodValue(abilityToPay[row.rowIndex]?.exitEquityValue ?? null, 'number'),
              },
              {
                key: 'moic', label: 'MOIC', numeric: true, width: 90,
                render: (_: unknown, row: { rowIndex: number }) => {
                  const v = abilityToPay[row.rowIndex]?.moic;
                  return v != null ? `${v.toFixed(2)}x` : '—';
                },
              },
            ]}
            rows={lboCase.financing.targetIrrs.map((_, rowIndex) => ({ key: `r${rowIndex}`, rowIndex }))}
            rowKey="key"
          />

          {abilityToPay.length > 0 && abilityToPay.every((r) => r.impliedEntryMultiple === null) ? (
            <Alert tone="caution" title="No priceable structure at these targets">
              Either the leverage/exit assumptions can't clear a target IRR from this cash flow path, or the exit period has no resolved EBITDA/debt yet.
            </Alert>
          ) : null}
        </div>
      </Card>

      {lineIds.ebitda ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--space-5)' }}>
          <MetricCard label="Entry EBITDA" value={formatPeriodValue(lboEvaluation.getValue(lineIds.ebitda, 0), 'number')} />
          <MetricCard label="Entry Leverage" value={lboCase.financing.leverageMultiple !== null ? `${lboCase.financing.leverageMultiple.toFixed(2)}x` : '—'} />
        </div>
      ) : null}
    </div>
  );
}

function TrancheRow({
  name,
  properties,
  onChange,
  onRemove,
}: {
  name: string;
  properties: NonNullable<import('../../../data').StatementLine['debtProperties']>;
  onChange: (patch: Partial<NonNullable<import('../../../data').StatementLine['debtProperties']>>) => void;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={{ border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)', padding: 'var(--space-4)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button
          onClick={() => setExpanded((v) => !v)}
          style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
        >
          <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', color: 'var(--text-primary)' }}>{name}</span>
          <Badge size="sm" tone="neutral">{properties.debtType === 'revolver' ? 'Revolver' : 'Term'}</Badge>
        </button>
        <IconButton icon="trash-2" label={`Remove ${name}`} size="sm" variant="ghost" onClick={onRemove} />
      </div>
      {expanded ? <DebtTranchePropertiesEditor instance={properties} onChange={onChange} /> : null}
    </div>
  );
}
