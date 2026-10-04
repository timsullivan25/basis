import { useMemo, useState } from 'react';
import { Button, Card, Checkbox, Field, Input, Select } from '@basis/design-system';
import type { DriverDefinition, StatementSchema } from '../../../data';
import type { EvaluationInput, EvaluationResult } from '../../../lib/engine/evaluate';
import {
  runOneAtATime,
  sensitizableDrivers,
  suggestedOutputs,
  suggestedShift,
  tornadoRows,
  type SensitivityInput,
} from '../../../lib/sensitivity';
import { formatPeriodValue } from '../mapping/mappingFormatting';
import { TornadoChart, type TornadoChartRow } from './TornadoChart';

interface SensitivityPanelProps {
  schema: StatementSchema;
  /** The starting case: the model with the active scenario's driver values already merged in. */
  model: EvaluationInput;
  /** `model` evaluated — the same evaluation the rest of the workspace shows. */
  baseline: EvaluationResult;
  scenarioName: string;
}

/** Below this, an output's swing is float noise, not an effect worth a bar. */
const SWING_EPSILON = 1e-9;

/** A user's edits to one input; anything unset falls back to the driver's suggested range. */
interface InputEdit {
  enabled?: boolean;
  low?: number;
  high?: number;
}

/** Shifts are entered in the unit a person thinks in: percentage points for a rate, days for a
 *  days-of driver, percent-of-itself for a relative (hardcoded-amount) shift. Stored shifts are
 *  fractions for the first and last, so those scale by 100 for display. */
function shiftUnit(driver: DriverDefinition, kind: SensitivityInput['kind']): { suffix: string; scale: number } {
  if (kind === 'relative') return { suffix: '%', scale: 100 };
  if (driver.method === 'days-of') return { suffix: 'days', scale: 1 };
  return { suffix: 'pp', scale: 100 };
}

function formatShift(value: number, scale: number): string {
  const scaled = Math.round(value * scale * 100) / 100;
  return (scaled > 0 ? '+' : scaled < 0 ? '−' : '') + Math.abs(scaled).toString();
}

function rangeLabel(driver: DriverDefinition, input: SensitivityInput): string {
  const { suffix, scale } = shiftUnit(driver, input.kind);
  const unit = suffix === '%' ? '%' : ` ${suffix}`;
  if (input.low === -input.high) return `±${formatShift(input.high, scale).replace(/^[+−]/, '')}${unit}`;
  return `${formatShift(input.low, scale)}${unit} to ${formatShift(input.high, scale)}${unit}`;
}

function driverValueFormat(driver: DriverDefinition) {
  return driver.method === 'days-of' || driver.method === 'hardcode' ? 'number' : 'percentage';
}

/** Local buffer, select on focus, commit on Enter or blur — same pattern as DcfPanel's PercentInput. */
function ShiftInput({ value, scale, suffix, onCommit }: { value: number; scale: number; suffix: string; onCommit: (next: number) => void }) {
  const [text, setText] = useState(() => String(Math.round(value * scale * 100) / 100));
  function commit() {
    const n = Number(text.trim());
    if (text.trim() === '' || Number.isNaN(n)) setText(String(Math.round(value * scale * 100) / 100));
    else onCommit(n / scale);
  }
  return (
    <Input
      size="sm"
      mono
      type="number"
      selectOnFocus
      value={text}
      suffix={suffix}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
      }}
      onBlur={commit}
      style={{ width: 110 }}
    />
  );
}

/**
 * One-at-a-time sensitivity on the main model: pick drivers and their ranges, pick an output line
 * and period, and read the tornado. Runs live (no "Run" button) because a full sweep is a few
 * dozen synchronous evaluations at today's model sizes. Nothing here is saved yet — ranges reset
 * when the workspace reloads.
 */
