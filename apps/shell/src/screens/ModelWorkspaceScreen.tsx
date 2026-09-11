import { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Card,
  ChartLegend,
  DataTable,
  Dialog,
  Field,
  Icon,
  IconButton,
  Input,
  LineChart,
  SegmentedControl,
  Select,
  Tabs,
  Toast,
} from '@basis/design-system';
import {
  analysisResultRepository,
  analysisSettingsRepository,
  computedResultRepository,
  lineInstanceRepository,
  mappingRepository,
  modelImportRepository,
  modelRepository,
  scenarioRepository,
  snapshotRepository,
  statementSchemaRepository,
  type AnalysisSettings,
  type Company,
  type DcfInputs,
  type DcfOutput,
  type DriverDefinition,
  type LineInstance,
  type Mapping,
  type Model,
  type ModelImport,
  type Scenario,
  type ScenarioKey,
  type Snapshot,
  type StatementLine,
  type StatementSchema,
} from '../data';
import { getLineRowStyle } from '../components/statements/statementFormatting';
import { formatPeriodValue } from '../components/models/mapping/mappingFormatting';
import { SummaryPanel } from '../components/models/SummaryPanel';
import { AnalysesPanel } from '../components/models/analyses/AnalysesPanel';
import { ANALYSIS_CATALOG } from '../data/analysisCatalog';
import { missingConceptsFor } from '../lib/analysisAvailability';
import { computeAnalysisVersionStamp, buildAnalysisResult } from '../lib/analysisCache';
import { buildComputedResult, computeVersionStamp, materializeEvaluation } from '../lib/computedCache';
import {
  computeDcfOutputs,
  computeSensitivityGrid,
  computeUfcf,
  effectiveDcfInputs,
  lastActualIndex,
} from '../lib/dcf';
import { extendTimeline } from '../lib/periodTimeline';
import { mergeScenarioDriverValues } from '../lib/scenario';
import { buildSnapshot, defaultSnapshotLabel } from '../lib/snapshot';
import { findSummaryLine } from '../lib/summaryLines';
import { applyDynamicInstances } from '../lib/engine/withDynamicInstances';
import { DriverValueInput, formatDriverValue } from '../components/models/DriverValueInput';
import { InstancesPanel } from '../components/models/instances/InstancesPanel';

interface ModelWorkspaceScreenProps {
  company: Company;
  /** Navigates to the read-only snapshot viewer — a sibling screen, not nested here — see AppShell. */
  onViewSnapshot: (snapshotId: string) => void;
  /** Navigates to Financial Statement Definitions — used by the Analyses tab's "Add a new line…"
   *  concept-assignment escape hatch, same top-level nav-switch shape as SettingsIndexScreen's own
   *  onNavigate. */
  onOpenStatementDefinitions: () => void;
}

/** Shared, fully-controlled name-prompt dialog for "New scenario", "Duplicate" and "Rename" —
 *  same shape as StatementDefinitionsScreen's NameDialog for statement schemas. */
function ScenarioNameDialog({
  open, title, name, confirmLabel, onChangeName, onClose, onConfirm,
}: {
  open: boolean;
  title: string;
  name: string;
  confirmLabel: string;
  onChangeName: (name: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      width={420}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!name.trim()} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <Field label="Name">
        <Input
          value={name}
          onChange={(e) => onChangeName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && name.trim()) onConfirm();
          }}
          autoFocus
          selectOnFocus
        />
      </Field>
    </Dialog>
  );
}

/**
 * The current model's live view — a drivers panel over the projected periods, statement
 * sub-tabs over the full period grid, both reading the model's persisted historicals plus
 * every calculated line's live value from the engine (mapped-value-wins, formula as fallback —
 * see lib/engine/evaluate.ts's computeLine). No history/read-only mode yet (that's phase 07,
 * once Snapshot exists) — this is always today's current model.
 */
