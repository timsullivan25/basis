import { useEffect, useMemo, useState } from 'react';
import { Button, Card, DataTable, Dialog, Icon, Input, SegmentedControl, Tabs } from '@basis/design-system';
import {
  modelRepository,
  statementSchemaRepository,
  type Company,
  type DriverDefinition,
  type Model,
  type StatementLine,
  type StatementSchema,
} from '../data';
import { getLineRowStyle } from '../components/statements/statementFormatting';
import { formatPeriodValue } from '../components/models/mapping/mappingFormatting';
import { extendTimeline } from '../lib/periodTimeline';
import { evaluateModel } from '../lib/engine/evaluate';

interface ModelWorkspaceScreenProps {
  company: Company;
}

/** A driver's stored value is always the raw number the engine reads (0.1 for a 10% growth
 *  rate) — these two convert to/from the units a person actually wants to type ("10" for 10%,
 *  a plain day count for "days"). Only two units exist ('%' and 'days'), 'multiple-of' having
 *  been dropped as redundant with 'percent-of'. */
function toDisplayValue(stored: number | null, unit: string): string {
  if (stored === null) return '';
  return unit === '%' ? String(stored * 100) : String(stored);
}
function fromDisplayValue(display: string, unit: string): number | null {
  const trimmed = display.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  if (Number.isNaN(n)) return null;
  return unit === '%' ? n / 100 : n;
}
function formatDriverValue(value: number | null, unit: string): string {
  if (value === null) return '—';
  return unit === '%' ? `${(value * 100).toFixed(1)}%` : `${value} days`;
}

/** Local text buffer + commit-on-blur, same pattern FormulaInput already uses — committing a
 *  driver value means an async IndexedDB write, so it shouldn't fire on every keystroke. Always
 *  seeded from the raw stored value (blank if unset), never the computed default — editing means
 *  setting an override, not accepting-then-resaving whatever was being assumed. */
function DriverValueInput({ stored, unit, onCommit }: { stored: number | null; unit: string; onCommit: (value: number | null) => void }) {
  const [text, setText] = useState(() => toDisplayValue(stored, unit));
  return (
    <Input
      size="sm"
      mono
      type="number"
      autoFocus
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => onCommit(fromDisplayValue(text, unit))}
    />
  );
}

/**
 * The current model's live view — a drivers panel over the projected periods, statement
 * sub-tabs over the full period grid, both reading the model's persisted historicals plus
 * every calculated line's live value from the engine (mapped-value-wins, formula as fallback —
 * see lib/engine/evaluate.ts's computeLine). No history/read-only mode yet (that's phase 07,
 * once Snapshot exists) — this is always today's current model.
 */
