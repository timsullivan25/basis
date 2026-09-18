import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Card,
  ChartLegend,
  DataTable,
  DeltaValue,
  Dialog,
  Field,
  Icon,
  IconButton,
  Input,
  LineChart,
  MetricCard,
  Popover,
  SegmentedControl,
  Select,
  Tabs,
  Toast,
} from '@basis/design-system';
import {
  analysisResultRepository,
  analysisSettingsRepository,
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
  type Mapping,
  type Model,
  type ModelImport,
  type ProjectionMethod,
  type Scenario,
  type ScenarioKey,
  type Snapshot,
  type StatementLine,
  type StatementSchema,
} from '../data';
import { getCheckStatus, getLineRowStyle } from '../components/statements/statementFormatting';
import { formatPeriodValue } from '../components/models/mapping/mappingFormatting';
import { SummaryPanel } from '../components/models/SummaryPanel';
import { AnalysesPanel } from '../components/models/analyses/AnalysesPanel';
import { ANALYSIS_CATALOG } from '../data/analysisCatalog';
import { missingConceptsFor } from '../lib/analysisAvailability';
import { computeAnalysisVersionStamp, buildAnalysisResult } from '../lib/analysisCache';
import type { LineValues } from '../lib/computedCache';
import { recomputeAndCacheModel } from '../lib/modelRecompute';
import type { ModelMappingScreenProps } from '../components/models/mapping/ModelMappingScreen';
import {
  computeDcfOutputs,
  computeSensitivityGrid,
  computeUfcf,
  effectiveDcfInputs,
  lastActualIndex,
} from '../lib/dcf';
import { extendTimeline } from '../lib/periodTimeline';
import { mergeScenarioDriverValues, promoteScenarioDriverLine } from '../lib/scenario';
import { buildSnapshot, defaultSnapshotLabel } from '../lib/snapshot';
import { findSummaryLine, type SummaryConcept } from '../lib/summaryLines';
import { periodOverPeriodDelta, trend } from '../lib/summaryMetrics';
import { impliedHistoricalDriverValue } from '../lib/driverDisplay';
import { evaluateModel } from '../lib/engine/evaluate';
import { periodsPerYearFor, regenerateDebtSchedule } from '../lib/debtSchedule';
import { DriverValueInput, formatDriverValue } from '../components/models/DriverValueInput';

