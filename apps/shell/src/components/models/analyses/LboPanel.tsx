import { useMemo, useState } from 'react';
import { Alert, Badge, Button, Card, DataTable, Field, Icon, IconButton, Input, MetricCard, Select, Switch } from '@basis/design-system';
import { statementSchemaRepository, type LboCase, type LboFinancingInputs, type Model, type ScenarioKey, type StatementSchema } from '../../../data';
import { ANALYSIS_CATALOG } from '../../../data/analysisCatalog';
import { missingConceptsFor } from '../../../lib/analysisAvailability';
import { canonicalAliasFor, findSummaryLine, type SummaryConcept } from '../../../lib/summaryLines';
import { addChildLine, childrenOf, removeChildLine } from '../../../lib/statementLineChildren';
import { periodsPerYearFor, regenerateDebtSchedule } from '../../../lib/debtSchedule';
import { computeLboOutput, computeLeverageLinkedFaceValue, DEFAULT_HORIZON_YEARS, effectiveLboFinancing, type SeedLboCaseParams } from '../../../lib/lbo';
import { formatPeriodValue } from '../mapping/mappingFormatting';
import { DebtTranchePropertiesEditor } from '../instances/DebtTranchePropertiesEditor';
import type { LineValues } from '../../../lib/computedCache';