export function ModelWorkspaceScreen({ company }: ModelWorkspaceScreenProps) {
  const [model, setModel] = useState<Model | null | undefined>(undefined);
  const [schema, setSchema] = useState<StatementSchema | null>(null);
  const [tab, setTab] = useState('all');
  const [horizonInput, setHorizonInput] = useState('0');
  // Set only while confirming a reduction in projected periods — growing needs no confirmation
  // (purely additive), but shrinking permanently drops driver values entered for the removed tail.
  const [shrinkConfirm, setShrinkConfirm] = useState<{ nextCount: number } | null>(null);
  const [recalcMode, setRecalcMode] = useState<'auto' | 'manual'>('auto');
  // Frozen the instant manual mode is entered (or Recalculate is pressed) — driver edits still
  // save immediately either way, but in manual mode `evaluation` keeps reading this snapshot
  // instead of the live model until the next Recalculate.
  const [manualSnapshot, setManualSnapshot] = useState<Model | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const existingModel = await modelRepository.getForCompany(company.id);
      if (cancelled) return;
      const existingSchema = existingModel ? await statementSchemaRepository.get(existingModel.statementSchemaId) : null;
      if (cancelled) return;
      setModel(existingModel ?? null);
      setSchema(existingSchema ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [company.id]);

  const currentProjectedCount = model ? model.timeline.filter((p) => p.kind === 'projected').length : 0;

  // Resyncs the horizon field when a different model loads (initial load / company switch) —
  // our own extend/shrink actions explicitly set this themselves right after, so this effect
  // firing only on `model?.id` (not on every timeline edit) never fights with that.
  useEffect(() => {
    setHorizonInput(String(currentProjectedCount));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model?.id]);

  const evaluatedModel = recalcMode === 'auto' ? model : (manualSnapshot ?? model);
  const evaluation = useMemo(
    () => (schema && evaluatedModel ? evaluateModel(schema, evaluatedModel) : null),
    [schema, evaluatedModel],
  );

  async function updateDriverValue(driverId: string, periodIndex: number, value: number | null) {
    if (!model) return;
    // A model created before driverValues existed on Model won't have the field at all yet —
    // normalize rather than assume it's always present.
    const currentDriverValues = model.driverValues ?? {};
    const nextValues = [...(currentDriverValues[driverId] ?? [])];
    while (nextValues.length <= periodIndex) nextValues.push(null);
    nextValues[periodIndex] = value;
    const updated = await modelRepository.update(model.id, { driverValues: { ...currentDriverValues, [driverId]: nextValues } });
    setModel(updated);
  }

  async function commitHorizonChange() {
    if (!model) return;
    const parsed = Math.floor(Number(horizonInput));
    if (!Number.isFinite(parsed) || parsed < 0) {
      setHorizonInput(String(currentProjectedCount));
      return;
    }
    if (parsed === currentProjectedCount) return;
    if (parsed > currentProjectedCount) {
      const updated = await modelRepository.update(model.id, {
        timeline: extendTimeline(model.timeline, parsed - currentProjectedCount),
      });
      setModel(updated);
      return;
    }
    // Shrinking is destructive to anything entered for the dropped periods — confirm first.
    setShrinkConfirm({ nextCount: parsed });
  }

  async function confirmShrink() {
    if (!model || !shrinkConfirm) return;
    const actualCount = model.timeline.length - currentProjectedCount;
    const newLength = actualCount + shrinkConfirm.nextCount;
    const nextTimeline = model.timeline.slice(0, newLength);
    const nextDriverValues = Object.fromEntries(
      Object.entries(model.driverValues ?? {}).map(([id, values]) => [id, values.slice(0, newLength)]),
    );
    const updated = await modelRepository.update(model.id, { timeline: nextTimeline, driverValues: nextDriverValues });
    setModel(updated);
    setHorizonInput(String(shrinkConfirm.nextCount));
    setShrinkConfirm(null);
  }

  function cancelShrink() {
    setHorizonInput(String(currentProjectedCount));
    setShrinkConfirm(null);
  }

  function handleRecalcModeChange(mode: 'auto' | 'manual') {
    if (mode === 'manual') setManualSnapshot(model ?? null);
    setRecalcMode(mode);
  }

  function recalculate() {
    setManualSnapshot(model ?? null);
  }

  if (model === undefined) {
    return <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>Loading…</span>;
  }

  if (!model || !schema) {
    return <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>No model to show.</span>;
  }

  const tabs = [
    { value: 'all', label: 'All' },
    ...schema.sections.map((section) => ({ value: section.id, label: section.name })),
  ];

  const rows: Array<{ id: string; __group?: string; line?: StatementLine }> = [];
  schema.sections.forEach((section) => {
    if (tab !== 'all' && tab !== section.id) return;
    if (!section.lines.length) return;
    rows.push({ id: `group-${section.id}`, __group: section.name });
    section.lines.forEach((line) => rows.push({ id: line.id, line }));
  });

  const columns = [
    {
      key: 'name',
      label: 'Line',
      width: 240,
      render: (_: unknown, row: { line?: StatementLine }) =>
        row.line ? (
          <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', color: 'var(--text-primary)' }}>
            {row.line.name}
          </span>
        ) : null,
    },
    ...model.timeline.map((period, i) => ({
      key: `p${i}`,
      label: period.label,
      numeric: true,
      width: 110,
      // A faint blue tint marking every projected column, so the actual/projected boundary reads
      // at a glance without needing a second color on the values themselves. Translucent (rather
      // than the neutral --surface-sunken originally used here) so it stays visible as an overlay
      // on top of a total row's own background instead of being swallowed by it.
      background: period.kind === 'projected' ? 'var(--alpha-blue-06)' : undefined,
      render: (_: unknown, row: { line?: StatementLine }) => {
        if (!row.line) return null;
        const error = evaluation?.getError(row.line.id);
        if (error) {
          return (
            <span title={error} style={{ display: 'inline-flex', justifyContent: 'flex-end', width: '100%' }}>
              <Icon name="alert-triangle" size={12} color="var(--text-negative)" />
            </span>
          );
        }
        // evaluation already applies mapped-value-wins-else-formula for every line uniformly —
        // status/badge columns elsewhere already say whether a line is calculated, so the value
        // itself doesn't need a second color cue on top of that.
        const value = evaluation?.getValue(row.line.id, i) ?? null;
        return (
          <span
            style={{
              fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', fontVariantNumeric: 'var(--numeric-tabular)',
              color: value === null ? 'var(--text-disabled)' : 'var(--text-body)',
            }}
          >
            {formatPeriodValue(value, row.line.numberFormat)}
          </span>
        );
      },
    })),
  ];

  const projectedPeriods = model.timeline
    .map((period, index) => ({ period, index }))
    .filter(({ period }) => period.kind === 'projected');

  const driverValues = model.driverValues ?? {};

  const driverColumns = [
    {
      key: 'name',
      label: 'Driver',
      width: 240,
      render: (_: unknown, row: DriverDefinition) => (
        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', color: 'var(--text-primary)' }}>
          {row.name}
        </span>
      ),
    },
    ...projectedPeriods.map(({ period, index }) => ({
      key: `p${index}`,
      label: period.label,
      numeric: true,
      width: 110,
      render: (_: unknown, row: DriverDefinition) => {
        const stored = driverValues[row.id]?.[index] ?? null;
        const effective = evaluation?.getDriverValue(row.id, index) ?? null;
        // No explicit value entered, but a default was computed (0% growth, or the last actual
        // period's own implied ratio) — shown, not left blank, but italicized the same way a
        // metric row already is elsewhere in this app, to mark it as an assumption rather than
        // something actually typed.
        const isDefault = stored === null && effective !== null;
        return (
          <span
            style={{
              fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', fontVariantNumeric: 'var(--numeric-tabular)',
              fontStyle: isDefault ? 'italic' : 'normal',
              color: effective === null ? 'var(--text-disabled)' : isDefault ? 'var(--text-tertiary)' : 'var(--text-body)',
            }}
          >
            {formatDriverValue(effective, row.unit)}
          </span>
        );
      },
      renderEdit: (_: unknown, row: DriverDefinition) => (
        <DriverValueInput
          stored={driverValues[row.id]?.[index] ?? null}
          unit={row.unit}
          onCommit={(value) => updateDriverValue(row.id, index, value)}
        />
      ),
    })),
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)', padding: 'var(--gutter)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-secondary)' }}>{company.name}</span>
        <h1 style={{ fontSize: 'var(--text-2xl)' }}>{model.name}</h1>
      </div>

      <Card
        title="Drivers"
        icon="sliders-horizontal"
        padding="none"
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-5)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-secondary)' }}>Projected periods</span>
              <Input
                size="sm"
                mono
                type="number"
                value={horizonInput}
                onChange={(e) => setHorizonInput(e.target.value)}
                onBlur={commitHorizonChange}
                fullWidth={false}
                style={{ width: 56 }}
              />
            </div>
            <SegmentedControl
              size="sm"
              options={[
                { value: 'auto', label: 'Auto' },
                { value: 'manual', label: 'Manual' },
              ]}
              value={recalcMode}
              onChange={(value) => handleRecalcModeChange(value as 'auto' | 'manual')}
            />
            {recalcMode === 'manual' ? (
              <Button size="sm" variant="primary" iconLeft="refresh-cw" onClick={recalculate}>
                Recalculate
              </Button>
            ) : null}
          </div>
        }
      >
        {schema.drivers.length === 0 ? (
          <div style={{ padding: 'var(--space-6)', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
            No projection drivers defined yet — set a line's projection method in Financial Statement Definitions to add one.
          </div>
        ) : projectedPeriods.length === 0 ? (
          <div style={{ padding: 'var(--space-6)', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
            No projected periods yet — set how many above to start entering driver assumptions.
          </div>
        ) : (
          <DataTable columns={driverColumns} rows={schema.drivers} rowKey="id" dense stickyFirstColumn />
        )}
      </Card>

      <Tabs tabs={tabs} value={tab} onChange={setTab} size="sm" />

      <Card padding="none">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey="id"
          rowStyle={(row: { line?: StatementLine }) => (row.line ? getLineRowStyle(row.line) : {})}
          dense
          stickyHeader
          stickyFirstColumn
          maxHeight="calc(100vh - 260px)"
        />
      </Card>

      <Dialog
        open={shrinkConfirm !== null}
        onClose={cancelShrink}
        icon="alert-triangle"
        title="Reduce projected periods?"
        subtitle={model.name}
        footer={
          <>
            <Button onClick={cancelShrink}>Cancel</Button>
            <Button variant="danger" iconLeft="trash-2" onClick={confirmShrink}>
              Remove periods
            </Button>
          </>
        }
      >
        <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--text-body)' }}>
          Reducing from {currentProjectedCount} to {shrinkConfirm?.nextCount} projected periods permanently removes any driver
          assumptions entered for the dropped periods. This cannot be undone.
        </p>
      </Dialog>
    </div>
  );
}
