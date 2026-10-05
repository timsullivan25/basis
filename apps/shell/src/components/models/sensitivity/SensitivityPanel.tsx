import { useMemo, useState } from 'react';
import { Button, Card, Checkbox, Field, Input, SegmentedControl, Select } from '@basis/design-system';
import type { StatementSchema } from '../../../data';
import type { EvaluationInput, EvaluationResult } from '../../../lib/engine/evaluate';
import {
  basePoint,
  DEFAULT_SEED,
  DEFAULT_TRIALS,
  describeOutput,
  inputOptions,
  outputReader,
  probabilityBeyond,
  runGrid,
  runMonteCarlo,
  runOneAtATime,
  suggestedOutputs,
  summarizeDistribution,
  tornadoRows,
  type CasePoint,
  type Distribution,
  type InputOption,
  type SensitivityContext,
  type SensitivityInput,
  type SensitivityOutput,
} from '../../../lib/sensitivity';
import { availableAnalysisMetrics, type AnalysisContext } from '../../../lib/sensitivityAnalyses';
import { formatPeriodValue } from '../mapping/mappingFormatting';
import { DistributionChart } from './DistributionChart';
import { GridTable, type GridAxis } from './GridTable';
import { TornadoChart, type TornadoChartRow } from './TornadoChart';

interface SensitivityPanelProps {
  schema: StatementSchema;
  /** The starting case: the model with the active scenario's driver values already merged in. */
  model: EvaluationInput;
  /** `model` evaluated — the same evaluation the rest of the workspace shows. */
  baseline: EvaluationResult;
  /** Enabled analyses and the active scenario's assumptions for them; null when none is enabled. */
  analysis: AnalysisContext | null;
  scenarioName: string;
}

type Mode = 'tornado' | 'grid' | 'montecarlo';

/** Below this, an output's swing is float noise, not an effect worth a bar. */
const SWING_EPSILON = 1e-9;

/** A user's edits to one input; anything unset falls back to the input's suggested range. */
interface InputEdit {
  enabled?: boolean;
  low?: number;
  high?: number;
  distribution?: Distribution;
}

/** Shifts are entered in the unit a person thinks in, so pp and % scale by 100 for display. */
function unitScale(unit: InputOption['shiftUnit']): number {
  return unit === 'pp' || unit === '%' ? 100 : 1;
}

function unitSuffix(unit: InputOption['shiftUnit']): string {
  return unit === '%' || unit === 'x' ? unit : ` ${unit}`;
}

function formatShift(value: number, unit: InputOption['shiftUnit']): string {
  const scaled = Math.round(value * unitScale(unit) * 100) / 100;
  return (scaled > 0 ? '+' : scaled < 0 ? '−' : '') + Math.abs(scaled).toString() + unitSuffix(unit);
}

function rangeLabel(option: InputOption, input: SensitivityInput): string {
  if (input.low === -input.high) return '±' + formatShift(input.high, option.shiftUnit).replace(/^[+−]/, '');
  return `${formatShift(input.low, option.shiftUnit)} to ${formatShift(input.high, option.shiftUnit)}`;
}

/** The input's own value at a shift, e.g. 6% growth +2 pp → "8.0%". */
function shiftedLabel(option: InputOption, input: SensitivityInput, shift: number): string {
  if (option.baseValue === null) return '—';
  const value = input.kind === 'absolute' ? option.baseValue + shift : option.baseValue * (1 + shift);
  return formatPeriodValue(value, option.numberFormat);
}

function outputKey(output: SensitivityOutput): string {
  return output.kind === 'line' ? `line:${output.lineId}` : `analysis:${output.metricId}`;
}

/** Local buffer, select on focus, commit on Enter or blur — same pattern as DcfPanel's PercentInput. */
function NumberInput({ value, scale, suffix, onCommit, width = 110 }: { value: number; scale: number; suffix?: string; onCommit: (next: number) => void; width?: number }) {
  const display = String(Math.round(value * scale * 100) / 100);
  const [text, setText] = useState(display);
  function commit() {
    const n = Number(text.trim());
    if (text.trim() === '' || Number.isNaN(n)) setText(display);
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
      style={{ width }}
    />
  );
}