interface LboPanelProps {
  schema: StatementSchema;
  model: Model;
  evaluation: LineValues;
  activeScenarioId: ScenarioKey;
  lboCase: LboCase | null;
  onCreateLboCase: (params: Omit<SeedLboCaseParams, 'baseSchema' | 'baseTimeline' | 'baseEvaluation'>) => void;
  onUpdateLboCase: (patch: Partial<Pick<LboCase, 'schema' | 'financing' | 'leverageLinkedTrancheId'>>) => void;
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
 * second Model row, and for exactly what it does/doesn't store). Every number that comes from the
 * base model (Revenue/EBITDA/D&A/CapEx/Net Working Capital/tax rate at the entry period, and the
 * leverage-linked tranche's own face value) is re-resolved live against whichever scenario is
 * active on every render via buildLboEvaluationInputs — never read back from storage — so
 * switching scenarios or editing a base-model driver updates this panel with no re-seed step, the
 * same way DCF already works. Setup (entry period + horizon) is a one-time choice; financing
 * (leverage, target IRRs, exit assumptions) is per-scenario, same sparse-cascade-off-Base
 * convention as DCF's own WACC/terminal growth.
 */
export function LboPanel({
  schema, model, evaluation, activeScenarioId, lboCase, onCreateLboCase, onUpdateLboCase, onRemoveLboCase, onSchemaUpdated, onOpenStatementDefinitions,
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

  // Rebuilt from the live base evaluation on every render (see computeLboOutput's own doc
  // comment — the same function ModelWorkspaceScreen's own AnalysisResult write-through cache
  // calls, so the panel and the cache never drift apart) — computed unconditionally, ahead of the
  // early return below, so hook order stays stable regardless of whether a case exists yet. No
  // case yet means nothing to compute: an empty result, not a wasted call against a fabricated
  // stand-in case.
  const output = useMemo(() => {
    if (!lboCase) return { projection: [], abilityToPay: [] };
    return computeLboOutput(lboCase, activeScenarioId, schema, evaluation, model.timeline);
  }, [lboCase, activeScenarioId, schema, evaluation, model.timeline]);

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
            {missing.length > 0 ? (
              <Alert tone="negative" title="All required lines must resolve before an LBO case can be seeded">
                A gap in any one of these — not just Revenue/EBITDA — nulls Net Income, Free Cash Flow and the whole debt-schedule sweep. Assign or add lines matching each one above first.
              </Alert>
            ) : (
              <>
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

  const totalDebtLine = findSummaryLine(lboCase.schema, 'totalDebt');
  const periodsPerYear = periodsPerYearFor(lboCase.timeline[0]?.type ?? 'FY');
  const financing = effectiveLboFinancing(lboCase.financing, activeScenarioId);
  const entryPeriodLabel = model.timeline[Math.min(lboCase.entryPeriodIndex, model.timeline.length - 1)]?.label ?? '—';

  function regenerateAndUpdate(nextSchema: StatementSchema, extraPatch?: Partial<Pick<LboCase, 'leverageLinkedTrancheId'>>) {
    onUpdateLboCase({ schema: regenerateDebtSchedule(nextSchema, periodsPerYear, false), ...extraPatch });
  }

  // Scenario-scoped: only the ACTIVE scenario's entry in `financing` is patched, sparse against
  // 'base' for every other field — same per-field convention ModelWorkspaceScreen's own
  // updateDcfInputs uses for WACC/terminal growth.
  function updateFinancing(patch: Partial<LboFinancingInputs>) {
    const current = lboCase!.financing[activeScenarioId] ?? financing;
    onUpdateLboCase({ financing: { ...lboCase!.financing, [activeScenarioId]: { ...current, ...patch } } });
  }

  const tranches = totalDebtLine ? childrenOf(lboCase.schema, totalDebtLine.id) : [];
  const leverageLinkedTranche = tranches.find((t) => t.id === lboCase.leverageLinkedTrancheId);
  const liveEntryEbitda = output.projection[0]?.ebitda ?? null;
  const liveTermLoanFaceValue = computeLeverageLinkedFaceValue(financing.leverageMultiple, liveEntryEbitda);

  function addTranche() {
    if (!totalDebtLine) return;
    const { schema: withLine, lineId } = addChildLine(lboCase!.schema, { kind: 'line', parentLineId: totalDebtLine.id }, 'New Tranche');
    const patched: StatementSchema = {
      ...withLine,
      sections: withLine.sections.map((s) => ({
        ...s,
        lines: s.lines.map((l) => (l.id === lineId ? { ...l, debtProperties: { debtType: 'term', couponType: 'fixed', repayable: true } } : l)),
      })),
    };
    // If the leverage-linked tranche was removed earlier and never replaced, this new tranche
    // becomes the one the "Leverage" input controls — same as seedLboCase's own first choice —
    // rather than leaving leverageMultiple permanently disconnected from every tranche's face
    // value. Folded into the same update as the schema patch (rather than a second, separate
    // onUpdateLboCase call) so the two can't race against each other's read-merge-write.
    regenerateAndUpdate(patched, leverageLinkedTranche ? undefined : { leverageLinkedTrancheId: lineId });
  }

  function removeTranche(lineId: string) {
    const nextSchema = removeChildLine(lboCase!.schema, lineId);
    regenerateAndUpdate(nextSchema, lineId === lboCase!.leverageLinkedTrancheId ? { leverageLinkedTrancheId: null } : undefined);
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

  return (
    // Keyed on the active scenario so every per-scenario field below (NumberField/PercentField,
    // each buffering its own local text state — see their own definitions) remounts fresh with
    // the new scenario's value on switch, rather than keeping stale text from the one just left.
    // Same fix DcfPanel's own WACC/terminal-growth fields already use for the identical reason.
    <div key={activeScenarioId} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
          Entry: {entryPeriodLabel} · {lboCase.timeline.length - 1}yr horizon
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
            <Field label="Leverage" hint="× entry EBITDA — sizes the Term Loan, live">
              <NumberField value={financing.leverageMultiple} onCommit={(v) => v !== null && updateFinancing({ leverageMultiple: v })} suffix="x" />
            </Field>
            <Field label="Transaction expenses" hint="% of entry EBITDA">
              <PercentField value={financing.transactionExpensesPct} onCommit={(v) => updateFinancing({ transactionExpensesPct: v })} />
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
                leverageLinked={tranche.id === leverageLinkedTranche?.id}
                liveFaceValue={liveTermLoanFaceValue}
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
                const value = output.projection[i]?.[row.key as (typeof PROJECTION_ROWS)[number]] ?? null;
                return formatPeriodValue(value, 'number');
              },
            })),
          ]}
          rows={PROJECTION_ROWS.map((key) => ({ key, label: PROJECTION_LABELS[key] }))}
          rowKey="key"
        />
      </Card>

      <Card title="Ability to Pay" icon="target" padding="md">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
          <div style={{ display: 'flex', gap: 'var(--space-6)', alignItems: 'flex-end' }}>
            <Field label="Exit period">
              <Select
                size="sm"
                value={String(financing.exitPeriodIndex ?? lboCase.timeline.length - 1)}
                options={lboCase.timeline.map((p, i) => ({ value: String(i), label: p.label }))}
                onChange={(e) => updateFinancing({ exitPeriodIndex: Number(e.target.value) })}
              />
            </Field>
            <Field label="Exit multiple">
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                <Switch
                  size="sm"
                  checked={financing.exitMultiple === null}
                  onChange={(sameAsEntry) => updateFinancing({ exitMultiple: sameAsEntry ? null : (financing.exitMultiple ?? 8) })}
                  label="No expansion"
                />
                {financing.exitMultiple !== null ? (
                  <NumberField value={financing.exitMultiple} onCommit={(v) => updateFinancing({ exitMultiple: v })} suffix="x" />
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
                    value={financing.targetIrrs[row.rowIndex]}
                    onCommit={(v) => {
                      if (v === null) return;
                      const next = [...financing.targetIrrs];
                      next[row.rowIndex] = v;
                      updateFinancing({ targetIrrs: next });
                    }}
                  />
                ),
              },
              {
                key: 'multiple', label: 'Implied Entry Multiple', numeric: true, width: 150,
                render: (_: unknown, row: { rowIndex: number }) => {
                  const v = output.abilityToPay[row.rowIndex]?.impliedEntryMultiple;
                  return v != null ? `${v.toFixed(2)}x` : '—';
                },
              },
              {
                key: 'ev', label: 'Implied Entry EV', numeric: true, width: 140,
                render: (_: unknown, row: { rowIndex: number }) => formatPeriodValue(output.abilityToPay[row.rowIndex]?.impliedEntryEnterpriseValue ?? null, 'number'),
              },
              {
                key: 'equity', label: 'Sponsor Equity Check', numeric: true, width: 150,
                render: (_: unknown, row: { rowIndex: number }) => formatPeriodValue(output.abilityToPay[row.rowIndex]?.sponsorEquityCheck ?? null, 'number'),
              },
              {
                key: 'exitEquity', label: 'Exit Equity Value', numeric: true, width: 140,
                render: (_: unknown, row: { rowIndex: number }) => formatPeriodValue(output.abilityToPay[row.rowIndex]?.exitEquityValue ?? null, 'number'),
              },
              {
                key: 'moic', label: 'MOIC', numeric: true, width: 90,
                render: (_: unknown, row: { rowIndex: number }) => {
                  const v = output.abilityToPay[row.rowIndex]?.moic;
                  return v != null ? `${v.toFixed(2)}x` : '—';
                },
              },
            ]}
            rows={financing.targetIrrs.map((_, rowIndex) => ({ key: `r${rowIndex}`, rowIndex }))}
            rowKey="key"
          />

          {output.abilityToPay.length > 0 && output.abilityToPay.every((r) => r.impliedEntryMultiple === null) ? (
            <Alert tone="caution" title="No priceable structure at these targets">
              Either the leverage/exit assumptions can't clear a target IRR from this cash flow path, or the exit period has no resolved EBITDA/debt yet.
            </Alert>
          ) : null}
        </div>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--space-5)' }}>
        <MetricCard label="Entry EBITDA" value={formatPeriodValue(liveEntryEbitda, 'number')} />
        <MetricCard label="Entry Leverage" value={financing.leverageMultiple !== null ? `${financing.leverageMultiple.toFixed(2)}x` : '—'} />
      </div>
    </div>
  );
}