interface ModelWorkspaceScreenProps {
  company: Company;
  /** Navigates to the read-only snapshot viewer — a sibling screen, not nested here — see AppShell. */
  onViewSnapshot: (snapshotId: string) => void;
  /** Navigates to Financial Statement Definitions — used by the Analyses tab's "Add a new line…"
   *  concept-assignment escape hatch, same top-level nav-switch shape as SettingsIndexScreen's own
   *  onNavigate. */
  onOpenStatementDefinitions: () => void;
  /** Opens the mapping/schema overlay — see AppShell's own openMapping. Lets "Edit statement"
   *  below jump straight there without a detour back through the company page's Financials tab. */
  onOpenMapping: (props: ModelMappingScreenProps) => void;
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

/** The Compare tab's headline metrics — the same concepts SummaryPanel already resolves via
 *  findSummaryLine, rather than a schema-specific line list, so this works across schemas without
 *  assuming any of them share exact line names. Interim: see compareMetricLines' own comment for
 *  why this is a hardcoded list rather than a per-schema configurable one. */
const COMPARE_METRIC_CONCEPTS: SummaryConcept[] = [
  'revenue', 'ebitda', 'totalDebt', 'totalEquity', 'netDebt', 'netLeverage', 'interestCoverage',
];

/**
 * The current model's live view — a drivers panel over the projected periods, statement
 * sub-tabs over the full period grid, both reading the model's persisted historicals plus
 * every calculated line's live value from the engine (mapped-value-wins, formula as fallback —
 * see lib/engine/evaluate.ts's computeLine). No history/read-only mode yet (that's phase 07,
 * once Snapshot exists) — this is always today's current model.
 */
export function ModelWorkspaceScreen({ company, onViewSnapshot, onOpenStatementDefinitions, onOpenMapping }: ModelWorkspaceScreenProps) {
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
  // Remembers the last active Financials sub-tab (All / a statement section) across a detour to
  // Summary, Compare or Analyses, so returning to Financials restores it instead of resetting to
  // "All" — see selectTopNav below. A ref, not state: it only needs to be read back on the next
  // top-nav click, never to trigger a render of its own.
  const financialsSubTabRef = useRef('all');
  // Lines whose sub-line instances are hidden — collapsed via the chevron on a parent row in the
  // main grid below. Keyed by the parent StatementLine's id, not the instance's.
  const [collapsedParentIds, setCollapsedParentIds] = useState<Set<string>>(new Set());
  // Same idea as collapsedParentIds above, but for the Drivers card below — independent so
  // collapsing a line's children in one table doesn't affect the other.
  const [collapsedDriverParentIds, setCollapsedDriverParentIds] = useState<Set<string>>(new Set());
  // Whether the Drivers card itself (not an individual row) is collapsed — the card now lives
  // inside Financials rather than pinned above every tab (see mockup 1a), so this saves the
  // vertical space it costs while you're just reading the statement grid, not editing drivers.
  const [driversCollapsed, setDriversCollapsed] = useState(false);
  // Masthead menus — both Popovers are controlled (rather than left uncontrolled) purely so a
  // click on a menu item can close the menu itself; an uncontrolled Popover only closes on an
  // outside click, which an in-menu click isn't.
  const [scenarioMenuOpen, setScenarioMenuOpen] = useState(false);
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  // Serializes updateDriverValue's read-modify-write against the repository so two commits
  // issued in quick succession never both read the same pre-edit driverValues — see its own
  // doc comment.
  const driverWriteQueueRef = useRef<Promise<void>>(Promise.resolve());
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
      if (cancelled) return;
      setModel(existingModel ?? null);
      setSchema(existingSchema ?? null);
      setScenarios(existingScenarios);
      setMapping(existingMapping ?? null);
      setModelImport(existingModelImport ?? null);
      setAnalysisSettings(existingAnalysisSettings ?? null);
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
  // Every dynamic child line (segment, EBITDA adjustment, KPI, debt tranche) is already a real
  // StatementLine living directly in `schema` (see lib/statementLineChildren.ts) — one plain
  // evaluation, no separate splice step.
  const evaluation = useMemo(() => {
    if (!schema || !evaluatedModel) return null;
    // Base's own driverValues flow through unmerged; a named scenario's sparse overrides are
    // layered on top via the same merge helper the compare view will batch-evaluate with.
    const driverValues = activeScenario
      ? mergeScenarioDriverValues(evaluatedModel.driverValues ?? {}, activeScenario.driverValues)
      : (evaluatedModel.driverValues ?? {});
    return evaluateModel(schema, { ...evaluatedModel, driverValues });
  }, [schema, evaluatedModel, activeScenario]);

  // Persists the active scenario's live evaluation as a ComputedResult — "computed state is a
  // cache, not a source" from the architecture contract. Auto mode only: manual mode's frozen
  // snapshot is deliberately not "the" cached truth (driver edits still save immediately either
  // way, so the next auto recompute — on next open, or toggling back to auto — catches up). The
  // issuer Dashboard tab (a later slice) reads this to show real numbers without loading the
  // engine at all; this screen's own read-path benefit is minor by comparison, since evaluateModel
  // is already synchronous and instant at this schema's scale.
  useEffect(() => {
    if (recalcMode !== 'auto' || !schema || !model || !evaluation) return;
    void recomputeAndCacheModel(schema, model, evaluation, activeScenario, activeScenarioId);
  }, [recalcMode, schema, model, evaluation, activeScenario, activeScenarioId]);

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
      evaluation: evaluateModel(schema, { ...model, driverValues: mergeScenarioDriverValues(model.driverValues ?? {}, c.driverValues) }),
    }));
  }, [schema, model, scenarios]);

  function selectScenario(id: string) {
    setActiveScenarioId(id);
    // Manual mode freezes a snapshot the instant it's entered (see handleRecalcModeChange) —
    // switching scenarios while already frozen should show that scenario's own current values,
    // not the previously-viewed scenario's stale freeze, so re-freeze immediately on switch too.
    if (recalcMode === 'manual') setManualSnapshot(model ?? null);
  }

  async function updateDriverValue(driverId: string, periodIndex: number, value: number | null) {
    if (!model) return;
    const scenarioId = activeScenario?.id ?? null;
    const modelId = model.id;
    // Serialized via driverWriteQueueRef, and each turn re-reads the record fresh from the
    // repository rather than the (possibly stale-by-then) React-state closure — otherwise two
    // driver-value commits issued in quick succession both build their patch from the same
    // pre-edit driverValues, and since the repository replaces the whole field rather than deep-
    // merging it, whichever write lands last silently drops the other edit.
    const run = driverWriteQueueRef.current.then(async () => {
      if (scenarioId) {
        const latest = await scenarioRepository.get(scenarioId);
        if (!latest) return;
        let nextValues: (number | null)[];
        if (driverId in latest.driverValues) {
          // Already promoted — a plain single-cell splice, same as before.
          nextValues = [...latest.driverValues[driverId]];
          while (nextValues.length <= periodIndex) nextValues.push(null);
          nextValues[periodIndex] = value;
        } else {
          // First edit on this line for this scenario — promote the whole line by snapshotting
          // Base's current stored values into every period, then apply the edit on top.
          const baseModel = await modelRepository.getForCompany(company.id);
          nextValues = promoteScenarioDriverLine(
            baseModel?.driverValues?.[driverId] ?? [],
            baseModel?.timeline.length ?? periodIndex + 1,
            periodIndex,
            value,
          );
        }
        const updated = await scenarioRepository.update(scenarioId, { driverValues: { ...latest.driverValues, [driverId]: nextValues } });
        setScenarios((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
        return;
      }
      // A model created before driverValues existed on Model won't have the field at all yet —
      // normalize rather than assume it's always present.
      const latest = await modelRepository.getForCompany(company.id);
      const currentDriverValues = latest?.driverValues ?? {};
      const nextValues = [...(currentDriverValues[driverId] ?? [])];
      while (nextValues.length <= periodIndex) nextValues.push(null);
      nextValues[periodIndex] = value;
      const updated = await modelRepository.update(modelId, { driverValues: { ...currentDriverValues, [driverId]: nextValues } });
      setModel(updated);
    });
    driverWriteQueueRef.current = run.catch(() => {});
    await run;
  }

  // Returns a promoted (fully explicit) driver line to tracking Base live — the inverse of the
  // promotion updateDriverValue does on first edit. Routed through the same write queue to avoid
  // racing an in-flight edit on the same scenario.
  async function resetScenarioDriver(driverId: string) {
    if (!activeScenario) return;
    const scenarioId = activeScenario.id;
    const run = driverWriteQueueRef.current.then(async () => {
      const latest = await scenarioRepository.get(scenarioId);
      if (!latest) return;
      const { [driverId]: _removed, ...rest } = latest.driverValues;
      const updated = await scenarioRepository.update(scenarioId, { driverValues: rest });
      setScenarios((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
      setToast('Reset to Base case');
    });
    driverWriteQueueRef.current = run.catch(() => {});
    await run;
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

  /** The one write path this screen needs outside the mapping flow — a model-level setting (see
   *  Model.circularCalcsEnabled's own doc comment) whose only effect is which formula shape every
   *  debt tranche's interest/commitment-fee line gets, so flipping it has to regenerate the
   *  schedule and persist the schema alongside the model, not just flip a flag. */
  async function handleCircularCalcsChange(enabled: boolean) {
    if (!model || !schema) return;
    const periodType = model.timeline[0]?.type ?? 'FY';
    const nextSchema = regenerateDebtSchedule(schema, periodsPerYearFor(periodType), enabled);
    const [savedSchema, updatedModel] = await Promise.all([
      statementSchemaRepository.save(nextSchema),
      modelRepository.update(model.id, { circularCalcsEnabled: enabled }),
    ]);
    setSchema(savedSchema);
    setModel(updatedModel);
    // The auto-recalc effect above only fires in 'auto' recalc mode — recompute explicitly here
    // so a manual-mode session's cache doesn't go stale until the user happens to switch back.
    const driverValues = activeScenario
      ? mergeScenarioDriverValues(updatedModel.driverValues ?? {}, activeScenario.driverValues)
      : (updatedModel.driverValues ?? {});
    const freshEvaluation = evaluateModel(savedSchema, { ...updatedModel, driverValues });
    await recomputeAndCacheModel(savedSchema, updatedModel, freshEvaluation, activeScenario, activeScenarioId);
  }

  /** Re-fetches just the pieces a mapping/schema session could have changed — same scope as
   *  FinancialsTab's own loadModelDetails — deliberately not the full company.id-keyed load
   *  effect above, which would also reset scenario/compare selections the user has nothing to do
   *  with here. */
  async function refreshAfterMappingSession(savedModel: Model) {
    const [existingSchema, existingMapping, existingModelImport] = await Promise.all([
      statementSchemaRepository.get(savedModel.statementSchemaId),
      mappingRepository.get(savedModel.mappingId),
      modelImportRepository.get(savedModel.modelImportId),
    ]);
    setModel(savedModel);
    setSchema(existingSchema ?? null);
    setMapping(existingMapping ?? null);
    setModelImport(existingModelImport ?? null);
  }

  /** Opens the same mapping/schema overlay FinancialsTab's "Edit mapping" button does, straight
   *  from the workspace — no detour back through the company page. Jumps to Edit-schema mode
   *  since restructuring, not reviewing a fresh import, is almost always why this gets clicked
   *  from here. */
  function startEditStatement() {
    if (!model || !modelImport) return;
    onOpenMapping({
      company,
      editing: { model, modelImport },
      initialMode: 'schema',
      onCancel: () => {},
      onSaved: (updatedModel) => {
        void refreshAfterMappingSession(updatedModel);
      },
    });
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

  if (!model || !schema || !evaluation) {
    return <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>No model to show.</span>;
  }

  // Two nav levels, both driven by the one `tab` state: Summary/Financials/Compare/Analyses are
  // top-level destinations, while "All" and each statement section are sub-tabs that only make
  // sense once you're inside Financials — matching mockup 1a's masthead-then-section hierarchy
  // rather than mixing both levels into one flat tab row.
  const financialsSubTabs = [{ value: 'all', label: 'All' }, ...schema.sections.map((section) => ({ value: section.id, label: section.name }))];
  const financialsSubTabValues = new Set(financialsSubTabs.map((t) => t.value));
  const isFinancialsTab = financialsSubTabValues.has(tab);
  const topNavTabs = [
    { value: 'financials', label: 'Financials' },
    { value: 'summary', label: 'Summary' },
    { value: 'analyses', label: 'Analyses' },
    ...(scenarios.length > 0 ? [{ value: 'compare', label: 'Compare' }] : []),
  ];
  const topNavValue = isFinancialsTab ? 'financials' : tab;
  if (isFinancialsTab) financialsSubTabRef.current = tab;

  function selectTopNav(value: string) {
    // Re-entering Financials restores whichever sub-tab was last active there (tracked in the
    // ref since `tab` itself has moved on to 'summary'/'compare'/'analyses' by the time this
    // runs) rather than always resetting to "All".
    setTab(value === 'financials' ? financialsSubTabRef.current : value);
  }

  // The same headline concepts SummaryPanel already resolves — not `rowFormat === 'total'`
  // (dropped 2026-09-12), which is a display flag for bold/underline styling, not a "this is a
  // key metric" flag, and swept in every subtotal in the schema (Total Current Liabilities, Cash
  // EBITDA, ...) with no editorial judgment behind it. findSummaryLine resolves by name/alias, so
  // this list works across schemas without assuming any of them use the exact same line names.
  // Interim measure: the real fix is letting each schema pick and order its own "summary metrics"
  // in settings, which Compare and the Live output rail would both read instead of a hardcoded
  // concept list — a bigger, separately-designed feature, not a layout change.
  const compareMetricLines = COMPARE_METRIC_CONCEPTS.map((concept) => findSummaryLine(schema, concept)).filter(
    (l): l is StatementLine => Boolean(l),
  );
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

  // Every dynamic child line (segment, EBITDA adjustment, KPI, debt tranche) is a real
  // StatementLine living directly in `schema`, with its own `parentLineId` — no separate
  // instance array to cross-reference, matching the mapping screen's own parent/child row
  // treatment for the same lines.
  const childCountByParentId = new Map<string, number>();
  for (const line of schema.sections.flatMap((s) => s.lines)) {
    if (line.parentLineId === undefined) continue;
    childCountByParentId.set(line.parentLineId, (childCountByParentId.get(line.parentLineId) ?? 0) + 1);
  }

  // Debt Schedule's generated lines (see lib/debtSchedule.ts) group by tranche via
  // debtScheduleRole.trancheLineId — a different relationship from parentLineId (see that
  // field's own doc comment), so it needs its own sub-header insertion here rather than reusing
  // the parent/child collapse logic above. A schedule-level line (no trancheLineId, e.g.
  // "Minimum Cash Target") renders ungrouped, same as any ordinary top-level line.
  const lineNameById = new Map(schema.sections.flatMap((s) => s.lines).map((l) => [l.id, l.name]));

  const rows: Array<{ id: string; __group?: string; line?: StatementLine; isChild?: boolean; childCount?: number }> = [];
  schema.sections.forEach((section) => {
    if (tab !== 'all' && tab !== section.id) return;
    if (!section.lines.length) return;
    rows.push({ id: `group-${section.id}`, __group: section.name });
    let lastTrancheHeaderId: string | undefined;
    section.lines.forEach((line) => {
      const parentId = line.parentLineId;
      if (parentId !== undefined && collapsedParentIds.has(parentId)) return;
      const trancheLineId = line.debtScheduleRole?.trancheLineId;
      if (trancheLineId !== undefined && trancheLineId !== lastTrancheHeaderId) {
        rows.push({ id: `debt-tranche-${trancheLineId}`, __group: lineNameById.get(trancheLineId) ?? 'Tranche' });
      }
      lastTrancheHeaderId = trancheLineId;
      rows.push({
        id: line.id, line, isChild: parentId !== undefined || trancheLineId !== undefined,
        childCount: childCountByParentId.get(line.id),
      });
    });
  });

  function toggleParentCollapsed(lineId: string) {
    setCollapsedParentIds((prev) => {
      const next = new Set(prev);
      if (next.has(lineId)) next.delete(lineId);
      else next.add(lineId);
      return next;
    });
  }

  const columns = [
    {
      key: 'name',
      label: 'Line',
      width: 240,
      render: (_: unknown, row: { line?: StatementLine; isChild?: boolean; childCount?: number }) => {
        if (!row.line) return null;
        return (
          <TreeRowLabel
            label={row.line.name}
            isChild={Boolean(row.isChild)}
            hasChildren={Boolean(row.childCount)}
            collapsed={collapsedParentIds.has(row.line.id)}
            onToggleCollapse={() => toggleParentCollapsed(row.line!.id)}
          />
        );
      },
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
        // itself doesn't need a second color cue on top of that. A lineKind 'check' line is the
        // one deliberate exception — its whole purpose is to flag its own computed value.
        const value = evaluation?.getValue(row.line.id, i) ?? null;
        const checkStatus = getCheckStatus(row.line, value);
        if (checkStatus !== 'unknown') {
          return (
            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4, width: '100%' }}>
              <Icon
                name={checkStatus === 'fail' ? 'alert-triangle' : 'check'}
                size={12}
                color={checkStatus === 'fail' ? 'var(--text-negative)' : 'var(--text-positive)'}
              />
              <span
                style={{
                  fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', fontVariantNumeric: 'var(--numeric-tabular)',
                  fontWeight: checkStatus === 'fail' ? 'var(--weight-semibold)' : undefined,
                  color: checkStatus === 'fail' ? 'var(--text-negative)' : 'var(--text-positive)',
                }}
              >
                {formatPeriodValue(value, row.line.numberFormat)}
              </span>
            </span>
          );
        }
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

  // The Drivers card below is now the combined "Drivers + Segments/adjustments/KPIs" view —
  // structure (name, source mapping, method, basis) is owned by mapping now (see the Phase 9
  // revision), so the only thing left to show here is a name and, where one exists, an editable
  // driver value — exactly the same shape as an ordinary driver row. An instance nests under its
  // parent line's row the same way its financials do in the grid above (indent + corner-down-
  // right icon, parent gets a collapse chevron). A parent line with no driver of its own (a pure
  // aggregation line like an EBITDA Delta) still gets a row once it has ≥1 instance to hold, but
  // never as an empty placeholder — an allowsSubLines line with nothing under it and no driver of
  // its own simply doesn't appear, same as today.
  interface DriverRow {
    id: string;
    name: string;
    isChild: boolean;
    /** Set only on a section-header divider row — every other field is meaningless on that row,
     *  since DataTable renders a __group row specially and never calls a column's `render` for
     *  it (same convention as the statement grid's own `rows` array above). */
    __group?: string;
    /** True for a parent line that has ≥1 real child line — its own value is superseded by the
     *  sum of those children for every period (see lib/statementLineChildren.ts), so its own
     *  driver cell, though still rendered, is locked rather than edited. */
    hasChildren: boolean;
    childCount?: number;
    driverId?: string;
    unit?: string;
    /** Only set alongside driverId, for a row whose method has a well-defined implied historical
     *  value (growth/percent-of/days-of) — see lib/driverDisplay.ts. Absent for a 'flat' row, a
     *  driver-less row, or an 'actual'/'roll-off' child projection, all of which show a plain
     *  dash in historical columns instead of an implied number. */
    targetLineId?: string;
    method?: ProjectionMethod;
    basisLineId?: string;
  }

  const schemaDriverByLineId = new Map(schema.drivers.map((d) => [d.targetLineId, d]));
  const childLinesByParentId = new Map<string, StatementLine[]>();
  const kpiLinesBySectionId = new Map<string, StatementLine[]>();
  for (const section of schema.sections) {
    for (const line of section.lines) {
      if (line.parentLineId !== undefined) {
        const group = childLinesByParentId.get(line.parentLineId) ?? [];
        group.push(line);
        childLinesByParentId.set(line.parentLineId, group);
      } else if (section.allowsFreeformLines) {
        const group = kpiLinesBySectionId.get(section.id) ?? [];
        group.push(line);
        kpiLinesBySectionId.set(section.id, group);
      }
    }
  }

  function childDriverFields(
    child: StatementLine,
    activeSchema: StatementSchema,
  ): { driverId?: string; unit?: string; method?: ProjectionMethod; basisLineId?: string } {
    const projection = child.projection;
    if (!projection || projection.method === 'flat' || !('driverId' in projection)) return {};
    const driverId = projection.driverId;
    const driver = activeSchema.drivers.find((d) => d.id === driverId);
    return { driverId, unit: driver?.unit, method: projection.method, basisLineId: driver?.basisLineId };
  }

  const driverRows: DriverRow[] = [];
  for (const section of schema.sections) {
    // Track where this section's own rows start so a group-header divider (same __group
    // convention the statement grid's own `rows` array uses) can be spliced in front of them —
    // but only once we know the section actually produced at least one row, so a section with
    // no drivers/instances anywhere in it (e.g. one that's pure ratios) doesn't get an empty
    // header floating above nothing, mirroring driverRows' existing "no placeholder rows" rule.
    const sectionStartIndex = driverRows.length;
    for (const line of section.lines) {
      if (line.parentLineId !== undefined) continue; // rendered as a child below its parent, not its own top-level row
      const ownDriver = schemaDriverByLineId.get(line.id);
      const children = line.allowsSubLines ? (childLinesByParentId.get(line.id) ?? []) : [];
      if (!ownDriver && children.length === 0) continue;
      driverRows.push({
        id: line.id, name: line.name, isChild: false, hasChildren: children.length > 0,
        childCount: children.length, driverId: ownDriver?.id, unit: ownDriver?.unit,
        targetLineId: ownDriver?.targetLineId, method: ownDriver?.method, basisLineId: ownDriver?.basisLineId,
      });
      if (collapsedDriverParentIds.has(line.id)) continue;
      for (const child of children) {
        driverRows.push({
          id: child.id, name: child.name, isChild: true, hasChildren: false, targetLineId: child.id,
          ...childDriverFields(child, schema),
        });
      }
    }
    if (section.allowsFreeformLines) {
      for (const child of kpiLinesBySectionId.get(section.id) ?? []) {
        driverRows.push({
          id: child.id, name: child.name, isChild: false, hasChildren: false, targetLineId: child.id,
          ...childDriverFields(child, schema),
        });
      }
    }
    if (driverRows.length > sectionStartIndex) {
      driverRows.splice(sectionStartIndex, 0, { id: `driver-group-${section.id}`, name: section.name, isChild: false, hasChildren: false, __group: section.name });
    }
  }

  function toggleDriverParentCollapsed(lineId: string) {
    setCollapsedDriverParentIds((prev) => {
      const next = new Set(prev);
      if (next.has(lineId)) next.delete(lineId);
      else next.add(lineId);
      return next;
    });
  }

  // A line is "promoted" (fully explicit for this scenario) the moment its driverId is a key in
  // the scenario's own driverValues at all — see lib/scenario.ts's doc comment for the per-line,
  // all-or-nothing contract. Always false for Base itself (nothing to inherit from).
  function isDriverPromoted(row: DriverRow): boolean {
    return activeScenario !== null && Boolean(row.driverId) && row.driverId! in activeScenario.driverValues;
  }

  const driverColumns = [
    {
      key: 'name',
      label: 'Driver',
      width: 240,
      render: (_: unknown, row: DriverRow, isRowHovered: boolean) => (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
          <TreeRowLabel
            label={row.name}
            isChild={row.isChild}
            hasChildren={row.hasChildren}
            collapsed={collapsedDriverParentIds.has(row.id)}
            onToggleCollapse={() => toggleDriverParentCollapsed(row.id)}
          />
          {isDriverPromoted(row) ? (
            <div
              onClick={(e) => e.stopPropagation()}
              style={{ display: 'flex', flex: '0 0 auto', opacity: isRowHovered ? 1 : 0, transition: 'opacity var(--dur-instant) var(--ease-out)' }}
            >
              <IconButton
                icon="refresh-ccw"
                label="Reset to Base case"
                size="sm"
                variant="ghost"
                onClick={() => resetScenarioDriver(row.driverId!)}
              />
            </div>
          ) : null}
        </div>
      ),
    },
    // Every period, actual and projected — not just projectedPeriods — so this table's columns
    // line up 1:1 with the statement grid's below it (same count ⇒ the DataTable's own auto
    // column-width layout stretches both to the same per-column width; previously the Drivers
    // table's own narrower period set stretched wider than the grid's, throwing the two visibly
    // out of alignment). Historical columns render an implied value or a dash — see below — never
    // an editable cell, so nothing about entering projected assumptions changes here.
    ...model.timeline.map((period, index) => ({
      key: `p${index}`,
      label: period.label,
      numeric: true,
      width: 110,
      background: period.kind === 'projected' ? 'var(--alpha-blue-06)' : undefined,
      render: (_: unknown, row: DriverRow) => {
        if (row.hasChildren) {
          // A parent's historical value comes directly from summing its instances' own mapped
          // historicals (see withDynamicInstances.ts), not from any driver — the lock treatment
          // below is specifically about a PROJECTED value being superseded, so it doesn't apply
          // to a period where there was never a driver-derived value to supersede.
          if (period.kind !== 'projected') {
            return <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-disabled)' }}>—</span>;
          }
          return (
            <span
              title={`Value comes from ${row.childCount} sub-line${row.childCount === 1 ? '' : 's'} — see Segments, adjustments & KPIs`}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}
            >
              <Icon name="lock" size={10} color="var(--text-tertiary)" />
              {row.driverId ? formatDriverValue(evaluation?.getDriverValue(row.driverId, index) ?? null, row.unit!) : '—'}
            </span>
          );
        }
        if (!row.driverId) {
          return <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-disabled)' }}>—</span>;
        }
        if (period.kind !== 'projected') {
          const implied =
            evaluation && row.method && row.targetLineId
              ? impliedHistoricalDriverValue(evaluation, row.targetLineId, row.method, row.basisLineId, index)
              : null;
          return (
            <span
              title="Implied by actual results for this period — not a stored assumption"
              style={{
                fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', fontVariantNumeric: 'var(--numeric-tabular)',
                fontStyle: 'italic', color: implied === null ? 'var(--text-disabled)' : 'var(--text-tertiary)',
              }}
            >
              {formatDriverValue(implied, row.unit!)}
            </span>
          );
        }
        const stored = activeStoredDriverValues[row.driverId]?.[index] ?? null;
        const effective = evaluation?.getDriverValue(row.driverId, index) ?? null;
        // Two different reasons a cell can be non-explicit, not one — this whole LINE is tracking
        // Base live (nothing on it promoted yet for this scenario — see isDriverPromoted/lib/
        // scenario.ts's per-line contract), or nothing at any level has an explicit number and the
        // engine computed one (0% growth, or the last actual period's own implied ratio).
        // Collapsing both into one italic look was the original design; feedback after real use
        // was that it's impossible to tell which is happening without this.
        const isInherited = activeScenario !== null && !isDriverPromoted(row);
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
            {formatDriverValue(effective, row.unit!)}
          </span>
        );
      },
      canEdit: (row: DriverRow) => period.kind === 'projected' && Boolean(row.driverId) && !row.hasChildren,
      renderEdit: (_: unknown, row: DriverRow, wasEditCancelled: () => boolean) =>
        row.driverId ? (
          <DriverValueInput
            initialValue={evaluation?.getDriverValue(row.driverId, index) ?? null}
            unit={row.unit!}
            onCommit={(value) => updateDriverValue(row.driverId!, index, value)}
            wasEditCancelled={wasEditCancelled}
          />
        ) : null,
    })),
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)', padding: 'var(--gutter)' }}>
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-4)' }}>
        {/* model.name defaults to the uploaded file's name at creation (see ModelMappingScreen's
            modelRepository.create call) and has no rename flow yet — showing it here read as raw
            file metadata rather than a meaningful title, so the heading is the company instead. */}
        <h1 style={{ fontSize: 'var(--text-2xl)' }}>{company.name}</h1>
        <div style={{ flex: '1 1 auto' }} />
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
          <Popover
            open={scenarioMenuOpen}
            onOpenChange={setScenarioMenuOpen}
            placement="bottom-start"
            width={190}
            title="Scenario"
            trigger={<IconButton icon="chevron-down" label="More scenario actions" size="sm" variant="ghost" />}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1, margin: 'calc(var(--space-6) * -1)' }}>
              <MenuAction
                icon="copy"
                label="Duplicate"
                onClick={() => {
                  setScenarioMenuOpen(false);
                  openScenarioDialog('duplicate', `${activeScenario ? activeScenario.name : 'Base case'} copy`);
                }}
              />
              <MenuAction
                icon="pencil"
                label="Rename"
                disabled={!activeScenario}
                onClick={() => {
                  setScenarioMenuOpen(false);
                  if (activeScenario) openScenarioDialog('rename', activeScenario.name);
                }}
              />
              <MenuAction
                icon="trash-2"
                label="Delete"
                disabled={!activeScenario}
                tone="danger"
                onClick={() => {
                  setScenarioMenuOpen(false);
                  setDeleteScenarioConfirmOpen(true);
                }}
              />
            </div>
          </Popover>
        </div>
        <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--border-default)' }} />
        <Button iconLeft="git-merge" size="sm" onClick={startEditStatement} disabled={!model || !modelImport}>
          Edit statement
        </Button>
        <IconButton icon="history" label="History" size="sm" variant="ghost" onClick={openHistory} />
        <Button variant="primary" iconLeft="camera" onClick={openSnapshotDialog}>
          Snapshot
        </Button>
        <Popover
          open={settingsMenuOpen}
          onOpenChange={setSettingsMenuOpen}
          placement="bottom-end"
          width={200}
          title="Recalculation"
          trigger={<IconButton icon="settings" label="Model settings" size="sm" variant="ghost" />}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <SegmentedControl
              size="sm"
              options={[
                { value: 'auto', label: 'Auto' },
                { value: 'manual', label: 'Manual' },
              ]}
              value={recalcMode}
              onChange={(value) => handleRecalcModeChange(value as 'auto' | 'manual')}
              fullWidth
            />
            {recalcMode === 'manual' ? (
              <Button size="sm" variant="primary" iconLeft="refresh-cw" onClick={recalculate} fullWidth>
                Recalculate
              </Button>
            ) : null}
            <div style={{ borderTop: '1px solid var(--border-default)', paddingTop: 'var(--space-3)', marginTop: 'var(--space-1)' }}>
              <div style={{ fontSize: 'var(--text-2xs)', fontWeight: 'var(--weight-semibold)', letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: 'var(--space-3)' }}>
                Debt Schedule
              </div>
              <SegmentedControl
                size="sm"
                options={[
                  { value: 'beginning', label: 'Beginning only' },
                  { value: 'circular', label: 'Avg. balance' },
                ]}
                value={model?.circularCalcsEnabled ? 'circular' : 'beginning'}
                onChange={(value) => void handleCircularCalcsChange(value === 'circular')}
                fullWidth
              />
              <p style={{ margin: 'var(--space-2) 0 0', fontSize: 'var(--text-2xs)', color: 'var(--text-tertiary)' }}>
                Whether tranche interest accrues on the average of Beginning/Ending balance (a
                circular calc, solved automatically) or Beginning balance alone.
              </p>
            </div>
          </div>
        </Popover>
      </div>

      <Tabs
        tabs={topNavTabs}
        value={topNavValue}
        onChange={selectTopNav}
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

      {isFinancialsTab ? (
        // Plain background, same as the top nav above — a filled/sunken strip here read as
        // heavier than the primary nav it's subordinate to, backwards from the hierarchy it's
        // meant to show. The indent plus the underline-tab convention already carries "these are
        // Financials' own sub-views" without needing a color block to say it again.
        <Tabs
          tabs={financialsSubTabs}
          value={tab}
          onChange={setTab}
          size="sm"
          style={{ paddingLeft: 'var(--space-6)' }}
        />
      ) : null}

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
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-4)' }}>
        <div style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <Card
            title={
              <button
                type="button"
                onClick={() => setDriversCollapsed((v) => !v)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                  background: 'transparent', border: 'none', padding: 0, margin: 0, cursor: 'pointer',
                  font: 'inherit', color: 'inherit',
                }}
              >
                <Icon name={driversCollapsed ? 'chevron-right' : 'chevron-down'} size={12} color="var(--text-tertiary)" />
                <span>Drivers</span>
              </button>
            }
            icon="sliders-horizontal"
            padding="none"
            actions={
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-secondary)' }}>Projected periods</span>
                <Input
                  size="sm"
                  mono
                  type="number"
                  value={horizonInput}
                  onChange={(e) => setHorizonInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitHorizonChange();
                  }}
                  onBlur={commitHorizonChange}
                  fullWidth={false}
                  style={{ width: 56 }}
                />
              </div>
            }
          >
            {driversCollapsed ? null : driverRows.length === 0 ? (
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
              <DataTable key={activeScenarioId} columns={driverColumns} rows={driverRows} rowKey="id" dense stickyFirstColumn />
            )}
          </Card>

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
        </div>
        {evaluation ? (
          <LiveOutputRail
            schema={schema}
            model={model}
            evaluation={evaluation}
            compareEvaluations={compareEvaluations}
            activeScenarioId={activeScenarioId}
            compareMetricLines={compareMetricLines}
          />
        ) : null}
        </div>
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