const muted = { fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' } as const;
const note = { fontSize: 'var(--text-2xs)', color: 'var(--text-tertiary)' } as const;

/**
 * Sensitivity on the active scenario: pick inputs (model drivers and enabled analyses'
 * assumptions) and their ranges, pick an output (a model line at a period, or an analysis result),
 * then read it three ways — a tornado (one input at a time), a two-way grid, or a Monte Carlo
 * distribution with every input moving at once. The tornado and grid re-run live; Monte Carlo
 * runs on demand. Nothing here is saved yet — ranges reset when the workspace reloads.
 */
export function SensitivityPanel({ schema, model, baseline, analysis, scenarioName }: SensitivityPanelProps) {
  const ctx: SensitivityContext = useMemo(() => ({ schema, model, baseline, analysis }), [schema, model, baseline, analysis]);
  const options = useMemo(() => inputOptions(ctx), [ctx]);
  const [mode, setMode] = useState<Mode>('tornado');
  const [edits, setEdits] = useState<Record<string, InputEdit>>({});

  const inputs = options.map((option) => {
    const edit = edits[option.id] ?? {};
    const input: SensitivityInput = {
      ...option.suggested,
      low: edit.low ?? option.suggested.low,
      high: edit.high ?? option.suggested.high,
      distribution: edit.distribution ?? option.suggested.distribution,
    };
    return { option, enabled: edit.enabled ?? true, input };
  });
  const enabled = inputs.filter((i) => i.enabled);
  const enabledInputs = enabled.map((i) => i.input);
  const inputsKey = JSON.stringify(enabledInputs);
  const optionById = new Map(options.map((o) => [o.id, o]));
  const inputById = new Map(enabledInputs.map((i) => [i.id, i]));

  function updateEdit(id: string, patch: InputEdit) {
    setEdits((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  // --- Output ---
  const allLines = schema.sections.flatMap((s) => s.lines);
  const metrics = useMemo(() => availableAnalysisMetrics(analysis), [analysis]);
  const suggested = useMemo(() => suggestedOutputs(schema, model.timeline), [schema, model.timeline]);
  const [outputSel, setOutputSel] = useState<string | null>(null);
  const [periodSel, setPeriodSel] = useState<number | null>(null);
  const validKeys = new Set([...allLines.map((l) => `line:${l.id}`), ...metrics.map((m) => `analysis:${m.id}`)]);
  const selectedKey = outputSel && validKeys.has(outputSel) ? outputSel : suggested[0] ? outputKey(suggested[0]) : allLines[0] ? `line:${allLines[0].id}` : null;
  const periodIndex = Math.min(periodSel ?? model.timeline.length - 1, model.timeline.length - 1);
  const output: SensitivityOutput | null = selectedKey
    ? selectedKey.startsWith('line:')
      ? { kind: 'line', lineId: selectedKey.slice(5), periodIndex }
      : { kind: 'analysis', metricId: selectedKey.slice(9) }
    : null;
  const described = output ? describeOutput(ctx, output) : null;
  const read = useMemo(() => (output ? outputReader(ctx, output) : () => null), [ctx, output?.kind, selectedKey, periodIndex]); // eslint-disable-line react-hooks/exhaustive-deps
  const baseValue = read(basePoint(ctx));
  const suggestedLineIds = new Set(suggested.flatMap((o) => (o.kind === 'line' ? [o.lineId] : [])));
  const numberFormat = described?.numberFormat ?? 'number';

  // --- Tornado ---
  // enabledInputs is rebuilt every render; inputsKey is its stable identity.
  const sweeps = useMemo(() => runOneAtATime(ctx, enabledInputs), [ctx, inputsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const chartRows: TornadoChartRow[] = output
    ? tornadoRows(ctx, sweeps, output).map((row) => {
        const option = optionById.get(row.inputId)!;
        return { ...row, label: option.label, rangeLabel: rangeLabel(option, inputById.get(row.inputId)!) };
      })
    : [];
  const movingRows = chartRows.filter((r) => r.swing > SWING_EPSILON);
  const flatRows = chartRows.filter((r) => r.swing <= SWING_EPSILON);

  // --- Grid ---
  const [gridRowId, setGridRowId] = useState<string | null>(null);
  const [gridColId, setGridColId] = useState<string | null>(null);
  // Defaults to the two inputs that move this output most.
  const ranked = [...movingRows.map((r) => r.inputId), ...enabledInputs.map((i) => i.id)];
  const rowId = gridRowId && inputById.has(gridRowId) ? gridRowId : ranked[0];
  const colId = gridColId && inputById.has(gridColId) && gridColId !== rowId ? gridColId : ranked.find((id) => id !== rowId);
  const grid = useMemo(
    () => (mode === 'grid' && rowId && colId ? runGrid(ctx, inputById.get(rowId)!, inputById.get(colId)!) : null),
    [mode, ctx, rowId, colId, inputsKey], // eslint-disable-line react-hooks/exhaustive-deps
  );
  function axis(run: { input: SensitivityInput; shifts: number[] }): GridAxis {
    const option = optionById.get(run.input.id)!;
    return {
      label: option.label,
      steps: run.shifts.map((shift) => ({ value: shiftedLabel(option, run.input, shift), shift: shift === 0 ? 'base' : formatShift(shift, option.shiftUnit) })),
    };
  }

  // --- Monte Carlo ---
  const [trials, setTrials] = useState(DEFAULT_TRIALS);
  const [seed, setSeed] = useState(DEFAULT_SEED);
  const [mc, setMc] = useState<{ points: CasePoint[]; key: string; ms: number } | null>(null);
  const [running, setRunning] = useState(false);
  const [threshold, setThreshold] = useState<number | null>(null);
  const [direction, setDirection] = useState<'below' | 'above'>('below');
  const mcKey = JSON.stringify([inputsKey, trials, seed]);
  function runMc() {
    setRunning(true);
    // Yields a frame first so the button's loading state paints before the synchronous run.
    setTimeout(() => {
      const start = performance.now();
      const points = runMonteCarlo(ctx, enabledInputs, trials, seed);
      setMc({ points, key: mcKey, ms: performance.now() - start });
      setRunning(false);
    }, 16);
  }
  const mcValues = useMemo(() => (mc ? mc.points.map(read) : []), [mc, read]);
  const summary = useMemo(() => summarizeDistribution(mcValues), [mcValues]);
  // Until a threshold is typed, the question is "how likely is it to end up below (or above)
  // where it starts?"
  const effectiveThreshold = threshold ?? baseValue;
  const chance = effectiveThreshold !== null && mc ? probabilityBeyond(mcValues, effectiveThreshold, direction) : null;

  if (options.length === 0) {
    return (
      <Card title="Sensitivity" icon="sliders-horizontal" padding="md">
        <span style={muted}>
          No inputs to sensitize. Give a line a growth, percent-of, days-of or hardcoded projection with a value in the projected periods, or set up
          an analysis, first.
        </span>
      </Card>
    );
  }

  const outputGroups = [
    { label: 'Suggested', options: suggested.flatMap((o) => (o.kind === 'line' ? [{ value: outputKey(o), label: allLines.find((l) => l.id === o.lineId)!.name }] : [])) },
    ...['dcf', 'lbo', 'recoveryWaterfall'].map((id) => ({
      label: id === 'dcf' ? 'DCF' : id === 'lbo' ? 'LBO' : 'Recovery Waterfall',
      options: metrics.filter((m) => m.analysisId === id).map((m) => ({ value: `analysis:${m.id}`, label: m.label })),
    })),
    ...schema.sections.map((s) => ({
      label: s.name,
      options: s.lines.filter((l) => !suggestedLineIds.has(l.id)).map((l) => ({ value: `line:${l.id}`, label: l.name })),
    })),
  ].filter((g) => g.options.length > 0);

  const inputSelectOptions = enabledInputs.map((i) => ({ value: i.id, label: optionById.get(i.id)!.label }));
  const groups = [...new Set(inputs.map((i) => i.option.group))];
  const showDistribution = mode === 'montecarlo';
  const columns = `minmax(220px, 1fr) 110px 130px 130px${showDistribution ? ' 140px' : ''}`;
  const headCell = {
    padding: 'var(--space-3) var(--space-6)', fontSize: 'var(--text-2xs)', fontWeight: 'var(--weight-semibold)', color: 'var(--text-tertiary)',
    background: 'var(--surface-table-head)', borderBottom: '1px solid var(--border-default)',
  } as const;
  const cell = { padding: 'var(--space-3) var(--space-6)', borderBottom: '1px solid var(--border-subtle)' } as const;

  const subtitle =
    mode === 'tornado'
      ? `Each input moves on its own across its range, with everything else held at ${scenarioName}. Ranked by how far it swings the output.`
      : mode === 'grid'
        ? `Two inputs move together across their ranges, with everything else held at ${scenarioName}. The outlined cell is the starting case.`
        : `Every selected input is drawn at random from its range at once, independently of the others, starting from ${scenarioName}.`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      <Card
        title={mode === 'tornado' ? 'Tornado' : mode === 'grid' ? 'Two-way grid' : 'Monte Carlo'}
        icon={mode === 'tornado' ? 'chart-bar-decreasing' : mode === 'grid' ? 'table' : 'chart-column'}
        subtitle={subtitle}
        padding="md"
        actions={
          <SegmentedControl
            size="sm"
            value={mode}
            onChange={(v) => setMode(v as Mode)}
            options={[
              { value: 'tornado', label: 'One at a time' },
              { value: 'grid', label: 'Two-way grid' },
              { value: 'montecarlo', label: 'Monte Carlo' },
            ]}
          />
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-7)' }}>
          <div style={{ display: 'flex', gap: 'var(--space-5)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Field label="Output">
              <Select size="sm" value={selectedKey ?? ''} onChange={(e) => setOutputSel(e.target.value)} groups={outputGroups} style={{ width: 280 }} />
            </Field>
            {output?.kind === 'line' ? (
              <Field label="Period">
                <Select
                  size="sm"
                  value={String(periodIndex)}
                  onChange={(e) => setPeriodSel(Number(e.target.value))}
                  options={model.timeline.map((p, i) => ({ value: String(i), label: p.label }))}
                  style={{ width: 130 }}
                />
              </Field>
            ) : null}
            {mode === 'grid' ? (
              <>
                <Field label="Rows">
                  <Select size="sm" value={rowId ?? ''} onChange={(e) => setGridRowId(e.target.value)} options={inputSelectOptions} style={{ width: 230 }} />
                </Field>
                <Field label="Columns">
                  <Select
                    size="sm"
                    value={colId ?? ''}
                    onChange={(e) => setGridColId(e.target.value)}
                    options={inputSelectOptions.filter((o) => o.value !== rowId)}
                    style={{ width: 230 }}
                  />
                </Field>
              </>
            ) : null}
            {mode === 'montecarlo' ? (
              <>
                <Field label="Trials">
                  <NumberInput key={`trials:${trials}`} value={trials} scale={1} width={100} onCommit={(n) => setTrials(Math.max(10, Math.min(20000, Math.round(n))))} />
                </Field>
                <Field label="Seed" hint="The same seed and inputs reproduce the same run.">
                  <NumberInput key={`seed:${seed}`} value={seed} scale={1} width={80} onCommit={(n) => setSeed(Math.round(n))} />
                </Field>
                <Button size="sm" variant="primary" iconLeft="play" loading={running} disabled={enabledInputs.length === 0} onClick={runMc}>
                  {mc && mc.key !== mcKey ? 'Re-run' : 'Run'}
                </Button>
              </>
            ) : null}
          </div>

          {!output || !described ? null : mode === 'tornado' ? (
            <>
              <TornadoChart rows={movingRows} base={baseValue} numberFormat={numberFormat} />
              {flatRows.length > 0 ? (
                <span style={note}>
                  No effect on {described.label}: {flatRows.map((r) => r.label).join(', ')}.
                </span>
              ) : null}
            </>
          ) : mode === 'grid' ? (
            grid ? (
              <GridTable
                grid={grid}
                read={read}
                numberFormat={numberFormat}
                rowAxis={axis({ input: grid.rowInput, shifts: grid.rowShifts })}
                colAxis={axis({ input: grid.colInput, shifts: grid.colShifts })}
              />
            ) : (
              <span style={muted}>Select at least two inputs below to build a grid.</span>
            )
          ) : !mc ? (
            <span style={muted}>
              Run {trials.toLocaleString('en-US')} trials to see the range of outcomes for {described.label}.
            </span>
          ) : !summary ? (
            <span style={muted}>{described.label} didn't resolve in any trial.</span>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 'var(--space-5)' }}>
                {[
                  ['Starting case', baseValue],
                  ['Mean', summary.mean],
                  ['5th percentile', summary.p5],
                  ['Median', summary.p50],
                  ['95th percentile', summary.p95],
                ].map(([label, value]) => (
                  <div key={label as string} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                    <span style={{ fontSize: 'var(--text-3xs)', fontWeight: 'var(--weight-semibold)', letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>
                      {label}
                    </span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-md)', fontVariantNumeric: 'var(--numeric-tabular)', color: 'var(--text-primary)' }}>
                      {formatPeriodValue(value as number | null, numberFormat)}
                    </span>
                  </div>
                ))}
              </div>
              <DistributionChart summary={summary} base={baseValue} threshold={threshold} numberFormat={numberFormat} />
              <div style={{ display: 'flex', gap: 'var(--space-5)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <Field label="Chance the output is">
                  <SegmentedControl
                    size="sm"
                    value={direction}
                    onChange={(v) => setDirection(v as 'below' | 'above')}
                    options={[{ value: 'below', label: 'Below' }, { value: 'above', label: 'Above' }]}
                  />
                </Field>
                <Field label="Threshold">
                  <NumberInput
                    key={`threshold:${threshold}:${numberFormat}`}
                    value={effectiveThreshold ?? summary.p50}
                    scale={numberFormat === 'percentage' ? 100 : 1}
                    suffix={numberFormat === 'percentage' ? '%' : numberFormat === 'multiple' ? 'x' : undefined}
                    width={130}
                    onCommit={setThreshold}
                  />
                </Field>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-lg)', color: 'var(--text-primary)', paddingBottom: 2 }}>
                  {chance === null ? '—' : formatPeriodValue(chance, 'percentage')}
                </span>
              </div>
              <span style={note}>
                {summary.count.toLocaleString('en-US')} trials
                {summary.unresolved > 0 ? ` (${summary.unresolved.toLocaleString('en-US')} more didn't resolve)` : ''}, ran in {Math.round(mc.ms)} ms.
                {mc.key !== mcKey ? ' Inputs have changed since this run; re-run to update.' : ''} Inputs are drawn independently; correlation between inputs isn't modeled yet.
              </span>
            </div>
          )}
        </div>
      </Card>

      <Card
        title="Inputs"
        icon="sliders-horizontal"
        subtitle="Driver shifts apply to every projected period. Rates move in percentage points, days-of drivers in days, multiples in turns, amounts in percent of themselves."
        padding="none"
        actions={
          Object.keys(edits).length > 0 ? (
            <Button size="sm" variant="ghost" iconLeft="rotate-ccw" onClick={() => setEdits({})}>
              Reset
            </Button>
          ) : null
        }
      >
        <div style={{ display: 'grid', gridTemplateColumns: columns, alignItems: 'center' }}>
          {['Input', 'Value', 'Low', 'High', ...(showDistribution ? ['Distribution'] : [])].map((h, i) => (
            <span key={h} style={{ ...headCell, textAlign: i === 0 ? 'left' : 'right' }}>
              {h}
            </span>
          ))}
          {groups.map((group) => (
            <div key={group} style={{ display: 'contents' }}>
              <span
                style={{
                  gridColumn: '1 / -1', padding: 'var(--space-3) var(--space-6)', fontSize: 'var(--text-3xs)', fontWeight: 'var(--weight-semibold)',
                  letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase', color: 'var(--text-tertiary)', borderBottom: '1px solid var(--border-subtle)',
                }}
              >
                {group}
              </span>
              {inputs
                .filter((i) => i.option.group === group)
                .map(({ option, enabled: isOn, input }) => {
                  const scale = unitScale(option.shiftUnit);
                  const suffix = option.shiftUnit;
                  return (
                    <div key={option.id} style={{ display: 'contents' }}>
                      <div style={cell}>
                        <Checkbox checked={isOn} onChange={(next) => updateEdit(option.id, { enabled: next })} label={option.label} />
                      </div>
                      <span
                        style={{
                          ...cell, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', fontVariantNumeric: 'var(--numeric-tabular)',
                          color: 'var(--text-secondary)',
                        }}
                      >
                        {formatPeriodValue(option.baseValue, option.numberFormat)}
                      </span>
                      <div style={{ ...cell, display: 'flex', justifyContent: 'flex-end' }}>
                        <NumberInput key={`low:${input.low}`} value={input.low} scale={scale} suffix={suffix} onCommit={(low) => updateEdit(option.id, { low })} />
                      </div>
                      <div style={{ ...cell, display: 'flex', justifyContent: 'flex-end' }}>
                        <NumberInput key={`high:${input.high}`} value={input.high} scale={scale} suffix={suffix} onCommit={(high) => updateEdit(option.id, { high })} />
                      </div>
                      {showDistribution ? (
                        <div style={{ ...cell, display: 'flex', justifyContent: 'flex-end' }}>
                          <Select
                            size="sm"
                            value={input.distribution}
                            onChange={(e) => updateEdit(option.id, { distribution: e.target.value as Distribution })}
                            options={[
                              { value: 'triangular', label: 'Triangular' },
                              { value: 'uniform', label: 'Uniform' },
                              { value: 'normal', label: 'Normal' },
                            ]}
                            style={{ width: 120 }}
                          />
                        </div>
                      ) : null}
                    </div>
                  );
                })}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