function TrancheRow({
  name,
  properties,
  leverageLinked,
  liveFaceValue,
  onChange,
  onRemove,
}: {
  name: string;
  properties: NonNullable<import('../../../data').StatementLine['debtProperties']>;
  /** True for the one tranche the panel's own "Leverage" input controls — its face value is
   *  always shown live (leverageMultiple × this scenario's own entry EBITDA) and isn't editable
   *  here; every other tranche's face value is a genuine, user-set deal term (see
   *  lib/lbo.ts's buildLboEvaluationInputs). */
  leverageLinked: boolean;
  liveFaceValue: number | null;
  onChange: (patch: Partial<NonNullable<import('../../../data').StatementLine['debtProperties']>>) => void;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const displayProperties = leverageLinked ? { ...properties, originalFaceValue: liveFaceValue ?? undefined } : properties;
  return (
    <div style={{ border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)', padding: 'var(--space-4)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button
          onClick={() => setExpanded((v) => !v)}
          style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
        >
          <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', color: 'var(--text-primary)' }}>{name}</span>
          <Badge size="sm" tone="neutral">{properties.debtType === 'revolver' ? 'Revolver' : 'Term'}</Badge>
          {leverageLinked ? <Badge size="sm" tone="info">Sized by leverage</Badge> : null}
        </button>
        <IconButton icon="trash-2" label={`Remove ${name}`} size="sm" variant="ghost" onClick={onRemove} />
      </div>
      {expanded ? (
        <DebtTranchePropertiesEditor
          instance={displayProperties}
          onChange={(patch) => {
            if (leverageLinked) {
              const { originalFaceValue: _ignored, ...rest } = patch;
              onChange(rest);
            } else {
              onChange(patch);
            }
          }}
        />
      ) : null}
    </div>
  );
}