export function SensitivityPanel({ schema, model, baseline, scenarioName }: SensitivityPanelProps) {
  const drivers = useMemo(() => sensitizableDrivers(schema, model.timeline, baseline), [schema, model.timeline, baseline]);
  const [edits, setEdits] = useState<Record<string, InputEdit>>({});

  const inputs = drivers.map((driver) => {
    const suggested = suggestedShift(driver);
    const edit = edits[driver.id] ?? {};
    return {
      driver,
      enabled: edit.enabled ?? true,
      input: { driverId: driver.id, kind: suggested.kind, low: edit.low ?? suggested.low, high: edit.high ?? suggested.high } as SensitivityInput,
    };
  });
  const enabledInputs = inputs.filter((i) => i.enabled).map((i) => i.input);
  const inputsKey = JSON.stringify(enabledInputs);

  const sweeps = useMemo(
    () => runOneAtATime(schema, model, baseline, enabledInputs),
    // enabledInputs is rebuilt every render; inputsKey is its stable identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [schema, model, baseline, inputsKey],
  );

  const allLines = schema.sections.flatMap((s) => s.lines);
  const suggested = useMemo(() => suggestedOutputs(schema, model.timeline), [schema, model.timeline]);
  const [outputLineId, setOutputLineId] = useState<string | null>(null);
  const [outputPeriodIndex, setOutputPeriodIndex] = useState<number | null>(null);
  const lineId = outputLineId && allLines.some((l) => l.id === outputLineId) ? outputLineId : (suggested[0]?.lineId ?? allLines[0]?.id ?? null);
  const periodIndex = Math.min(outputPeriodIndex ?? model.timeline.length - 1, model.timeline.length - 1);
  const outputLine = allLines.find((l) => l.id === lineId) ?? null;

  const driversById = new Map(drivers.map((d) => [d.id, d]));
  const chartRows: TornadoChartRow[] = outputLine
    ? tornadoRows(sweeps, baseline, { lineId: outputLine.id, periodIndex }).map((row) => {
        const driver = driversById.get(row.driverId)!;
        const input = enabledInputs.find((i) => i.driverId === row.driverId)!;
        return { ...row, label: driver.name, rangeLabel: rangeLabel(driver, input) };
      })
    : [];

  // An input that never moves this output (e.g. a working-capital driver against EBITDA) is
  // listed under the chart rather than drawn as an empty row.
  const movingRows = chartRows.filter((r) => r.swing > SWING_EPSILON);
  const flatRows = chartRows.filter((r) => r.swing <= SWING_EPSILON);

  function updateEdit(driverId: string, patch: InputEdit) {
    setEdits((prev) => ({ ...prev, [driverId]: { ...prev[driverId], ...patch } }));
  }

  const firstProjected = model.timeline.findIndex((p) => p.kind === 'projected');
  const suggestedLineIds = new Set(suggested.map((o) => o.lineId));

  if (drivers.length === 0) {
    return (
      <Card title="Sensitivity" icon="sliders-horizontal" padding="md">
        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
          No drivers to sensitize. Give a line a growth, percent-of, days-of or hardcoded projection with a value in the projected periods first.
        </span>
      </Card>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      <Card
        title="Tornado"
        icon="chart-bar-decreasing"
        subtitle={`Each input moves on its own across its range, with every other driver held at ${scenarioName}. Ranked by how far it swings the output.`}
        padding="md"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-7)' }}>
          <div style={{ display: 'flex', gap: 'var(--space-5)', flexWrap: 'wrap' }}>
            <Field label="Output">
              <Select
                size="sm"
                value={lineId ?? ''}
                onChange={(e) => setOutputLineId(e.target.value)}
                groups={[
                  { label: 'Suggested', options: suggested.map((o) => ({ value: o.lineId, label: allLines.find((l) => l.id === o.lineId)!.name })) },
                  ...schema.sections.map((s) => ({
                    label: s.name,
                    options: s.lines.filter((l) => !suggestedLineIds.has(l.id)).map((l) => ({ value: l.id, label: l.name })),
                  })),
                ].filter((g) => g.options.length > 0)}
                style={{ width: 260 }}
              />
            </Field>
            <Field label="Period">
              <Select
                size="sm"
                value={String(periodIndex)}
                onChange={(e) => setOutputPeriodIndex(Number(e.target.value))}
                options={model.timeline.map((p, i) => ({ value: String(i), label: p.label }))}
                style={{ width: 140 }}
              />
            </Field>
          </div>
          {outputLine ? (
            <TornadoChart rows={movingRows} base={baseline.getValue(outputLine.id, periodIndex)} numberFormat={outputLine.numberFormat} />
          ) : null}
          {outputLine && flatRows.length > 0 ? (
            <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-tertiary)' }}>
              No effect on {outputLine.name} in {model.timeline[periodIndex]?.label}: {flatRows.map((r) => r.label).join(', ')}.
            </span>
          ) : null}
        </div>
      </Card>

      <Card
        title="Inputs"
        icon="sliders-horizontal"
        subtitle="Shifts apply to every projected period. Rates move in percentage points, days-of drivers in days, hardcoded amounts in percent of themselves."
        padding="none"
        actions={
          Object.keys(edits).length > 0 ? (
            <Button size="sm" variant="ghost" iconLeft="rotate-ccw" onClick={() => setEdits({})}>
              Reset ranges
            </Button>
          ) : null
        }
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) 120px 130px 130px', alignItems: 'center' }}>
          {['Driver', `Value, ${model.timeline[firstProjected]?.label ?? 'first projected'}`, 'Low', 'High'].map((h, i) => (
            <span
              key={h}
              style={{
                padding: 'var(--space-3) var(--space-6)', fontSize: 'var(--text-2xs)', fontWeight: 'var(--weight-semibold)', color: 'var(--text-tertiary)',
                background: 'var(--surface-table-head)', borderBottom: '1px solid var(--border-default)', textAlign: i === 0 ? 'left' : 'right',
              }}
            >
              {h}
            </span>
          ))}
          {inputs.map(({ driver, enabled, input }) => {
            const { suffix, scale } = shiftUnit(driver, input.kind);
            const cell = { padding: 'var(--space-3) var(--space-6)', borderBottom: '1px solid var(--border-subtle)' } as const;
            return (
              <div key={driver.id} style={{ display: 'contents' }}>
                <div style={cell}>
                  <Checkbox checked={enabled} onChange={(next) => updateEdit(driver.id, { enabled: next })} label={driver.name} />
                </div>
                <span
                  style={{
                    ...cell, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', fontVariantNumeric: 'var(--numeric-tabular)',
                    color: 'var(--text-secondary)',
                  }}
                >
                  {firstProjected >= 0 ? formatPeriodValue(baseline.getDriverValue(driver.id, firstProjected), driverValueFormat(driver)) : '—'}
                </span>
                <div style={{ ...cell, display: 'flex', justifyContent: 'flex-end' }}>
                  <ShiftInput key={`low:${input.low}`} value={input.low} scale={scale} suffix={suffix} onCommit={(low) => updateEdit(driver.id, { low })} />
                </div>
                <div style={{ ...cell, display: 'flex', justifyContent: 'flex-end' }}>
                  <ShiftInput key={`high:${input.high}`} value={input.high} scale={scale} suffix={suffix} onCommit={(high) => updateEdit(driver.id, { high })} />
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
