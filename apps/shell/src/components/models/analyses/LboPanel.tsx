import { useMemo, useState } from 'react';
import { Alert, Badge, Button, Card, DataTable, Field, Icon, IconButton, Input, SegmentedControl, Select, Switch } from '@basis/design-system';
import { type LboCase, type LboFinancingInputs, type Model, type ScenarioKey, type StatementLine, type StatementSchema } from '../../../data';
import { ANALYSIS_CATALOG } from '../../../data/analysisCatalog';
import { missingConceptsFor } from '../../../lib/analysisAvailability';
import { findSummaryLine } from '../../../lib/summaryLines';
import { ConceptLinesCard } from './ConceptLinesCard';
import { addChildLine, childrenOf, removeChildLine } from '../../../lib/statementLineChildren';
import { periodsPerYearFor, regenerateDebtSchedule } from '../../../lib/debtSchedule';
import { computeEntryLtmEbitda, computeLeverageLinkedFaceValue, DEFAULT_HORIZON_YEARS, effectiveLboFinancing, evaluateLboCase, lboOutputFrom, type SeedLboCaseParams } from '../../../lib/lbo';
import { getLineRowStyle } from '../../statements/statementFormatting';
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
  onUpdateLboCase: (patch: Partial<Pick<LboCase, 'schema' | 'leverageLinkedTrancheId'>>) => void;
  /** Merged into the stored case's financing for that scenario (see lib/lbo.ts's
   *  applyLboFinancingPatch) — never a whole financing record built from this render's props. */
  onUpdateLboFinancing: (scenarioId: ScenarioKey, patch: Partial<LboFinancingInputs>) => void;
  onRemoveLboCase: () => void;
  onSchemaUpdated: (schema: StatementSchema) => void;
  onOpenStatementDefinitions: () => void;
}

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

// Both fields commit only when the parsed value actually changed — focusing and leaving a field
// must not write anything, or it would pin a scenario's value and cut it off from Base.
// Shown to at most 2 decimals (a seeded leverage like 1.8181… reads as 1.82); an untouched field
// compares against that same displayed text, so blurring it doesn't write the rounded value back.
function displayNumber(value: number | null): string {
  return value === null ? '' : String(Number(value.toFixed(2)));
}

function NumberField({ value, onCommit, suffix }: { value: number | null; onCommit: (next: number | null) => void; suffix?: string }) {
  const [text, setText] = useState(() => displayNumber(value));
  const commit = () => {
    const next = parseNumber(text);
    if (next !== parseNumber(displayNumber(value))) onCommit(next);
  };
  return (
    <Input
      size="sm" mono type="number" selectOnFocus value={text}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
      onBlur={commit}
      suffix={suffix}
      style={{ width: 110 }}
    />
  );
}

