import { useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, Card, DataTable, Dialog, Icon, Input, Select, Tabs, Toast } from '@basis/design-system';
import {
  computedResultRepository,
  lineInstanceRepository,
  mappingRepository,
  modelImportRepository,
  modelRepository,
  type Company,
  type LineInstance,
  type LineMapping,
  type Model,
  type ModelImport,
  type ModelTemplateType,
  type ParsedWorkbook,
  type StatementLine,
  type StatementSchema,
} from '../../../data';
import { DEFAULT_ADJUSTMENT_INSTANCE_SEEDS, DEFAULT_ADJUSTMENT_TARGET_LINE_NAME, DEFAULT_SCHEMA_ID } from '../../../data/defaultStatementSchema';
import { parseBasisTemplate, TemplateParseError } from '../../../lib/parseBasisTemplate';
import { matchStatementLines } from '../../../lib/matchStatementLines';
import { buildComputedResult, computeVersionStamp, materializeEvaluation } from '../../../lib/computedCache';
import { buildTimeline } from '../../../lib/periodTimeline';
import { resolveActuals } from '../../../lib/resolveActuals';
import { buildNameIndex, formatFormula, isCalculated } from '../../../lib/engine/resolve';
import { applyDynamicInstances } from '../../../lib/engine/withDynamicInstances';
import { getLineRowStyle, getRequiredMeta } from '../../statements/statementFormatting';
import type { InstanceProjectionSelection, InstanceTarget, SchemaLineGroup } from '../instances/projectionMethod';
import { InstanceRowDetail, type EditableInstance } from './InstanceRowDetail';
import { ImportedLinesDialog } from './ImportedLinesDialog';
import { MappedLinesDialog } from './MappedLinesDialog';
import { MappingRowDetail } from './MappingRowDetail';
import { formatPeriodValue, isLowConfidence, isMissingRequired, needsReview, MATCH_METHOD_META } from './mappingFormatting';

const STEPS = ['Upload model', 'Map line items', 'Save'];

export interface ModelMappingScreenProps {
  company: Company;
  /** Every statement schema available to map against. */
  schemas: StatementSchema[];
  /** Re-reviewing an already-saved model's existing file — Save updates its mapping in place. Schema fixed. */
  editing?: { model: Model; modelImport: ModelImport };
  /** A freshly-picked, not-yet-saved file — Save creates a new model (schema editable until saved). */
  draft?: {
    templateType: ModelTemplateType;
    file: File;
    /** The company's current model, if any — seeds prior-mapping hints and triggers the replace confirm on save. */
    existingModel?: Model;
  };
  onCancel: () => void;
  onSaved: (model: Model) => void;
}