/** One row in the scenario-actions Popover menu — full-width, left-aligned, hover-highlighted.
 *  There's no design-system menu-list primitive yet; this is deliberately minimal rather than a
 *  new DS component, since it's currently only used in this one place. */
function MenuAction({
  icon, label, onClick, disabled = false, tone = 'default',
}: {
  icon: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'default' | 'danger';
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 'var(--space-3)', width: '100%',
        padding: 'var(--space-3) var(--space-6)', background: hover && !disabled ? 'var(--surface-hover)' : 'transparent',
        border: 'none', cursor: disabled ? 'not-allowed' : 'pointer', textAlign: 'left',
        font: 'inherit', fontSize: 'var(--text-xs)',
        color: disabled ? 'var(--text-disabled)' : tone === 'danger' ? 'var(--text-negative)' : 'var(--text-body)',
      }}
    >
      <Icon name={icon} size={12} color={disabled ? 'var(--text-disabled)' : tone === 'danger' ? 'var(--text-negative)' : 'var(--text-tertiary)'} />
      {label}
    </button>
  );
}

/** Financials-only sidebar giving live feedback as drivers are edited — mockup 1a's "Live output"
 *  rail. Anchored on the timeline's LAST period (actual or projected), not SummaryPanel's own
 *  latest-actual: the whole point is to reflect the projection you're currently shaping, which
 *  only moves on projected periods. Returns null when there's nothing to show (no Revenue/EBITDA
 *  concept resolved and no non-Base scenario active), rather than an empty shell. */