export function ModelWorkspaceScreen({ company, onViewSnapshot, onOpenStatementDefinitions }: ModelWorkspaceScreenProps) {
  const [model, setModel] = useState<Model | null | undefined>(undefined);
  const [schema, setSchema] = useState<StatementSchema | null>(null);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [modelImport, setModelImport] = useState<ModelImport | null>(null);
  const [snapshotDialogOpen, setSnapshotDialogOpen] = useState(false);
  const [pendingSnapshotLabel, setPendingSnapshotLabel] = useState('');
  const [pendingSnapshotNote, setPendingSnapshotNote] = useState('');
  const [savingSnapshot, setSavingSnapshot] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
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
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  // 'base' is a UI-level sentinel, never a stored Scenario row — see lib/scenario.ts.
  const [activeScenarioId, setActiveScenarioId] = useState<string>('base');
  const [scenarioDialog, setScenarioDialog] = useState<'new' | 'duplicate' | 'rename' | null>(null);
  const [pendingScenarioName, setPendingScenarioName] = useState('');
  const [deleteScenarioConfirmOpen, setDeleteScenarioConfirmOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  // Compare tab's period picker — defaults to the last period whenever a different model loads;
  // clamped defensively wherever it's read, since the timeline can shrink after this is set.
  const [comparePeriodIndex, setComparePeriodIndex] = useState(0);
  // Compare tab's chart — which single line to plot, and which scenario series are toggled off
  // via the legend. Line defaults to the first "key metric" (same curated set as the table) once
  // a model loads.
  const [compareLineId, setCompareLineId] = useState<string | null>(null);
  const [hiddenCompareScenarios, setHiddenCompareScenarios] = useState<string[]>([]);
  const [analysisSettings, setAnalysisSettings] = useState<AnalysisSettings | null>(null);
  const [instances, setInstances] = useState<LineInstance[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const existingModel = await modelRepository.getForCompany(company.id);
      if (cancelled) return;
      const existingSchema = existingModel ? await statementSchemaRepository.get(existingModel.statementSchemaId) : null;
      const existingScenarios = existingModel ? await scenarioRepository.list(existingModel.id) : [];
      const existingMapping = existingModel ? await mappingRepository.get(existingModel.mappingId) : null;
      const existingModelImport = existingModel ? await modelImportRepository.get(existingModel.modelImportId) : null;
      const existingAnalysisSettings = existingModel ? await analysisSettingsRepository.get(existingModel.id) : undefined;
      const existingInstances = existingModel ? await lineInstanceRepository.list(existingModel.id) : [];
      if (cancelled) return;
      setModel(existingModel ?? null);
      setSchema(existingSchema ?? null);
      setScenarios(existingScenarios);
      setMapping(existingMapping ?? null);
      setModelImport(existingModelImport ?? null);
      setAnalysisSettings(existingAnalysisSettings ?? null);
      setInstances(existingInstances);
      setActiveScenarioId('base');
      setComparePeriodIndex((existingModel?.timeline.length ?? 1) - 1);
      const allLines = existingSchema?.sections.flatMap((s) => s.lines) ?? [];
      setCompareLineId((allLines.find((l) => l.rowFormat === 'total') ?? allLines[0])?.id ?? null);
      setHiddenCompareScenarios([]);
    })();
    return () => {
      cancelled = true;
    };
  }, [company.id]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(timer);
  }, [toast]);

  const currentProjectedCount = model ? model.timeline.filter((p) => p.kind === 'projected').length : 0;

  // Resyncs the horizon field when a different model loads (initial load / company switch) —
  // our own extend/shrink actions explicitly set this themselves right after, so this effect
  // firing only on `model?.id` (not on every timeline edit) never fights with that.
  useEffect(() => {
    setHorizonInput(String(currentProjectedCount));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model?.id]);

  const activeScenario = activeScenarioId === 'base' ? null : (scenarios.find((s) => s.id === activeScenarioId) ?? null);

  const evaluatedModel = recalcMode === 'auto' ? model : (manualSnapshot ?? model);
  // instancedSchema is `schema` with every live LineInstance spliced in as a real StatementLine
  // (segments, EBITDA adjustments, KPIs) — used for anything that renders rows (the grid below),
  // while `schema` itself stays the raw, savable definition (concept resolution, schema edits).
  const { schema: instancedSchema, evaluation } = useMemo(() => {
    if (!schema || !evaluatedModel) return { schema: null, evaluation: null };
    // Base's own driverValues flow through unmerged; a named scenario's sparse overrides are
    // layered on top via the same merge helper the compare view will batch-evaluate with —
    // applyDynamicInstances itself never learns scenarios exist, it just reads whichever map
    // it's handed.
    const driverValues = activeScenario
      ? mergeScenarioDriverValues(evaluatedModel.driverValues ?? {}, activeScenario.driverValues)
      : (evaluatedModel.driverValues ?? {});
    return applyDynamicInstances(schema, { ...evaluatedModel, driverValues }, instances);
  }, [schema, evaluatedModel, activeScenario, instances]);

  // Persists the active scenario's live evaluation as a ComputedResult — "computed state is a
  // cache, not a source" from the architecture contract. Auto mode only: manual mode's frozen
  // snapshot is deliberately not "the" cached truth (driver edits still save immediately either
  // way, so the next auto recompute — on next open, or toggling back to auto — catches up). The
  // issuer Dashboard tab (a later slice) reads this to show real numbers without loading the
  // engine at all; this screen's own read-path benefit is minor by comparison, since evaluateModel
  // is already synchronous and instant at this schema's scale.
  useEffect(() => {
    if (recalcMode !== 'auto' || !schema || !instancedSchema || !model || !evaluation) return;
    // instancedSchema (not schema) so a cached read (e.g. the Dashboard tab) sees instance rows
    // too — schemaUpdatedAt itself still comes from the raw schema, since instance changes are
    // tracked separately via Model.instancesUpdatedAt (see computeVersionStamp).
    const materialized = materializeEvaluation(instancedSchema, model, evaluation);
    const versionStamp = computeVersionStamp(model, activeScenario, schema);
    void computedResultRepository.set(buildComputedResult(model.id, activeScenarioId, versionStamp, materialized));
  }, [recalcMode, schema, instancedSchema, model, evaluation, activeScenario, activeScenarioId]);

  // Same cache-not-source write-through as ComputedResult above, for DCF specifically — only once
  // enabled and every required concept resolves (a partially-resolved DCF has nothing valid to
  // cache). The payoff isn't recompute speed (DCF is as cheap as evaluateModel itself) — it's what
  // lets a future cross-model reader fetch a number without loading this model/schema/scenario and
  // recomputing DCF live for each one (see AnalysisResult's own doc comment).
  useEffect(() => {
    if (recalcMode !== 'auto' || !schema || !model || !evaluation || !analysisSettings) return;
    if (!analysisSettings.enabledAnalysisIds.includes('dcf')) return;
    const dcfEntry = ANALYSIS_CATALOG.find((e) => e.id === 'dcf');
    if (!dcfEntry || missingConceptsFor(schema, dcfEntry).length > 0) return;
    const conceptLines = {
      ebit: findSummaryLine(schema, 'ebit')!.id,
      da: findSummaryLine(schema, 'da')!.id,
      capex: findSummaryLine(schema, 'capex')!.id,
      nwc: findSummaryLine(schema, 'nwc')!.id,
      taxRate: findSummaryLine(schema, 'taxRate')!.id,
    };
    const ufcfRows = computeUfcf(evaluation, model.timeline, conceptLines);
    if (ufcfRows.length === 0) return;
    const netDebtLine = findSummaryLine(schema, 'netDebt');
    const netDebt = netDebtLine ? evaluation.getValue(netDebtLine.id, lastActualIndex(model.timeline)) : null;
    const inputs = effectiveDcfInputs(analysisSettings, activeScenarioId);
    const outputs = computeDcfOutputs(ufcfRows, model.timeline, inputs, netDebt);
    const sensitivity =
      inputs.wacc !== null && inputs.terminalGrowth !== null && inputs.wacc > inputs.terminalGrowth
        ? computeSensitivityGrid(ufcfRows, model.timeline, inputs.wacc, inputs.terminalGrowth)
        : { waccValues: [], terminalGrowthValues: [], rows: [] };
    const output: DcfOutput = { ufcfRows, ...outputs, sensitivity };
    const versionStamp = computeAnalysisVersionStamp(model, activeScenario, schema, analysisSettings);
    void analysisResultRepository.set(buildAnalysisResult(model.id, activeScenarioId, 'dcf', versionStamp, output));
  }, [recalcMode, schema, model, evaluation, activeScenario, activeScenarioId, analysisSettings]);

  // Batch-evaluates Base + every scenario for the Compare tab — always against the live model
  // (auto), independent of the main grid's Auto/Manual toggle, which is specifically about not
  // recalculating the ACTIVE scenario's view on every driver edit; Compare is a separate view with
  // no such concern. evaluateModel is just called once per scenario, same call every time — no new
  // engine capability, no batch API, per the plan's own note that this is the exercise, not a
  // reason to add one.
  const compareEvaluations = useMemo(() => {
    if (!schema || !model) return [];
    const cases: Array<{ id: string; name: string; driverValues: Record<string, (number | null)[]> }> = [
      { id: 'base', name: 'Base case', driverValues: model.driverValues ?? {} },
      ...scenarios.map((s) => ({ id: s.id, name: s.name, driverValues: s.driverValues })),
    ];
    return cases.map((c) => ({
      id: c.id,
      name: c.name,
      evaluation: applyDynamicInstances(
        schema,
        { ...model, driverValues: mergeScenarioDriverValues(model.driverValues ?? {}, c.driverValues) },
        instances,
      ).evaluation,
    }));
  }, [schema, model, scenarios, instances]);

  function selectScenario(id: string) {
    setActiveScenarioId(id);
    // Manual mode freezes a snapshot the instant it's entered (see handleRecalcModeChange) —
    // switching scenarios while already frozen should show that scenario's own current values,
    // not the previously-viewed scenario's stale freeze, so re-freeze immediately on switch too.
    if (recalcMode === 'manual') setManualSnapshot(model ?? null);
  }

  async function updateDriverValue(driverId: string, periodIndex: number, value: number | null) {
    if (!model) return;
    if (activeScenario) {
      const current = activeScenario.driverValues;
      const nextValues = [...(current[driverId] ?? [])];
      while (nextValues.length <= periodIndex) nextValues.push(null);
      nextValues[periodIndex] = value;
      const updated = await scenarioRepository.update(activeScenario.id, { driverValues: { ...current, [driverId]: nextValues } });
      setScenarios((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
      return;
    }
    // A model created before driverValues existed on Model won't have the field at all yet —
    // normalize rather than assume it's always present.
    const currentDriverValues = model.driverValues ?? {};
    const nextValues = [...(currentDriverValues[driverId] ?? [])];
    while (nextValues.length <= periodIndex) nextValues.push(null);
    nextValues[periodIndex] = value;
    const updated = await modelRepository.update(model.id, { driverValues: { ...currentDriverValues, [driverId]: nextValues } });
    setModel(updated);
  }

  function openScenarioDialog(kind: 'new' | 'duplicate' | 'rename', initialName: string) {
    setPendingScenarioName(initialName);
    setScenarioDialog(kind);
  }

  async function handleCreateScenario() {
    if (!model) return;
    const created = await scenarioRepository.create({ modelId: model.id, name: pendingScenarioName.trim() });
    setScenarios((prev) => [...prev, created]);
    setScenarioDialog(null);
    setActiveScenarioId(created.id);
    setToast('Scenario created');
  }

  async function handleDuplicateScenario() {
    if (!model) return;
    // Duplicating Base takes a full snapshot of its current driver values — a real, independent
    // fork. Duplicating a named scenario copies its own sparse overrides as-is, still cascading
    // through Base beneath it, consistent with its origin.
    const sourceDriverValues = activeScenario ? activeScenario.driverValues : (model.driverValues ?? {});
    const created = await scenarioRepository.create({
      modelId: model.id,
      name: pendingScenarioName.trim(),
      driverValues: structuredClone(sourceDriverValues),
    });
    setScenarios((prev) => [...prev, created]);
    setScenarioDialog(null);
    setActiveScenarioId(created.id);
    setToast('Scenario duplicated');
  }

  async function handleRenameScenario() {
    if (!activeScenario) return;
    const updated = await scenarioRepository.update(activeScenario.id, { name: pendingScenarioName.trim() });
    setScenarios((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    setScenarioDialog(null);
    setToast('Scenario renamed');
  }

  async function handleDeleteScenario() {
    if (!activeScenario) return;
    await scenarioRepository.remove(activeScenario.id);
    setScenarios((prev) => prev.filter((s) => s.id !== activeScenario.id));
    setDeleteScenarioConfirmOpen(false);
    setActiveScenarioId('base');
    setToast('Scenario deleted');
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
    // Every scenario's own driver arrays must stay aligned to the same, now-shorter timeline —
    // otherwise a scenario's values silently drift out of index-correspondence with the periods
    // they were entered for, and this dialog's "cannot be undone" warning would be false for
    // scenario data specifically.
    const updatedScenarios = await Promise.all(
      scenarios.map((s) =>
        scenarioRepository.update(s.id, {
          driverValues: Object.fromEntries(Object.entries(s.driverValues).map(([id, values]) => [id, values.slice(0, newLength)])),
        }),
      ),
    );
    setScenarios(updatedScenarios);
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

  function openSnapshotDialog() {
    if (!model) return;
    setPendingSnapshotLabel(defaultSnapshotLabel(model));
    setPendingSnapshotNote('');
    setSnapshotDialogOpen(true);
  }

  async function handleCreateSnapshot() {
    if (!model || !schema || !mapping || !modelImport || !pendingSnapshotLabel.trim()) return;
    setSavingSnapshot(true);
    try {
      const input = buildSnapshot({
        company,
        model,
        schema,
        mapping,
        modelImport,
        scenarios,
        instances,
        label: pendingSnapshotLabel.trim(),
        note: pendingSnapshotNote.trim(),
      });
      await snapshotRepository.create(input);
      setSnapshotDialogOpen(false);
      setToast('Snapshot saved');
    } finally {
      setSavingSnapshot(false);
    }
  }

  async function openHistory() {
    const list = await snapshotRepository.list(company.id);
    setSnapshots(list);
    setHistoryOpen(true);
  }

  async function toggleAnalysis(analysisId: string, enabled: boolean) {
    if (!model) return;
    const settings = analysisSettings ?? (await analysisSettingsRepository.create(model.id));
    const nextIds = enabled
      ? [...settings.enabledAnalysisIds, analysisId]
      : settings.enabledAnalysisIds.filter((id) => id !== analysisId);
    setAnalysisSettings(await analysisSettingsRepository.update(model.id, { enabledAnalysisIds: nextIds }));
  }

  async function updateDcfInputs(scenarioId: ScenarioKey, patch: Partial<DcfInputs>) {
    if (!model) return;
    const settings = analysisSettings ?? (await analysisSettingsRepository.create(model.id));
    const current = settings.dcfInputs[scenarioId] ?? { wacc: null, terminalGrowth: null };
    const dcfInputs = { ...settings.dcfInputs, [scenarioId]: { ...current, ...patch } };
    setAnalysisSettings(await analysisSettingsRepository.update(model.id, { dcfInputs }));
  }

  if (model === undefined) {
    return <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>Loading…</span>;
  }

  if (!model || !schema || !instancedSchema) {
    return <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>No model to show.</span>;
  }

  const tabs = [
    { value: 'summary', label: 'Summary' },
    { value: 'all', label: 'All' },
    ...schema.sections.map((section) => ({ value: section.id, label: section.name })),
    ...(scenarios.length > 0 ? [{ value: 'compare', label: 'Compare' }] : []),
    { value: 'analyses', label: 'Analyses' },
  ];

  // A curated set of "key metrics" for the Compare tab — every total/subtotal line across every
  // section (Gross Profit, EBITDA, Operating Income, etc.), rather than every single line, which
  // would just be the full grid repeated once per scenario.
  const compareMetricLines = schema.sections.flatMap((s) => s.lines).filter((l) => l.rowFormat === 'total');
  const comparePeriod = Math.min(comparePeriodIndex, model.timeline.length - 1);
  const compareColumns = [
    {
      key: 'name',
      label: 'Metric',
      width: 240,
      render: (_: unknown, row: { line: StatementLine }) => (
        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', color: 'var(--text-primary)' }}>
          {row.line.name}
        </span>
      ),
    },
    ...compareEvaluations.map((c) => ({
      key: c.id,
      label: c.name,
      numeric: true,
      width: 130,
      render: (_: unknown, row: { line: StatementLine }) => {
        const value = c.evaluation.getValue(row.line.id, comparePeriod) ?? null;
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

  // The chart plots one line across every period, one series per scenario — a different question
  // from the table above (one period, every metric). Restricted to the same curated metric-line
  // set for the picker, since those are the lines reliably populated across the whole timeline in
  // practice; LineChart has no gap-rendering for a missing value, so a null here is shown as 0
  // rather than a broken path — an accepted simplification, not a claim that 0 was actually mapped.
  const compareLine = compareMetricLines.find((l) => l.id === compareLineId) ?? compareMetricLines[0] ?? null;
  const compareChartSeries = compareEvaluations.map((c, i) => ({
    key: c.id,
    data: compareLine ? model.timeline.map((_, i2) => c.evaluation.getValue(compareLine.id, i2) ?? 0) : [],
    color: `var(--chart-${(i % 12) + 1})`,
  }));
  const compareLegendSeries = compareEvaluations.map((c, i) => ({
    key: c.id,
    label: c.name,
    color: `var(--chart-${(i % 12) + 1})`,
  }));

  const rows: Array<{ id: string; __group?: string; line?: StatementLine }> = [];
  instancedSchema.sections.forEach((section) => {
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

  // The active level's OWN explicit values — a scenario's own overrides when one is active, the
  // model's (Base's) own values otherwise. Deliberately not the merged/effective map: "stored"
  // marks what THIS level actually typed, distinct from whatever it falls back to (see the render
  // below, which now tells apart two different reasons a cell isn't explicit — inherited from
  // Base vs. a computed default — after user feedback that collapsing them into one italic look
  // made it impossible to tell which one you were looking at).
  const activeStoredDriverValues = activeScenario ? activeScenario.driverValues : (model.driverValues ?? {});

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
        const stored = activeStoredDriverValues[row.id]?.[index] ?? null;
        const effective = evaluation?.getDriverValue(row.id, index) ?? null;
        const baseStored = model.driverValues?.[row.id]?.[index] ?? null;
        // Two different reasons a cell can be non-explicit, not one — this scenario is tracking
        // Base's own explicit number (will move if Base's does), or nothing at any level has an
        // explicit number and the engine computed one (0% growth, or the last actual period's own
        // implied ratio). Collapsing both into one italic look was the original design; feedback
        // after real use was that it's impossible to tell which is happening without this.
        const isInherited = stored === null && activeScenario !== null && baseStored !== null;
        const isSoft = stored === null && effective !== null;
        const title = isInherited
          ? `Tracking Base case — enter a value here to override it for "${activeScenario!.name}"`
          : isSoft
            ? 'Computed default — no explicit value entered for this period'
            : undefined;
        return (
          <span
            title={title}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 3,
              fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', fontVariantNumeric: 'var(--numeric-tabular)',
              fontStyle: isSoft ? 'italic' : 'normal',
              color: effective === null ? 'var(--text-disabled)' : isSoft ? 'var(--text-tertiary)' : 'var(--text-body)',
            }}
          >
            {isInherited ? <Icon name="corner-down-right" size={10} color="var(--text-tertiary)" /> : null}
            {formatDriverValue(effective, row.unit)}
          </span>
        );
      },
      renderEdit: (_: unknown, row: DriverDefinition, wasEditCancelled: () => boolean) => (
        <DriverValueInput
          stored={activeStoredDriverValues[row.id]?.[index] ?? null}
          unit={row.unit}
          onCommit={(value) => updateDriverValue(row.id, index, value)}
          wasEditCancelled={wasEditCancelled}
        />
      ),
    })),
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)', padding: 'var(--gutter)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-6)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-secondary)' }}>{company.name}</span>
          <h1 style={{ fontSize: 'var(--text-2xl)' }}>{model.name}</h1>
        </div>
        <div style={{ flex: '1 1 auto' }} />
        <Button variant="secondary" iconLeft="history" onClick={openHistory}>
          History
        </Button>
        <Button variant="primary" iconLeft="camera" onClick={openSnapshotDialog}>
          Snapshot
        </Button>
      </div>

      <Card
        title="Drivers"
        icon="sliders-horizontal"
        padding="none"
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-5)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <Select
                size="sm"
                options={[{ value: 'base', label: 'Base case' }, ...scenarios.map((s) => ({ value: s.id, label: s.name }))]}
                value={activeScenarioId}
                onChange={(e) => selectScenario(e.target.value)}
                style={{ width: 150 }}
              />
              <IconButton
                icon="plus"
                label="New scenario"
                size="sm"
                variant="ghost"
                onClick={() => openScenarioDialog('new', '')}
              />
              <IconButton
                icon="copy"
                label="Duplicate scenario"
                size="sm"
                variant="ghost"
                onClick={() => openScenarioDialog('duplicate', `${activeScenario ? activeScenario.name : 'Base case'} copy`)}
              />
              <IconButton
                icon="pencil"
                label="Rename scenario"
                size="sm"
                variant="ghost"
                onClick={() => activeScenario && openScenarioDialog('rename', activeScenario.name)}
                disabled={!activeScenario}
              />
              <IconButton
                icon="trash-2"
                label="Delete scenario"
                size="sm"
                variant="ghost"
                onClick={() => setDeleteScenarioConfirmOpen(true)}
                disabled={!activeScenario}
              />
            </div>
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
          // Keyed by the active scenario so switching forces a full remount — otherwise a
          // mid-edit DriverValueInput's stale local text buffer would commit against whichever
          // scenario is active by the time it blurs, silently writing to the wrong one.
          <DataTable key={activeScenarioId} columns={driverColumns} rows={schema.drivers} rowKey="id" dense stickyFirstColumn />
        )}
      </Card>

      <InstancesPanel
        schema={schema}
        allInstances={instances}
        timeline={model.timeline}
        activeStoredDriverValues={activeStoredDriverValues}
        evaluation={evaluation}
        onUpdateDriverValue={updateDriverValue}
      />

      <Tabs
        tabs={tabs}
        value={tab}
        onChange={setTab}
        size="sm"
        actions={
          tab === 'compare' ? (
            <Select
              size="sm"
              options={model.timeline.map((period, i) => ({ value: String(i), label: period.label }))}
              value={String(comparePeriod)}
              onChange={(e) => setComparePeriodIndex(Number(e.target.value))}
              style={{ width: 120 }}
            />
          ) : null
        }
      />

      {tab === 'summary' ? (
        evaluation ? <SummaryPanel schema={schema} model={model} result={evaluation} /> : null
      ) : tab === 'analyses' ? (
        evaluation ? (
          <AnalysesPanel
            schema={schema}
            model={model}
            evaluation={evaluation}
            analysisSettings={analysisSettings}
            activeScenarioId={activeScenarioId}
            onToggleAnalysis={toggleAnalysis}
            onUpdateDcfInputs={updateDcfInputs}
            onSchemaUpdated={setSchema}
            onOpenStatementDefinitions={onOpenStatementDefinitions}
          />
        ) : null
      ) : tab === 'compare' ? (
        <>
          <Card padding="none">
            <DataTable
              columns={compareColumns}
              rows={compareMetricLines.map((line) => ({ id: line.id, line }))}
              rowKey="id"
              dense
              stickyHeader
              stickyFirstColumn
            />
          </Card>

          <Card
            title="Trend"
            padding="md"
            actions={
              <Select
                size="sm"
                options={compareMetricLines.map((l) => ({ value: l.id, label: l.name }))}
                value={compareLine?.id ?? ''}
                onChange={(e) => setCompareLineId(e.target.value)}
                style={{ width: 200 }}
              />
            }
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <ChartLegend
                size="sm"
                series={compareLegendSeries}
                hidden={hiddenCompareScenarios}
                onToggle={(key) =>
                  setHiddenCompareScenarios((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))
                }
              />
              <LineChart
                series={compareChartSeries}
                labels={model.timeline.map((p) => p.label)}
                hidden={hiddenCompareScenarios}
                zeroLine
                formatY={(v) => formatPeriodValue(v, compareLine?.numberFormat)}
              />
            </div>
          </Card>
        </>
      ) : (
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
      )}

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

      <ScenarioNameDialog
        open={scenarioDialog === 'new'}
        title="New scenario"
        name={pendingScenarioName}
        confirmLabel="Create"
        onChangeName={setPendingScenarioName}
        onClose={() => setScenarioDialog(null)}
        onConfirm={handleCreateScenario}
      />
      <ScenarioNameDialog
        open={scenarioDialog === 'duplicate'}
        title="Duplicate scenario"
        name={pendingScenarioName}
        confirmLabel="Duplicate"
        onChangeName={setPendingScenarioName}
        onClose={() => setScenarioDialog(null)}
        onConfirm={handleDuplicateScenario}
      />
      <ScenarioNameDialog
        open={scenarioDialog === 'rename'}
        title="Rename scenario"
        name={pendingScenarioName}
        confirmLabel="Rename"
        onChangeName={setPendingScenarioName}
        onClose={() => setScenarioDialog(null)}
        onConfirm={handleRenameScenario}
      />

      <Dialog
        open={deleteScenarioConfirmOpen}
        onClose={() => setDeleteScenarioConfirmOpen(false)}
        icon="alert-triangle"
        title="Delete this scenario?"
        subtitle={activeScenario?.name}
        footer={
          <>
            <Button onClick={() => setDeleteScenarioConfirmOpen(false)}>Cancel</Button>
            <Button variant="danger" iconLeft="trash-2" onClick={handleDeleteScenario}>
              Delete scenario
            </Button>
          </>
        }
      >
        <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--text-body)' }}>
          Every driver assumption entered for this scenario will be permanently removed. The Base case and every other
          scenario are unaffected. This cannot be undone.
        </p>
      </Dialog>

      <Dialog
        open={snapshotDialogOpen}
        onClose={() => setSnapshotDialogOpen(false)}
        icon="camera"
        title="Save a snapshot"
        width={420}
        footer={
          <>
            <Button variant="secondary" onClick={() => setSnapshotDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              iconLeft="camera"
              disabled={!pendingSnapshotLabel.trim()}
              loading={savingSnapshot}
              onClick={handleCreateSnapshot}
            >
              Save snapshot
            </Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <Field label="Label">
            <Input
              value={pendingSnapshotLabel}
              onChange={(e) => setPendingSnapshotLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && pendingSnapshotLabel.trim()) handleCreateSnapshot();
              }}
              autoFocus
              selectOnFocus
            />
          </Field>
          <Field label="Note" hint="Optional — why this snapshot was taken.">
            <Input
              value={pendingSnapshotNote}
              onChange={(e) => setPendingSnapshotNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && pendingSnapshotLabel.trim()) handleCreateSnapshot();
              }}
              placeholder="e.g. completed earnings update"
            />
          </Field>
        </div>
      </Dialog>

      <Dialog open={historyOpen} onClose={() => setHistoryOpen(false)} icon="history" title="Snapshot history" width={640}>
        {snapshots.length === 0 ? (
          <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
            No snapshots yet. Use "Snapshot" to save one.
          </p>
        ) : (
          <DataTable
            columns={[
              {
                key: 'label',
                label: 'Snapshot',
                render: (_: unknown, row: Snapshot) => (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', color: 'var(--text-primary)' }}>
                      {row.label}
                    </span>
                    {row.note ? (
                      <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-secondary)' }}>{row.note}</span>
                    ) : null}
                  </div>
                ),
              },
              {
                key: 'createdAt',
                label: 'Date',
                width: 140,
                render: (_: unknown, row: Snapshot) => (
                  <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
                    {new Date(row.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                ),
              },
              {
                key: 'view',
                label: '',
                width: 80,
                render: (_: unknown, row: Snapshot) => (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setHistoryOpen(false);
                      onViewSnapshot(row.id);
                    }}
                  >
                    View
                  </Button>
                ),
              },
            ]}
            rows={snapshots}
            rowKey="id"
            dense
          />
        )}
      </Dialog>

      {toast ? (
        <div style={{ position: 'fixed', right: 'var(--space-8)', bottom: 'var(--space-8)', zIndex: 200 }}>
          <Toast tone="positive" title={toast} onDismiss={() => setToast(null)} />
        </div>
      ) : null}
    </div>
  );
}