export function ModelMappingScreen({ company, schemas, editing, draft, onCancel, onSaved }: ModelMappingScreenProps) {
  const file = editing?.modelImport.file ?? draft?.file;
  const fileName = editing?.modelImport.fileName ?? draft?.file.name ?? '';
  if (!file) throw new Error('ModelMappingScreen requires either editing or draft.');

  // Fixed once a model is saved; freely editable while still a draft (with a reset warning — see handleSchemaSelect).
  const [selectedSchemaId, setSelectedSchemaId] = useState(() => {
    if (editing && schemas.some((s) => s.id === editing.model.statementSchemaId)) return editing.model.statementSchemaId;
    return schemas[0]?.id ?? '';
  });
  const [pendingSchemaId, setPendingSchemaId] = useState<string | null>(null);
  const statementSchema = schemas.find((s) => s.id === selectedSchemaId);
  if (!statementSchema) throw new Error(`Statement schema not found: ${selectedSchemaId}`);

  const [workbook, setWorkbook] = useState<ParsedWorkbook | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [mapping, setMapping] = useState<Record<string, LineMapping>>({});
  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');
  const [onlyReview, setOnlyReview] = useState(false);
  const [expandedLineId, setExpandedLineId] = useState<string | null>(null);
  const [importedLinesOpen, setImportedLinesOpen] = useState(false);
  const [mappedLinesOpen, setMappedLinesOpen] = useState(false);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [replaceConfirmOpen, setReplaceConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedToast, setSavedToast] = useState(false);
  // Every sub-line/KPI instance for this model, existing or newly added this session — unified
  // (unlike the two-list split this screen shipped with) because structure (name, source
  // mapping, method, basis) is a mapping-time decision now, edited here whether the instance is
  // brand new or already persisted; nothing writes to IndexedDB before Save, same deferred
  // convention `mapping` itself already follows. A new instance's `id` is a local-only key,
  // discarded once the real LineInstance is created in handleSave (see its own comment).
  const [editableInstances, setEditableInstances] = useState<EditableInstance[]>([]);
  // Existing instances the user removed this session — actually deleted from the repository
  // only in handleSave(), matching everything else here being deferred until Save.
  const [deletedInstanceIds, setDeletedInstanceIds] = useState<string[]>([]);
  // An instance with no source mapping (sourceLineIds.length === 0) gets its historicals typed
  // in directly instead — the one-time-manual-adjustment case. Keyed by instance id, aligned
  // 1:1 with workbook.periods; seeded from the model's existing historicals when re-opening
  // mapping for an already-persisted manual instance.
  const [manualHistoricals, setManualHistoricals] = useState<Record<string, (number | null)[]>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const parsed = await parseBasisTemplate(file);
        if (!cancelled) setWorkbook(parsed);
      } catch (err) {
        if (!cancelled) setParseError(err instanceof TemplateParseError ? err.message : 'Could not parse the uploaded file.');
      }
      const existingInstances = editing ? await lineInstanceRepository.list(editing.model.id) : [];
      if (!cancelled) {
        setEditableInstances(
          existingInstances.map((i) => ({
            id: i.id, isNew: false, lineId: i.lineId, sectionId: i.sectionId, name: i.name,
            sourceLineIds: i.sourceLineIds ?? [], projection: i.projection,
          })),
        );
        setDeletedInstanceIds([]);
        const seededManual: Record<string, (number | null)[]> = {};
        for (const inst of existingInstances) {
          if ((inst.sourceLineIds ?? []).length === 0) seededManual[inst.id] = editing?.model.historicals[inst.id] ?? [];
        }
        setManualHistoricals(seededManual);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.modelImport.id, draft?.file]);

  // Recomputes whenever the schema changes — including the reset that a schema switch is meant
  // to cause. Restores the saved mapping only when re-reviewing the same file against the schema
  // it was actually saved with; any other case (a fresh draft, or a schema switch away from that)
  // gets a fresh auto-match, seeded with hints from the company's existing model when there is one.
  useEffect(() => {
    if (!workbook) return;
    let cancelled = false;
    (async () => {
      if (editing && selectedSchemaId === editing.model.statementSchemaId) {
        const savedMapping = await mappingRepository.get(editing.model.mappingId);
        if (!cancelled && savedMapping) {
          // A saved mapping can predate a schema line that's since become mappable (or just
          // been added) — back those in with a fresh match rather than leaving them undefined,
          // which MappingRowDetail (a required, non-optional prop) would otherwise crash on.
          const fresh = matchStatementLines(statementSchema.sections, workbook.lines);
          const saved = Object.fromEntries(savedMapping.lines.map((m) => [m.targetLineId, m]));
          setMapping({ ...fresh, ...saved });
        }
        return;
      }

      let hints: Record<string, string[]> = {};
      if (draft?.existingModel) {
        try {
          const [priorMapping, priorImport] = await Promise.all([
            mappingRepository.get(draft.existingModel.mappingId),
            modelImportRepository.get(draft.existingModel.modelImportId),
          ]);
          if (priorMapping && priorImport) {
            const priorWorkbook = await parseBasisTemplate(priorImport.file);
            hints = Object.fromEntries(
              priorMapping.lines
                .filter((m) => m.sourceLineIds.length > 0)
                .map((m) => [
                  m.targetLineId,
                  m.sourceLineIds
                    .map((id) => priorWorkbook.lines.find((l) => l.id === id)?.name)
                    .filter((name): name is string => Boolean(name)),
                ]),
            );
          }
        } catch {
          // Prior file no longer parseable — fall back to a plain match rather than blocking the new one.
        }
      }
      if (!cancelled) setMapping(matchStatementLines(statementSchema.sections, workbook.lines, hints));

      // A brand-new model built on the unmodified default schema gets a few common EBITDA
      // adjustments seeded automatically, each trying to auto-match the uploaded file exactly
      // like any other line's aliases would (see DEFAULT_ADJUSTMENT_INSTANCE_SEEDS' own doc
      // comment) — the "upload and it just works" case, with zero effect on a re-review or a
      // custom/duplicated schema. Never for `editing` — re-opening mapping for an
      // already-persisted model must never re-seed duplicates of instances it already has.
      if (!editing && !cancelled && selectedSchemaId === DEFAULT_SCHEMA_ID) {
        const targetLine = statementSchema.sections.flatMap((s) => s.lines).find((l) => l.name === DEFAULT_ADJUSTMENT_TARGET_LINE_NAME);
        if (targetLine) {
          const seedSections: StatementSchema['sections'] = [
            {
              id: 'seed-adjustments',
              name: targetLine.name,
              lines: DEFAULT_ADJUSTMENT_INSTANCE_SEEDS.map((seed) => ({
                id: crypto.randomUUID(),
                name: seed.name,
                required: false,
                rowFormat: 'normal',
                numberFormat: 'number',
                sign: 'natural',
                aggregation: 'sum',
                formula: null,
                projection: null,
                aliases: seed.aliases,
              })),
            },
          ];
          const seedMatches = matchStatementLines(seedSections, workbook.lines);
          // Only seed once — if the target line already has any instance (e.g. the schema was
          // switched away and back), leave whatever's there rather than appending duplicates.
          setEditableInstances((prev) => {
            if (prev.some((e) => e.lineId === targetLine.id)) return prev;
            return [
              ...prev,
              ...seedSections[0].lines.map(
                (seedLine): EditableInstance => ({
                  id: crypto.randomUUID(), isNew: true, lineId: targetLine.id, name: seedLine.name,
                  sourceLineIds: seedMatches[seedLine.id]?.sourceLineIds ?? [], projection: { method: 'flat' },
                }),
              ),
            ];
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workbook, selectedSchemaId]);

  function handleSchemaSelect(id: string) {
    if (id === selectedSchemaId) return;
    setPendingSchemaId(id);
  }

  function confirmSchemaChange() {
    if (pendingSchemaId) setSelectedSchemaId(pendingSchemaId);
    setPendingSchemaId(null);
  }

  // editableInstances shaped as LineInstance for evaluation purposes only (modelId/timestamps
  // are irrelevant here — this is a live preview, not what gets persisted).
  const previewInstances = useMemo(
    () =>
      editableInstances.map(
        (e): LineInstance => ({
          id: e.id, modelId: editing?.model.id ?? '', lineId: e.lineId, sectionId: e.sectionId,
          name: e.name, sourceLineIds: e.sourceLineIds, projection: e.projection, createdAt: '', updatedAt: '',
        }),
      ),
    [editableInstances, editing?.model.id],
  );

  // How many live-or-drafted sub-line instances currently roll up into each allowsSubLines line
  // — a non-zero count here means that line's direct mapping is superseded (see
  // MappingRowDetail's own doc comment).
  const instanceCountByLineId = useMemo(() => {
    const counts = new Map<string, number>();
    for (const instance of previewInstances) {
      if (instance.lineId === undefined) continue;
      counts.set(instance.lineId, (counts.get(instance.lineId) ?? 0) + 1);
    }
    return counts;
  }, [previewInstances]);

  const lineNameById = useMemo(
    () => new Map(statementSchema.sections.flatMap((s) => s.lines).map((l) => [l.id, l.name])),
    [statementSchema],
  );
  const schemaLineGroups: SchemaLineGroup[] = useMemo(
    () => statementSchema.sections.map((s) => ({ sectionName: s.name, lines: s.lines.map((l) => ({ id: l.id, name: l.name })) })),
    [statementSchema],
  );
  const nameIndex = useMemo(() => buildNameIndex(statementSchema), [statementSchema]);
  const allLines = useMemo(
    () => statementSchema.sections.flatMap((section) => section.lines.map((line) => ({ line, section }))),
    [statementSchema],
  );
  // Lines expected to carry a real mapped value — every non-calculated line, plus a
  // projection-carrying calculated line (still needs one for its actual periods). A purely
  // structural formula (no projection) never needs one, so it's excluded from this "must map"
  // count — it's mappable too (an issuer-reported subtotal can still be matched), just not
  // required to be.
  const mappableLines = useMemo(() => allLines.filter(({ line }) => !isCalculated(line) || line.projection), [allLines]);
  const mappedCount = mappableLines.filter(({ line }) => (mapping[line.id]?.sourceLineIds.length ?? 0) > 0).length;
  const blockers = mappableLines.filter(({ line }) => isMissingRequired(line, mapping[line.id]));
  const reviewLines = mappableLines.filter(({ line }) => needsReview(line, mapping[line.id]));

  const timeline = useMemo(() => (workbook ? buildTimeline(workbook.periods) : []), [workbook]);
  const historicals = useMemo(() => {
    if (!workbook) return {};
    // Every instance now carries its own sourceLineIds (existing or freshly added this session),
    // so resolveActuals alone covers every mapped instance; an unmapped one's historicals come
    // from manualHistoricals instead — no blanket "seed from the model's own historicals" fallback
    // needed for instances anymore (contrast the schema-line case just below, which still is).
    const mappedInstanceMappings: LineMapping[] = editableInstances
      .filter((e) => e.sourceLineIds.length > 0)
      .map((e) => ({ targetLineId: e.id, sourceLineIds: e.sourceLineIds, method: 'manual', confidence: 1, note: '', approved: true }));
    const manualInstanceHistoricals: Record<string, (number | null)[]> = {};
    for (const e of editableInstances) {
      if (e.sourceLineIds.length === 0) manualInstanceHistoricals[e.id] = timeline.map((_, i) => manualHistoricals[e.id]?.[i] ?? null);
    }
    return {
      ...resolveActuals([...Object.values(mapping), ...mappedInstanceMappings], workbook, timeline),
      ...manualInstanceHistoricals,
    };
  }, [mapping, editableInstances, manualHistoricals, workbook, timeline]);
  // Live preview of every calculated line, recomputed as the mapping changes — same evaluator
  // ModelWorkspaceScreen uses on the saved model, just fed this draft's not-yet-saved historicals
  // (including any not-yet-persisted sub-line/KPI instances, via previewInstances above).
  const evaluation = useMemo(
    () => applyDynamicInstances(statementSchema, { timeline, historicals }, previewInstances).evaluation,
    [statementSchema, timeline, historicals, previewInstances],
  );

  function updateMapping(targetLineId: string, patch: Partial<LineMapping>) {
    setMapping((prev) => ({ ...prev, [targetLineId]: { ...prev[targetLineId], ...patch } }));
  }

  function setSourceLines(target: StatementLine, sourceLineIds: string[]) {
    const previous = mapping[target.id];
    updateMapping(target.id, {
      sourceLineIds,
      method: sourceLineIds.length ? 'manual' : 'none',
      confidence: sourceLineIds.length ? 1 : 0,
      approved: false,
      note: sourceLineIds.length
        ? `Set manually. Previous: ${previous?.sourceLineIds.length ? previous.method : 'unmapped'}.`
        : 'Cleared manually.',
    });
  }

  function handleSaveClick() {
    if (blockers.length > 0) return;
    if (!editing && draft?.existingModel) {
      setReplaceConfirmOpen(true);
      return;
    }
    void handleSave();
  }

  async function handleSave() {
    if (!workbook) return;
    setReplaceConfirmOpen(false);
    setSaving(true);
    try {
      const resolvedTimeline = buildTimeline(workbook.periods);
      // Seeded from the live model's own historicals (when re-reviewing) so a save never wipes
      // an already-persisted instance's values — resolveActuals only ever produces entries for
      // this mapping's own SCHEMA target lines, never touching an instance id, so without this
      // seed a bare resolveActuals result would silently drop every pre-existing instance's data
      // the instant modelRepository.update() below replaces `historicals` wholesale.
      const resolvedHistoricals: Record<string, (number | null)[]> = {
        ...(editing?.model.historicals ?? {}),
        ...resolveActuals(Object.values(mapping), workbook, resolvedTimeline),
      };
      // resolveActuals omits an entry entirely for a mapping with no source lines, which would
      // otherwise leave a schema line's stale prior historicals in place after the user
      // explicitly clears its mapping — write an explicit null-per-period entry for those,
      // matching how the instance-historicals block below already handles the identical
      // "explicitly cleared" case.
      for (const m of Object.values(mapping)) {
        if (m.sourceLineIds.length === 0) resolvedHistoricals[m.targetLineId] = resolvedTimeline.map(() => null);
      }

      let savedModel: Model;
      if (editing) {
        await mappingRepository.save(editing.model.mappingId, Object.values(mapping));
        savedModel = await modelRepository.update(editing.model.id, {
          timeline: resolvedTimeline,
          historicals: resolvedHistoricals,
        });
      } else {
        const createdImport = await modelImportRepository.create({
          companyId: company.id,
          templateType: draft!.templateType,
          statementSchemaId: selectedSchemaId,
          file: draft!.file,
        });
        const createdMapping = await mappingRepository.create({
          modelImportId: createdImport.id,
          statementSchemaId: selectedSchemaId,
          lines: Object.values(mapping),
        });
        savedModel = await modelRepository.create({
          companyId: company.id,
          name: createdImport.fileName,
          statementSchemaId: selectedSchemaId,
          modelImportId: createdImport.id,
          mappingId: createdMapping.id,
          timeline: resolvedTimeline,
          historicals: resolvedHistoricals,
        });
      }

      // Reconcile instances against the repository — deferred the same way `mapping` itself
      // already is (nothing here writes until Save): delete anything the user removed, update
      // anything existing that changed, create anything new. A never-named new instance is
      // dropped silently rather than persisted as an untitled row.
      await Promise.all(deletedInstanceIds.map((id) => lineInstanceRepository.remove(id)));

      const idRemap = new Map<string, string>(); // new instance's temp id -> its real created id
      const persistedInstances: LineInstance[] = [];
      for (const e of editableInstances) {
        const trimmedName = e.name.trim();
        if (!trimmedName) continue;
        if (e.isNew) {
          const createdInstance = await lineInstanceRepository.create({
            modelId: savedModel.id, lineId: e.lineId, sectionId: e.sectionId,
            name: trimmedName, sourceLineIds: e.sourceLineIds, projection: e.projection,
          });
          idRemap.set(e.id, createdInstance.id);
          persistedInstances.push(createdInstance);
        } else {
          const updatedInstance = await lineInstanceRepository.update(e.id, {
            name: trimmedName, sourceLineIds: e.sourceLineIds, projection: e.projection,
          });
          persistedInstances.push(updatedInstance);
        }
      }

      // A sibling-instance basis picked during this session may reference another new
      // instance by its temp id, which only became a real id once that draft was persisted
      // above — fix up any such reference now that every real id is known.
      for (const instance of persistedInstances) {
        if (!('basisLineId' in instance.projection) || !instance.projection.basisLineId) continue;
        const remappedBasisLineId = idRemap.get(instance.projection.basisLineId);
        if (!remappedBasisLineId) continue;
        const fixedProjection = { ...instance.projection, basisLineId: remappedBasisLineId };
        await lineInstanceRepository.update(instance.id, { projection: fixedProjection });
        instance.projection = fixedProjection;
      }

      // Every surviving instance's historicals — resolved from its source mapping when it has
      // one, else whatever was typed in manually — written under its real (possibly just-remapped)
      // id, same convention the schema-line historicals above already follow.
      const mappedInstanceMappings: LineMapping[] = editableInstances
        .filter((e) => e.sourceLineIds.length > 0 && e.name.trim())
        .map((e) => ({
          targetLineId: idRemap.get(e.id) ?? e.id, sourceLineIds: e.sourceLineIds,
          method: 'manual' as const, confidence: 1, note: '', approved: true,
        }));
      const instanceHistoricals: Record<string, (number | null)[]> = resolveActuals(mappedInstanceMappings, workbook, resolvedTimeline);
      for (const e of editableInstances) {
        if (e.sourceLineIds.length > 0 || !e.name.trim()) continue;
        instanceHistoricals[idRemap.get(e.id) ?? e.id] = resolvedTimeline.map((_, i) => manualHistoricals[e.id]?.[i] ?? null);
      }

      savedModel = await modelRepository.update(savedModel.id, {
        historicals: { ...savedModel.historicals, ...instanceHistoricals },
      });

      // Compute and cache the Base case immediately — so the issuer page (which reads this
      // cache rather than re-running the engine itself) has real numbers right after a save,
      // not just after someone happens to open the workspace next.
      const { schema: savedInstancedSchema, evaluation: savedEvaluation } = applyDynamicInstances(statementSchema!, savedModel, persistedInstances);
      const materialized = materializeEvaluation(savedInstancedSchema, savedModel, savedEvaluation);
      const versionStamp = computeVersionStamp(savedModel, null, statementSchema!);
      await computedResultRepository.set(buildComputedResult(savedModel.id, 'base', versionStamp, materialized));

      setSavedToast(true);
      onSaved(savedModel);
    } finally {
      setSaving(false);
    }
  }

  if (parseError) {
    return (
      <Alert tone="negative" title="Couldn't read this file">
        {parseError}
        <div style={{ marginTop: 'var(--space-5)' }}>
          <Button size="sm" onClick={onCancel}>
            Back to financials
          </Button>
        </div>
      </Alert>
    );
  }

  if (!workbook) {
    return <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>Parsing {fileName}…</span>;
  }
  const wb = workbook;

  const query = search.trim().toLowerCase();
  function passes(line: StatementLine): boolean {
    if (onlyReview && !needsReview(line, mapping[line.id])) return false;
    if (query) {
      const sourceNames = (mapping[line.id]?.sourceLineIds ?? [])
        .map((id) => wb.lines.find((source) => source.id === id)?.name ?? '')
        .join(' ');
      if (!`${line.name} ${sourceNames}`.toLowerCase().includes(query)) return false;
    }
    return true;
  }

  const rows: Array<{
    id: string; __group?: string; line?: StatementLine; sectionName?: string;
    addInstanceTarget?: InstanceTarget; instance?: EditableInstance;
  }> = [];
  statementSchema.sections.forEach((section) => {
    if (tab !== 'all' && tab !== section.id) return;
    const visible = section.lines.filter(passes);
    if (!visible.length && !section.allowsFreeformLines) return;
    rows.push({ id: `group-${section.id}`, __group: section.name });
    visible.forEach((line) => {
      rows.push({ id: line.id, line, sectionName: section.name });
      if (line.allowsSubLines) {
        editableInstances
          .filter((e) => e.lineId === line.id)
          .forEach((instance) => rows.push({ id: `instance-${instance.id}`, instance, sectionName: section.name }));
        rows.push({ id: `add-line-${line.id}`, addInstanceTarget: { id: line.id, name: line.name, kind: 'line' }, sectionName: section.name });
      }
    });
    if (section.allowsFreeformLines) {
      editableInstances
        .filter((e) => e.sectionId === section.id)
        .forEach((instance) => rows.push({ id: `instance-${instance.id}`, instance, sectionName: section.name }));
      rows.push({ id: `add-section-${section.id}`, addInstanceTarget: { id: section.id, name: section.name, kind: 'section' }, sectionName: section.name });
    }
  });

  const columns = [
    {
      key: 'expand',
      label: '',
      width: 24,
      render: (_: unknown, row: { id: string; line?: StatementLine; instance?: EditableInstance }) =>
        row.line || row.instance ? (
          <Icon name={expandedLineId === row.id ? 'chevron-down' : 'chevron-right'} size={12} color="var(--text-tertiary)" />
        ) : null,
    },
    {
      key: 'target',
      label: 'Target line',
      width: 220,
      render: (_: unknown, row: { line?: StatementLine; addInstanceTarget?: InstanceTarget; instance?: EditableInstance }) => {
        if (row.addInstanceTarget) {
          return (
            <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-medium)', color: 'var(--text-brand)' }}>
              <Icon name="plus" size={12} color="var(--text-brand)" />
              Add {row.addInstanceTarget.kind === 'section' ? 'KPI' : 'sub-line'}
            </span>
          );
        }
        if (row.instance) {
          const name = row.instance.name.trim();
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', paddingLeft: 'var(--space-7)' }}>
              <Icon name="corner-down-right" size={11} color="var(--text-tertiary)" />
              <span style={{ fontSize: 'var(--text-sm)', color: name ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>
                {name || 'Untitled — click to name'}
              </span>
            </div>
          );
        }
        if (!row.line) return null;
        const m = mapping[row.line.id];
        const instanceCount = instanceCountByLineId.get(row.line.id);
        const missing = !instanceCount && isMissingRequired(row.line, m);
        const low = !instanceCount && isLowConfidence(m);
        const dot = missing ? 'var(--red-600)' : low ? 'var(--violet-600)' : null;
        const rowLineStyle = getLineRowStyle(row.line);
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', minWidth: 0 }}>
            <span
              title={missing ? 'Missing required line' : low ? 'Low confidence match' : undefined}
              style={{ width: 6, height: 6, borderRadius: '50%', flex: '0 0 auto', background: dot ?? 'transparent' }}
            />
            <span
              style={{
                fontSize: 'var(--text-sm)', whiteSpace: 'nowrap', fontWeight: 'var(--weight-medium)',
                color: instanceCount ? 'var(--text-tertiary)' : 'var(--text-primary)', ...rowLineStyle, background: undefined, borderTop: undefined,
              }}
            >
              {row.line.name}
            </span>
            {instanceCount ? (
              <span title={`Superseded by ${instanceCount} sub-line instance${instanceCount > 1 ? 's' : ''} — direct mapping disabled`}>
                <Icon name="git-branch" size={11} color="var(--text-tertiary)" />
              </span>
            ) : isCalculated(row.line) && !row.line.projection ? (
              <span title={`Formula: ${formatFormula(row.line.formula, nameIndex)}`}>
                <Icon name="function-square" size={11} color="var(--text-tertiary)" />
              </span>
            ) : null}
          </div>
        );
      },
    },
    {
      key: 'source',
      label: 'Source line',
      width: 280,
      render: (_: unknown, row: { line?: StatementLine; instance?: EditableInstance }) => {
        if (row.instance) {
          if (row.instance.sourceLineIds.length === 0) {
            return <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>Manual entry</span>;
          }
          const summary = row.instance.sourceLineIds.map((id) => workbook.lines.find((l) => l.id === id)?.name).join('  +  ');
          return <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-body)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{summary}</span>;
        }
        if (!row.line) return null;
        const m = mapping[row.line.id];
        const empty = !m || m.sourceLineIds.length === 0;
        // A structural formula (no projection) is never expected to be mapped — an empty cell
        // for it is a non-event, not worth a "Not mapped" label competing for attention with a
        // genuinely missing line.
        const expectsMapping = !isCalculated(row.line) || Boolean(row.line.projection);
        if (empty && !expectsMapping) return null;
        const summary = empty ? 'Not mapped' : m.sourceLineIds.map((id) => workbook.lines.find((source) => source.id === id)?.name).join('  +  ');
        return (
          <span
            style={{
              fontSize: 'var(--text-xs)',
              color: empty ? 'var(--text-caution)' : 'var(--text-body)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}
          >
            {summary}
            {m && m.sourceLineIds.length > 1 ? (
              <span style={{ marginLeft: 'var(--space-3)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-3xs)', color: 'var(--text-tertiary)' }}>
                {m.sourceLineIds.length} lines
              </span>
            ) : null}
          </span>
        );
      },
    },
    {
      key: 'status',
      label: 'Status',
      width: 110,
      render: (_: unknown, row: { line?: StatementLine }) => {
        if (!row.line) return null;
        const meta = getRequiredMeta(row.line);
        return (
          <Badge tone={meta.tone} size="sm">
            {meta.label}
          </Badge>
        );
      },
    },
    {
      key: 'match',
      label: 'Match',
      width: 130,
      render: (_: unknown, row: { line?: StatementLine }) => {
        if (!row.line) return null;
        const m = mapping[row.line.id];
        // No real match, and this line never needed one — a structural formula's fallback, not
        // a genuinely unmapped line, so blank rather than the caution "Unmapped" badge.
        const expectsMapping = !isCalculated(row.line) || Boolean(row.line.projection);
        if ((!m || m.method === 'none') && !expectsMapping) return null;
        if (!m) return null;
        const meta = MATCH_METHOD_META[m.method];
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <Badge tone={meta.tone} size="sm" icon={meta.icon}>
              {meta.label}
            </Badge>
            {m.method !== 'none' && m.method !== 'manual' ? (
              <span style={{ fontSize: 'var(--text-3xs)', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'var(--numeric-tabular)', color: isLowConfidence(m) ? 'var(--text-caution)' : 'var(--text-tertiary)' }}>
                {m.confidence.toFixed(2)}
              </span>
            ) : null}
          </div>
        );
      },
    },
    ...workbook.periods.map((period, i) => ({
      key: `p${i}`,
      label: period.name,
      numeric: true,
      width: 96,
      render: (_: unknown, row: { line?: StatementLine; instance?: EditableInstance }) => {
        const targetId = row.line?.id ?? row.instance?.id;
        if (!targetId) return null;
        const error = evaluation.getError(targetId);
        if (error) {
          return (
            <span title={error} style={{ display: 'inline-flex', justifyContent: 'flex-end', width: '100%' }}>
              <Icon name="alert-triangle" size={12} color="var(--text-negative)" />
            </span>
          );
        }
        // evaluation already applies the mapped-value-wins-else-formula priority uniformly, so
        // this is correct for every line — status/badge columns already say whether a line is
        // calculated or mapped, so the value itself doesn't need a second, redundant color cue.
        const value = evaluation.getValue(targetId, i);
        return (
          <span
            style={{
              fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', fontVariantNumeric: 'var(--numeric-tabular)',
              color: value === null ? 'var(--text-disabled)' : 'var(--text-body)',
            }}
          >
            {formatPeriodValue(value, row.line?.numberFormat)}
          </span>
        );
      },
    })),
  ];

  const tabs = [
    { value: 'all', label: 'All' },
    ...statementSchema.sections.map((section) => {
      const issues = section.lines.filter((line) => needsReview(line, mapping[line.id])).length;
      return { value: section.id, label: section.name, count: issues > 0 ? issues : undefined };
    }),
  ];

  const statusText = blockers.length
    ? `${blockers.length} required line${blockers.length > 1 ? 's' : ''} unmapped: ${blockers.map((b) => b.line.name).join(', ')}`
    : reviewLines.length
      ? `${reviewLines.length} line${reviewLines.length > 1 ? 's' : ''} need review`
      : `All target lines mapped and above threshold. Ready to save ${workbook.periods.length} periods.`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-8)', flexWrap: 'wrap' }}>
        <ol style={{ listStyle: 'none', display: 'flex', alignItems: 'center', gap: 0, margin: 0, padding: 0 }}>
          {STEPS.map((label, i) => {
            const stepNum = i + 1;
            const state = stepNum < 2 ? 'done' : stepNum === 2 ? 'current' : 'upcoming';
            return (
              <li key={label} style={{ display: 'flex', alignItems: 'center' }}>
                {i > 0 ? <span style={{ width: 28, height: 1, background: 'var(--border-default)', margin: '0 var(--space-5)' }} /> : null}
                <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', opacity: state === 'upcoming' ? 0.55 : 1 }}>
                  <span
                    style={{
                      width: 18, height: 18, flex: '0 0 auto', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontFamily: 'var(--font-mono)', fontSize: 'var(--text-3xs)', fontWeight: 'var(--weight-semibold)',
                      background: state === 'done' ? 'var(--status-positive-bg)' : state === 'current' ? 'var(--action-primary-bg)' : 'var(--surface-sunken)',
                      color: state === 'done' ? 'var(--status-positive-fg)' : state === 'current' ? 'var(--action-primary-fg)' : 'var(--text-secondary)',
                    }}
                  >
                    {stepNum}
                  </span>
                  <span style={{ fontSize: 'var(--text-xs)', fontWeight: state === 'current' ? 'var(--weight-semibold)' : 'var(--weight-medium)', color: state === 'current' ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                    {label}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>

        <div style={{ display: 'flex', alignItems: 'stretch', gap: 'var(--space-4)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', padding: 'var(--space-3) var(--space-5)', background: 'var(--surface-card)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)' }}>
            <Icon name="layout-template" size={16} color="var(--text-brand)" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 'var(--text-3xs)', fontWeight: 'var(--weight-semibold)', letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
                Statement schema
              </span>
              {editing ? (
                <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-medium)', color: 'var(--text-primary)' }}>{statementSchema.name}</span>
              ) : (
                <Select
                  size="sm"
                  options={schemas.map((s) => ({ value: s.id, label: s.name }))}
                  value={selectedSchemaId}
                  onChange={(e) => handleSchemaSelect(e.target.value)}
                  disabled={saving}
                  style={{ width: 180 }}
                />
              )}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', padding: 'var(--space-3) var(--space-5)', background: 'var(--surface-card)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)' }}>
            <Icon name="file-spreadsheet" size={16} color="var(--text-brand)" />
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-medium)', color: 'var(--text-primary)' }}>{fileName}</span>
              <span style={{ fontSize: 'var(--text-3xs)', fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)' }}>
                {workbook.periods.length} periods · {workbook.lines.length} lines
              </span>
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 'var(--space-6)' }}>
        <Card padding="sm">
          <MetricRow label="Lines imported" value={String(workbook.lines.length)} icon="table-2" onDrill={() => setImportedLinesOpen(true)} />
        </Card>
        <Card padding="sm">
          <MetricRow
            label="Mapped"
            value={`${mappedCount} / ${mappableLines.length}`}
            icon="git-merge"
            onDrill={() => setMappedLinesOpen(true)}
          />
        </Card>
        <Card padding="sm">
          <MetricRow
            label="Issues flagged"
            value={String(reviewLines.length)}
            icon="alert-triangle"
            tone={reviewLines.length ? 'caution' : undefined}
            onDrill={reviewLines.length ? () => setOnlyReview(true) : undefined}
          />
        </Card>
      </div>

      {blockers.length > 0 || reviewLines.length > 0 ? (
        <Alert tone="caution" compact>
          {statusText}
        </Alert>
      ) : null}

      <Tabs
        tabs={tabs}
        value={tab}
        onChange={setTab}
        size="sm"
        actions={
          <>
            <Input size="sm" iconLeft="search" placeholder="Find target or source line" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 220 }} />
            <Button size="sm" iconLeft="filter" selected={onlyReview} onClick={() => setOnlyReview(!onlyReview)}>
              Needs review · {reviewLines.length}
            </Button>
          </>
        }
      />

      <Card padding="none" icon="git-merge" title="Line item mapping">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey="id"
          rowStyle={(row: { line?: StatementLine }) => (row.line ? getLineRowStyle(row.line) : {})}
          dense
          stickyHeader
          maxHeight="calc(100vh - 420px)"
          expandedKey={expandedLineId}
          onRowClick={(row) => {
            if (row.addInstanceTarget) {
              const target: InstanceTarget = row.addInstanceTarget;
              const newId = crypto.randomUUID();
              setEditableInstances((prev) => [
                ...prev,
                {
                  id: newId, isNew: true,
                  lineId: target.kind === 'line' ? target.id : undefined,
                  sectionId: target.kind === 'section' ? target.id : undefined,
                  name: '', sourceLineIds: [], projection: { method: 'flat' },
                },
              ]);
              setExpandedLineId(`instance-${newId}`);
              return;
            }
            if (row.line || row.instance) setExpandedLineId(expandedLineId === row.id ? null : row.id);
          }}
          renderDetail={(row: { id: string; line?: StatementLine; sectionName?: string; instance?: EditableInstance }) =>
            row.instance ? (
              <InstanceRowDetail
                instance={row.instance}
                sectionName={row.sectionName ?? ''}
                workbook={workbook}
                manualValues={manualHistoricals[row.instance.id] ?? []}
                schemaLineGroups={schemaLineGroups}
                allInstances={previewInstances}
                lineNameById={lineNameById}
                onChangeName={(name) =>
                  setEditableInstances((prev) => prev.map((e) => (e.id === row.instance!.id ? { ...e, name } : e)))
                }
                onChangeSourceLines={(sourceLineIds) =>
                  setEditableInstances((prev) => prev.map((e) => (e.id === row.instance!.id ? { ...e, sourceLineIds } : e)))
                }
                onChangeProjection={(selection: InstanceProjectionSelection) => {
                  const projection: LineInstance['projection'] =
                    selection.method === 'flat'
                      ? { method: 'flat' }
                      : selection.method === 'growth'
                        ? { method: 'growth', driverId: crypto.randomUUID() }
                        : { method: selection.method, driverId: crypto.randomUUID(), basisLineId: selection.basisLineId };
                  setEditableInstances((prev) => prev.map((e) => (e.id === row.instance!.id ? { ...e, projection } : e)));
                }}
                onChangeManualValue={(periodIndex, value) =>
                  setManualHistoricals((prev) => {
                    const arr = [...(prev[row.instance!.id] ?? [])];
                    while (arr.length <= periodIndex) arr.push(null);
                    arr[periodIndex] = value;
                    return { ...prev, [row.instance!.id]: arr };
                  })
                }
                onDelete={() => {
                  const deletedId = row.instance!.id;
                  // A sibling whose basis is the instance being deleted would otherwise be left
                  // with a dangling basisLineId (silently resolving to null forever) — fall it
                  // back to 'flat' instead so deleting one instance never silently breaks another.
                  setEditableInstances((prev) =>
                    prev
                      .filter((e) => e.id !== deletedId)
                      .map((e) =>
                        'basisLineId' in e.projection && e.projection.basisLineId === deletedId
                          ? { ...e, projection: { method: 'flat' } }
                          : e,
                      ),
                  );
                  if (!row.instance!.isNew) setDeletedInstanceIds((prev) => [...prev, deletedId]);
                  setExpandedLineId(null);
                }}
              />
            ) : row.line ? (
              <MappingRowDetail
                target={row.line}
                sectionName={row.sectionName ?? ''}
                mapping={mapping[row.line.id]}
                workbook={workbook}
                onSetSourceLines={(ids) => setSourceLines(row.line as StatementLine, ids)}
                onApprove={() => updateMapping((row.line as StatementLine).id, { approved: true })}
                supersededByInstanceCount={instanceCountByLineId.get(row.line.id)}
              />
            ) : null
          }
        />
      </Card>

      <div style={{ position: 'sticky', bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-8)', padding: 'var(--space-5) 0', background: 'var(--surface-app)', borderTop: '1px solid var(--border-default)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', minWidth: 0 }}>
          <Icon name={blockers.length ? 'alert-triangle' : reviewLines.length ? 'info' : 'check-circle-2'} size={14} color={blockers.length ? 'var(--text-caution)' : reviewLines.length ? 'var(--text-secondary)' : 'var(--text-positive)'} />
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>{statusText}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
          <Button onClick={() => setCancelConfirmOpen(true)}>Cancel import</Button>
          <Button variant="primary" iconLeft="check" disabled={blockers.length > 0} loading={saving} onClick={handleSaveClick}>
            Save mapping
          </Button>
        </div>
      </div>

      <ImportedLinesDialog open={importedLinesOpen} workbook={workbook} onClose={() => setImportedLinesOpen(false)} />
      <MappedLinesDialog open={mappedLinesOpen} statementSchema={statementSchema} mapping={mapping} onClose={() => setMappedLinesOpen(false)} />

      <Dialog
        open={pendingSchemaId !== null}
        onClose={() => setPendingSchemaId(null)}
        icon="alert-triangle"
        title="Change statement schema?"
        subtitle={company.name}
        footer={
          <>
            <Button onClick={() => setPendingSchemaId(null)}>Keep current schema</Button>
            <Button variant="danger" iconLeft="refresh-cw" onClick={confirmSchemaChange}>
              Change schema
            </Button>
          </>
        }
      >
        <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--text-body)' }}>
          Every line will be re-matched against the new schema's structure. Any manual corrections made to the current mapping will be lost.
        </p>
      </Dialog>

      <Dialog
        open={replaceConfirmOpen}
        onClose={() => setReplaceConfirmOpen(false)}
        icon="alert-triangle"
        title="Replace the current model?"
        subtitle={company.name}
        footer={
          <>
            <Button onClick={() => setReplaceConfirmOpen(false)}>Keep current model</Button>
            <Button variant="danger" iconLeft="refresh-cw" loading={saving} onClick={() => void handleSave()}>
              Replace model
            </Button>
          </>
        }
      >
        <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--text-body)' }}>
          This company already has a current model. Saving replaces it — it won't be recoverable afterward. Durable
          model history arrives with Snapshots in a later phase.
        </p>
      </Dialog>

      <Dialog
        open={cancelConfirmOpen}
        onClose={() => setCancelConfirmOpen(false)}
        icon="alert-triangle"
        title="Discard this import?"
        subtitle={company.name}
        footer={
          <>
            <Button onClick={() => setCancelConfirmOpen(false)}>Keep editing</Button>
            <Button variant="danger" iconLeft="trash-2" onClick={onCancel}>
              Discard import
            </Button>
          </>
        }
      >
        <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--text-body)' }}>
          The parsed file and any mapping changes will be discarded. Nothing is written until you save.
        </p>
      </Dialog>

      {savedToast ? (
        <div style={{ position: 'fixed', right: 'var(--space-8)', bottom: 'var(--space-8)', zIndex: 200 }}>
          <Toast tone="positive" title="Import saved" onDismiss={() => setSavedToast(false)}>
            {mappedCount} mapped lines · {workbook.periods.length} periods saved to {company.name}
          </Toast>
        </div>
      ) : null}
    </div>
  );
}

function MetricRow({ label, value, icon, tone, onDrill }: { label: string; value: string; icon: string; tone?: 'caution'; onDrill?: () => void }) {
  return (
    <div
      role={onDrill ? 'button' : undefined}
      tabIndex={onDrill ? 0 : undefined}
      onClick={onDrill}
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: onDrill ? 'pointer' : 'default' }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <span style={{ fontSize: 'var(--text-2xs)', fontWeight: 'var(--weight-semibold)', letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
          {label}
        </span>
        <span style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--weight-semibold)', color: tone === 'caution' ? 'var(--text-caution)' : 'var(--text-primary)' }}>
          {value}
        </span>
      </div>
      <Icon name={icon} size={18} color={tone === 'caution' ? 'var(--text-caution)' : 'var(--text-tertiary)'} />
    </div>
  );
}