function PercentField({ value, onCommit, suffix = '%' }: { value: number | null; onCommit: (next: number | null) => void; suffix?: string }) {
  const [text, setText] = useState(() => (value === null ? '' : String(value * 100)));
  const commit = () => {
    const next = parsePercent(text);
    // Compared through the same text round-trip the field displays, so float noise (0.07 * 100)
    // doesn't read as an edit.
    if (next === null ? value !== null : value === null || parsePercent(String(value * 100)) !== next) onCommit(next);
  };
  return (
    <Input
      size="sm" mono type="number" selectOnFocus value={text}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
      onBlur={commit}
      suffix={suffix}
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
  schema, model, evaluation, activeScenarioId, lboCase, onCreateLboCase, onUpdateLboCase, onUpdateLboFinancing, onRemoveLboCase, onSchemaUpdated, onOpenStatementDefinitions,
}: LboPanelProps) {
  const [entryPeriodIndex, setEntryPeriodIndex] = useState(model.timeline.length - 1);
  const [horizonYears, setHorizonYears] = useState(DEFAULT_HORIZON_YEARS);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [projectionView, setProjectionView] = useState<'summary' | 'model'>('summary');

  const catalogEntry = ANALYSIS_CATALOG.find((e) => e.id === 'lbo')!;
  const missing = missingConceptsFor(schema, catalogEntry);

  // Rebuilt from the live base evaluation on every render — evaluateLboCase + lboOutputFrom is
  // exactly what computeLboOutput (and so ModelWorkspaceScreen's AnalysisResult cache) runs, split
  // here so the full-model view can render every evaluated line, not just the summary rows.
  // Computed ahead of the early return below so hook order stays stable whether or not a case exists.
  const evaluated = useMemo(
    () => (lboCase ? evaluateLboCase(lboCase, activeScenarioId, schema, evaluation, model.timeline) : null),
    [lboCase, activeScenarioId, schema, evaluation, model.timeline],
  );
  const output = useMemo(() => (evaluated ? lboOutputFrom(evaluated) : { projection: [], abilityToPay: [] }), [evaluated]);

  if (!lboCase) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
        <ConceptLinesCard
          schema={schema}
          concepts={catalogEntry.requiredConcepts}
          onSchemaUpdated={onSchemaUpdated}
          onOpenStatementDefinitions={onOpenStatementDefinitions}
        />

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

  // Scenario-scoped: only the fields edited are stored on the ACTIVE scenario's entry, so every
  // other field keeps cascading from Base (see lib/lbo.ts's applyLboFinancingPatch).
  function updateFinancing(patch: Partial<LboFinancingInputs>) {
    onUpdateLboFinancing(activeScenarioId, patch);
  }

  // Revolvers lead (senior, first-out), whatever order the case was created in.
  const tranches = totalDebtLine
    ? [...childrenOf(lboCase.schema, totalDebtLine.id)].sort((a, b) => Number(b.debtProperties?.debtType === 'revolver') - Number(a.debtProperties?.debtType === 'revolver'))
    : [];
  const leverageLinkedTranche = tranches.find((t) => t.id === lboCase.leverageLinkedTrancheId);
  const liveEntryEbitda = computeEntryLtmEbitda(schema, evaluation, model.timeline, lboCase.entryPeriodIndex);
  const transactionExpensesAmount =
    financing.transactionExpensesPct !== null && liveEntryEbitda !== null ? financing.transactionExpensesPct * liveEntryEbitda : null;
  const caseHorizonYears = (lboCase.timeline.length - 1) / periodsPerYear;
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
          Entry: {entryPeriodLabel} · {Number(caseHorizonYears.toFixed(2))}yr horizon
        </span>
        {confirmRemove ? (
          <span style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>Delete this LBO case?</span>
            <Button size="sm" variant="danger" onClick={() => { setConfirmRemove(false); onRemoveLboCase(); }}>Delete</Button>
            <Button size="sm" variant="secondary" onClick={() => setConfirmRemove(false)}>Cancel</Button>
          </span>
        ) : (
          <IconButton icon="trash-2" label="Delete LBO case" size="sm" variant="ghost" onClick={() => setConfirmRemove(true)} />
        )}
      </div>

      <Card title="Financing" icon="landmark" padding="md">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
          <div style={{ display: 'flex', gap: 'var(--space-6)' }}>
            <Field label="Leverage" hint={`Multiple of LTM entry EBITDA (${formatPeriodValue(liveEntryEbitda, 'number')}). Sizes the leverage-linked Term Loan and updates live with the model.`}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                <NumberField value={financing.leverageMultiple} onCommit={(v) => v !== null && updateFinancing({ leverageMultiple: v })} suffix="x" />
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                  = {formatPeriodValue(liveTermLoanFaceValue, 'number')}
                </span>
              </div>
            </Field>
            <Field label="Transaction expenses" hint="Percent of LTM entry EBITDA, entered as a percent (2 means 2%). Added to the sponsor's equity check.">
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                <PercentField value={financing.transactionExpensesPct} onCommit={(v) => updateFinancing({ transactionExpensesPct: v })} />
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                  of EBITDA = {formatPeriodValue(transactionExpensesAmount, 'number')}
                </span>
              </div>
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

      <Card
        title="Projection"
        padding="none"
        actions={
          <SegmentedControl
            size="sm"
            value={projectionView}
            onChange={(v) => setProjectionView(v as 'summary' | 'model')}
            options={[{ value: 'summary', label: 'Summary' }, { value: 'model', label: 'Full model' }]}
          />
        }
      >
        {projectionView === 'summary' ? (
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
        ) : evaluated ? (
          <LboModelTable schema={evaluated.schema} timeline={evaluated.timeline} evaluation={evaluated.evaluation} />
        ) : null}
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

    </div>
  );
}

interface LboModelRow {
  id: string;
  __group?: string;
  line?: StatementLine;
}

/** Every line of the evaluated LBO statement (income statement, cash flow, balance sheet, debt
 *  schedule), read-only — the model the summary rows and Ability to Pay are computed from. */
function LboModelTable({ schema, timeline, evaluation }: { schema: StatementSchema; timeline: LboCase['timeline']; evaluation: LineValues }) {
  const rows: LboModelRow[] = schema.sections.flatMap((section) => [
    { id: `group-${section.id}`, __group: section.name },
    ...section.lines.map((line) => ({ id: line.id, line })),
  ]);
  return (
    <DataTable
      dense
      stickyFirstColumn
      columns={[
        {
          key: 'name', label: 'Line', width: 220,
          render: (_: unknown, row: LboModelRow) =>
            row.line ? <span style={{ paddingLeft: row.line.parentLineId ? 'var(--space-6)' : 0 }}>{row.line.name}</span> : null,
        },
        ...timeline.map((period, i) => ({
          key: `p${i}`,
          label: period.label,
          numeric: true,
          width: 100,
          background: period.kind === 'projected' ? 'var(--alpha-blue-06)' : undefined,
          render: (_: unknown, row: LboModelRow) => {
            if (!row.line) return null;
            const error = evaluation.getError(row.line.id);
            if (error) return <span title={error}><Icon name="alert-triangle" size={12} color="var(--text-negative)" /></span>;
            return formatPeriodValue(evaluation.getValue(row.line.id, i), row.line.numberFormat);
          },
        })),
      ]}
      rows={rows}
      rowKey="id"
      rowStyle={(row: LboModelRow) => (row.line ? getLineRowStyle(row.line) : {})}
    />
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