function LiveOutputRail({
  schema, model, evaluation, compareEvaluations, activeScenarioId, compareMetricLines,
}: {
  schema: StatementSchema;
  model: Model;
  evaluation: LineValues;
  compareEvaluations: Array<{ id: string; name: string; evaluation: LineValues }>;
  activeScenarioId: string;
  compareMetricLines: StatementLine[];
}) {
  const latest = model.timeline.length - 1;
  const kpiLines = [findSummaryLine(schema, 'revenue'), findSummaryLine(schema, 'ebitda')].filter(
    (l): l is StatementLine => Boolean(l),
  );

  const activeCompare = compareEvaluations.find((c) => c.id === activeScenarioId);
  const baseCompare = compareEvaluations.find((c) => c.id === 'base');
  // Comparing Base to itself would just show zero deltas everywhere — only worth a card once a
  // different scenario is active. Capped to the same curated "total" lines the Compare tab uses,
  // trimmed further since this is a narrow sidebar rather than a full table.
  const showDelta = activeScenarioId !== 'base' && Boolean(activeCompare) && Boolean(baseCompare);
  const deltaLines = compareMetricLines.slice(0, 4);

  if (kpiLines.length === 0 && !showDelta) return null;

  return (
    <div style={{ width: 260, flex: 'none', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <span
        style={{
          fontSize: 'var(--text-2xs)', fontWeight: 'var(--weight-semibold)', letterSpacing: '.07em',
          textTransform: 'uppercase', color: 'var(--text-secondary)',
        }}
      >
        Live output
      </span>

      {kpiLines.map((line) => (
        <MetricCard
          key={line.id}
          label={line.name}
          value={formatPeriodValue(evaluation.getValue(line.id, latest), line.numberFormat)}
          delta={periodOverPeriodDelta(evaluation, line.id, latest)}
          deltaLabel="vs prior period"
          spark={trend(evaluation, line.id, model)}
        />
      ))}

      {showDelta ? (
        <Card title={`vs Base Case · ${model.timeline[latest]?.label ?? ''}`} padding="sm">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {deltaLines.map((line) => {
              const activeValue = activeCompare!.evaluation.getValue(line.id, latest);
              const baseValue = baseCompare!.evaluation.getValue(line.id, latest);
              const deltaPct =
                activeValue !== null && baseValue !== null && baseValue !== 0
                  ? ((activeValue - baseValue) / Math.abs(baseValue)) * 100
                  : null;
              return (
                <div key={line.id} style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-2)' }}>
                  <span style={{ flex: '1 1 auto', minWidth: 0, fontSize: 'var(--text-xs)', color: 'var(--text-body)' }}>
                    {line.name}
                  </span>
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)',
                      fontVariantNumeric: 'var(--numeric-tabular)', color: 'var(--text-primary)',
                    }}
                  >
                    {formatPeriodValue(activeValue, line.numberFormat)}
                  </span>
                  {deltaPct !== null ? <DeltaValue value={deltaPct} size="sm" /> : null}
                </div>
              );
            })}
          </div>
        </Card>
      ) : null}
    </div>
  );
}

/** Shared "name" cell for a parent/child row — the statement grid and the Drivers card both
 *  nest instance rows under their parent line the same way, so this is the one place that
 *  treatment is defined rather than two independently-maintained copies. Module-level (not
 *  nested inside ModelWorkspaceScreen) so its identity is stable across renders. */
function TreeRowLabel({
  label, isChild, hasChildren, collapsed, onToggleCollapse,
}: {
  label: string;
  isChild: boolean;
  hasChildren: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
      {hasChildren ? (
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            onToggleCollapse();
          }}
          style={{ display: 'flex', cursor: 'pointer', flex: '0 0 auto' }}
        >
          <Icon name={collapsed ? 'chevron-right' : 'chevron-down'} size={12} color="var(--text-tertiary)" />
        </span>
      ) : isChild ? (
        <Icon name="corner-down-right" size={11} color="var(--text-tertiary)" />
      ) : (
        <span style={{ width: 12, flex: '0 0 auto' }} />
      )}
      <span
        style={{
          fontSize: 'var(--text-sm)',
          fontWeight: isChild ? 'var(--weight-regular)' : 'var(--weight-medium)',
          color: isChild ? 'var(--text-secondary)' : 'var(--text-primary)',
        }}
      >
        {label}
      </span>
    </div>
  );
}
