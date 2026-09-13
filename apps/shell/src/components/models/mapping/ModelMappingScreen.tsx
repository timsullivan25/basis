import { useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, Card, DataTable, Dialog, Icon, Input, Select, Tabs, Toast } from '@basis/design-system';
import {
  computedResultRepository,
  mappingRepository,
  modelImportRepository,
  modelRepository,
  statementSchemaRepository,
  type Company,
  type DebtTrancheProperties,
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
import { evaluateModel } from '../../../lib/engine/evaluate';
import { cloneStatementSchemaStructure } from '../../../lib/statementSchemaClone';
import { addChildLine, childrenOf, effectiveLineKind, removeChildLine, setChildProjection, type ChildProjectionSelection } from '../../../lib/statementLineChildren';
import { findSchemaDependents, hasSchemaDependents, type SchemaLineDependents } from '../../../lib/lineDependents';
import { getLineRowStyle, getRequiredMeta } from '../../statements/statementFormatting';
import type { InstanceTarget, SchemaLineGroup } from '../instances/projectionMethod';
import { InstanceRowDetail } from './InstanceRowDetail';
import { ImportedLinesDialog } from './ImportedLinesDialog';
import { MappedLinesDialog } from './MappedLinesDialog';
import { MappingRowDetail } from './MappingRowDetail';
import { formatPeriodValue, isLowConfidence, isMissingRequired, needsReview, MATCH_METHOD_META } from './mappingFormatting';

const STEPS = ['Upload model', 'Map line items', 'Save'];

/** A blank mapping entry for a freshly-created child line — same shape matchStatementLines
 *  would produce for an unmatched ordinary line, so a child is indistinguishable from any other
 *  line the moment it exists. */
function blankMapping(lineId: string): LineMapping {
  return { targetLineId: lineId, sourceLineIds: [], method: 'none', confidence: 0, note: '', approved: false };
}

export interface ModelMappingScreenProps {
  company: Company;
  /** Every TEMPLATE available to start a new model from (never a model's own private fork —
   *  see statementSchemaRepository.list()'s own doc comment). Unused when `editing`. */
  schemas: StatementSchema[];
  /** Re-reviewing an already-saved model's existing file — Save updates its mapping/schema in place. */
  editing?: { model: Model; modelImport: ModelImport };
  /** A freshly-picked, not-yet-saved file — Save creates a new model (template choice editable until saved). */
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

  // Which TEMPLATE a new model forks from — irrelevant once editing (a model never switches
  // schemas after creation). Freely editable until saved (with a reset warning — see
  // handleSchemaSelect), since changing it means re-forking and re-matching from scratch.
  const [selectedTemplateId, setSelectedTemplateId] = useState(() => schemas[0]?.id ?? '');
  const [pendingTemplateId, setPendingTemplateId] = useState<string | null>(null);

  // The model's own schema, held as a draft until Save. For a new model this is an in-memory
  // fork of the chosen template (real, final ids from the moment it's created — see
  // cloneStatementSchemaStructure's own doc comment on why no id-remapping is ever needed later);
  // for `editing`, a deep clone of the model's own already-private schema. Every child line
  // (segment, EBITDA adjustment, KPI, debt tranche) is just an ordinary StatementLine living
  // directly in here, with a parentLineId — see lib/statementLineChildren.ts. Nothing is
  // persisted until Save, same convention `mapping` below already follows.
  const [draftSchema, setDraftSchema] = useState<StatementSchema | null>(null);

  const [workbook, setWorkbook] = useState<ParsedWorkbook | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [mapping, setMapping] = useState<Record<string, LineMapping>>({});
  // Per-line typed-in historicals for a line with no source-file mapping (empty sourceLineIds) —
  // the one-time-adjustment / capital-structure-tranche-with-no-matching-workbook-row case. Kept
  // separate from `mapping` since it's a data override, not a structural mapping decision; only
  // ever applied for a line that's still actually unmapped at Save time.
  const [manualHistoricals, setManualHistoricals] = useState<Record<string, (number | null)[]>>({});
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
  // Held between "delete clicked" on a child line and the user confirming/cancelling, only when
  // something else in the schema actually depends on it — see requestDeleteChild's own comment.
  const [pendingLineRemoval, setPendingLineRemoval] = useState<{ lineId: string; dependents: SchemaLineDependents } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const parsed = await parseBasisTemplate(file);
        if (!cancelled) setWorkbook(parsed);
      } catch (err) {
        if (!cancelled) setParseError(err instanceof TemplateParseError ? err.message : 'Could not parse the uploaded file.');
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.modelImport.id, draft?.file]);

  // Forks/loads the draft schema, then matches against it. Re-runs whenever the workbook finishes
  // parsing or (for a new model only) the chosen template changes — a template switch discards
  // whatever draft schema/mapping/children existed and starts clean from the new template.
  useEffect(() => {
    if (!workbook) return;
    let cancelled = false;
    (async () => {
      if (editing) {
        const ownSchema = await statementSchemaRepository.get(editing.model.statementSchemaId);
        if (cancelled || !ownSchema) return;
        const clonedDraft = structuredClone(ownSchema);
        setDraftSchema(clonedDraft);

        const savedMapping = await mappingRepository.get(editing.model.mappingId);
        if (cancelled) return;
        // A saved mapping can predate a line that's since become mappable (or just been added) —
        // back those in with a fresh match rather than leaving them undefined, which
        // MappingRowDetail (a required, non-optional prop) would otherwise crash on.
        const fresh = matchStatementLines(clonedDraft.sections, workbook.lines);
        const saved = savedMapping ? Object.fromEntries(savedMapping.lines.map((m) => [m.targetLineId, m])) : {};
        const merged = { ...fresh, ...saved };
        setMapping(merged);

        const manual: Record<string, (number | null)[]> = {};
        for (const line of clonedDraft.sections.flatMap((s) => s.lines)) {
          const m = merged[line.id];
          if ((m?.sourceLineIds.length ?? 0) === 0 && editing.model.historicals[line.id]?.some((v) => v !== null)) {
            manual[line.id] = editing.model.historicals[line.id];
          }
        }
        setManualHistoricals(manual);
        return;
      }

      const template = schemas.find((s) => s.id === selectedTemplateId);
      if (!template) return;
      const { schema: forked } = cloneStatementSchemaStructure(template, crypto.randomUUID(), company.name);
      if (cancelled) return;
      setDraftSchema(forked);
      setManualHistoricals({});

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
      if (cancelled) return;
      setMapping(matchStatementLines(forked.sections, workbook.lines, hints));

      // A brand-new model built on the unmodified default template gets a few common EBITDA
      // adjustments seeded automatically as real child lines, each trying to auto-match the
      // uploaded file exactly like any other line's aliases would — the "upload and it just
      // works" case, with zero effect on a re-review or a custom/duplicated schema.
      if (selectedTemplateId === DEFAULT_SCHEMA_ID) {
        const targetLine = forked.sections.flatMap((s) => s.lines).find((l) => l.name === DEFAULT_ADJUSTMENT_TARGET_LINE_NAME);
        if (targetLine) {
          let seeded = forked;
          const seedMappings: Record<string, LineMapping> = {};
          for (const seed of DEFAULT_ADJUSTMENT_INSTANCE_SEEDS) {
            const { schema: withSeed, lineId } = addChildLine(seeded, { kind: 'line', parentLineId: targetLine.id }, seed.name);
            seeded = patchLine(withSeed, lineId, { aliases: seed.aliases });
            const newLine = seeded.sections.flatMap((s) => s.lines).find((l) => l.id === lineId)!;
            const matched = matchStatementLines([{ id: 'seed', name: targetLine.name, lines: [newLine] }], workbook.lines)[lineId];
            seedMappings[lineId] = matched?.sourceLineIds.length ? matched : blankMapping(lineId);
          }
          if (!cancelled) {
            setDraftSchema(seeded);
            setMapping((prev) => ({ ...prev, ...seedMappings }));
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workbook, selectedTemplateId, editing?.modelImport.id]);

  function handleSchemaSelect(id: string) {
    if (id === selectedTemplateId) return;
    setPendingTemplateId(id);
  }

  function confirmSchemaChange() {
    if (pendingTemplateId) setSelectedTemplateId(pendingTemplateId);
    setPendingTemplateId(null);
  }

  const schema = draftSchema;

  const nameIndex = useMemo(() => (schema ? buildNameIndex(schema) : buildNameIndex({ sections: [], drivers: [] })), [schema]);
  const schemaLineGroups: SchemaLineGroup[] = useMemo(
    () => (schema ? schema.sections.map((s) => ({ sectionName: s.name, lines: s.lines.map((l) => ({ id: l.id, name: l.name })) })) : []),
    [schema],
  );
  const allLines = useMemo(() => (schema ? schema.sections.flatMap((section) => section.lines.map((line) => ({ line, section }))) : []), [schema]);
  // Lines expected to carry a real mapped value — every non-calculated line, plus a
  // projection-carrying calculated line (still needs one for its actual periods). A purely
  // structural formula (no projection) never needs one — it's mappable too (an issuer-reported
  // subtotal can still be matched), just not required to be.
  const mappableLines = useMemo(() => allLines.filter(({ line }) => !isCalculated(line) || line.projection), [allLines]);
  const mappedCount = mappableLines.filter(({ line }) => (mapping[line.id]?.sourceLineIds.length ?? 0) > 0).length;
  const blockers = mappableLines.filter(({ line }) => isMissingRequired(line, mapping[line.id]));
  const reviewLines = mappableLines.filter(({ line }) => needsReview(line, mapping[line.id]));

  const timeline = useMemo(() => (workbook ? buildTimeline(workbook.periods) : []), [workbook]);
  const historicals = useMemo(() => {
    if (!workbook) return {};
    const resolved = resolveActuals(Object.values(mapping), workbook, timeline);
    for (const [lineId, values] of Object.entries(manualHistoricals)) {
      if ((mapping[lineId]?.sourceLineIds.length ?? 0) === 0 && values.some((v) => v !== null)) resolved[lineId] = values;
    }
    return resolved;
  }, [mapping, manualHistoricals, workbook, timeline]);
  // Live preview of every calculated line, recomputed as the mapping/schema changes — one plain
  // evaluation, since every child line is already a real, evaluable line in `schema` (no more
  // separate splice-and-rollup pass).
  const evaluation = useMemo(() => (schema ? evaluateModel(schema, { timeline, historicals }) : null), [schema, timeline, historicals]);

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

  function requestAddChild(target: InstanceTarget) {
    if (!schema) return;
    const { schema: next, lineId } = addChildLine(
      schema,
      target.kind === 'line' ? { kind: 'line', parentLineId: target.id } : { kind: 'section', sectionId: target.id },
      '',
    );
    setDraftSchema(next);
    setMapping((prev) => ({ ...prev, [lineId]: blankMapping(lineId) }));
    setExpandedLineId(`child-${lineId}`);
  }

  /** Deletes immediately when nothing else in the schema depends on this child, otherwise holds
   *  the delete and opens a confirm dialog naming what does — same split
   *  StatementDefinitionsScreen's requestLineRemoval/commitLineRemoval already use for an
   *  ordinary line, reused as-is since a child is just an ordinary line now. */
  function requestDeleteChild(lineId: string) {
    if (!schema) return;
    const dependents = findSchemaDependents(schema, new Set([lineId]));
    if (hasSchemaDependents(dependents)) {
      setPendingLineRemoval({ lineId, dependents });
    } else {
      commitDeleteChild(lineId);
    }
  }

  function commitDeleteChild(lineId: string) {
    setDraftSchema((prev) => (prev ? removeChildLine(prev, lineId) : prev));
    setMapping((prev) => {
      const next = { ...prev };
      delete next[lineId];
      return next;
    });
    setManualHistoricals((prev) => {
      const next = { ...prev };
      delete next[lineId];
      return next;
    });
    setExpandedLineId(null);
  }

  function confirmPendingLineRemoval() {
    if (!pendingLineRemoval) return;
    commitDeleteChild(pendingLineRemoval.lineId);
    setPendingLineRemoval(null);
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
    if (!workbook || !schema) return;
    setReplaceConfirmOpen(false);
    setSaving(true);
    try {
      const resolvedTimeline = buildTimeline(workbook.periods);
      const resolvedHistoricals: Record<string, (number | null)[]> = {
        ...(editing?.model.historicals ?? {}),
        ...resolveActuals(Object.values(mapping), workbook, resolvedTimeline),
      };
      // resolveActuals omits an entry entirely for a mapping with no source lines, which would
      // otherwise leave a line's stale prior historicals in place after the user explicitly
      // clears its mapping — write an explicit null-per-period entry for those, unless a manual
      // override applies instead (checked next).
      for (const m of Object.values(mapping)) {
        if (m.sourceLineIds.length === 0) resolvedHistoricals[m.targetLineId] = resolvedTimeline.map(() => null);
      }
      for (const [lineId, values] of Object.entries(manualHistoricals)) {
        if ((mapping[lineId]?.sourceLineIds.length ?? 0) === 0 && values.some((v) => v !== null)) resolvedHistoricals[lineId] = values;
      }

      const savedSchema = await statementSchemaRepository.save(schema);

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
          statementSchemaId: savedSchema.id,
          file: draft!.file,
        });
        const createdMapping = await mappingRepository.create({
          modelImportId: createdImport.id,
          statementSchemaId: savedSchema.id,
          lines: Object.values(mapping),
        });
        savedModel = await modelRepository.create({
          companyId: company.id,
          name: createdImport.fileName,
          statementSchemaId: savedSchema.id,
          modelImportId: createdImport.id,
          mappingId: createdMapping.id,
          timeline: resolvedTimeline,
          historicals: resolvedHistoricals,
        });
      }

      // Compute and cache the Base case immediately — so the issuer page (which reads this
      // cache rather than re-running the engine itself) has real numbers right after a save, not
      // just after someone happens to open the workspace next.
      const savedEvaluation = evaluateModel(savedSchema, savedModel);
      const materialized = materializeEvaluation(savedSchema, savedModel, savedEvaluation);
      const versionStamp = computeVersionStamp(savedModel, null, savedSchema);
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

  if (!file) {
    // unreachable (guarded above) — keeps TS happy about `file` below.
    return null;
  }
  if (!workbook || !schema || !evaluation) {
    return <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>Parsing {fileName}…</span>;
  }
  const wb = workbook;
  const liveEvaluation = evaluation;

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
    addInstanceTarget?: InstanceTarget; childLine?: StatementLine; isKpi?: boolean;
  }> = [];
  schema.sections.forEach((section) => {
    if (tab !== 'all' && tab !== section.id) return;

    if (section.allowsFreeformLines) {
      // Every line in a freeform section IS a KPI child (added via "+ Add KPI") — there's no
      // "ordinary" line here at all, unlike a ordinary section's top-level lines.
      rows.push({ id: `group-${section.id}`, __group: section.name });
      section.lines.filter(passes).forEach((child) => rows.push({ id: `child-${child.id}`, childLine: child, sectionName: section.name, isKpi: true }));
      rows.push({ id: `add-section-${section.id}`, addInstanceTarget: { id: section.id, name: section.name, kind: 'section' }, sectionName: section.name });
      return;
    }

    const topLevelLines = section.lines.filter((l) => !l.parentLineId);
    const visible = topLevelLines.filter(passes);
    if (!visible.length) return;
    rows.push({ id: `group-${section.id}`, __group: section.name });
    visible.forEach((line) => {
      rows.push({ id: line.id, line, sectionName: section.name });
      if (line.allowsSubLines) {
        childrenOf(schema, line.id).forEach((child) => rows.push({ id: `child-${child.id}`, childLine: child, sectionName: section.name, isKpi: false }));
        rows.push({ id: `add-line-${line.id}`, addInstanceTarget: { id: line.id, name: line.name, kind: 'line' }, sectionName: section.name });
      }
    });
  });

  const columns = [
    {
      key: 'expand',
      label: '',
      width: 24,
      render: (_: unknown, row: { id: string; line?: StatementLine; childLine?: StatementLine }) =>
        row.line || row.childLine ? (
          <Icon name={expandedLineId === row.id ? 'chevron-down' : 'chevron-right'} size={12} color="var(--text-tertiary)" />
        ) : null,
    },
    {
      key: 'target',
      label: 'Target line',
      width: 220,
      render: (_: unknown, row: { line?: StatementLine; addInstanceTarget?: InstanceTarget; childLine?: StatementLine; isKpi?: boolean }) => {
        if (row.addInstanceTarget) {
          return (
            <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-medium)', color: 'var(--text-brand)' }}>
              <Icon name="plus" size={12} color="var(--text-brand)" />
              Add {row.addInstanceTarget.kind === 'section' ? 'KPI' : 'sub-line'}
            </span>
          );
        }
        if (row.childLine) {
          const name = row.childLine.name.trim();
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
        const childCount = row.line.allowsSubLines ? childrenOf(schema, row.line.id).length : 0;
        const missing = !childCount && isMissingRequired(row.line, m);
        const low = !childCount && isLowConfidence(m);
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
                color: childCount ? 'var(--text-tertiary)' : 'var(--text-primary)', ...rowLineStyle, background: undefined, borderTop: undefined,
              }}
            >
              {row.line.name}
            </span>
            {childCount ? (
              <span title={`Superseded by ${childCount} sub-line${childCount > 1 ? 's' : ''} — direct mapping disabled`}>
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
      render: (_: unknown, row: { line?: StatementLine; childLine?: StatementLine }) => {
        const targetId = row.line?.id ?? row.childLine?.id;
        if (!targetId) return null;
        const m = mapping[targetId];
        const empty = !m || m.sourceLineIds.length === 0;
        if (row.childLine) {
          if (empty) return <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>Manual entry</span>;
          const summary = m.sourceLineIds.map((id) => workbook.lines.find((l) => l.id === id)?.name).join('  +  ');
          return <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-body)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{summary}</span>;
        }
        if (!row.line) return null;
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
      render: (_: unknown, row: { line?: StatementLine; childLine?: StatementLine }) => {
        const targetId = row.line?.id ?? row.childLine?.id;
        if (!targetId) return null;
        const error = liveEvaluation.getError(targetId);
        if (error) {
          return (
            <span title={error} style={{ display: 'inline-flex', justifyContent: 'flex-end', width: '100%' }}>
              <Icon name="alert-triangle" size={12} color="var(--text-negative)" />
            </span>
          );
        }
        const value = liveEvaluation.getValue(targetId, i);
        return (
          <span
            style={{
              fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', fontVariantNumeric: 'var(--numeric-tabular)',
              color: value === null ? 'var(--text-disabled)' : 'var(--text-body)',
            }}
          >
            {formatPeriodValue(value, row.line?.numberFormat ?? row.childLine?.numberFormat)}
          </span>
        );
      },
    })),
  ];

  const tabs = [
    { value: 'all', label: 'All' },
    ...schema.sections.map((section) => {
      const issues = section.lines.filter((line) => !line.parentLineId && needsReview(line, mapping[line.id])).length;
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
                <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-medium)', color: 'var(--text-primary)' }}>{schema.name}</span>
              ) : (
                <Select
                  size="sm"
                  options={schemas.map((s) => ({ value: s.id, label: s.name }))}
                  value={selectedTemplateId}
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
              requestAddChild(row.addInstanceTarget);
              return;
            }
            if (row.line || row.childLine) setExpandedLineId(expandedLineId === row.id ? null : row.id);
          }}
          renderDetail={(row: { id: string; line?: StatementLine; sectionName?: string; childLine?: StatementLine; isKpi?: boolean }) => {
            if (row.childLine) {
              const child = row.childLine;
              const m = mapping[child.id] ?? blankMapping(child.id);
              const driverId = child.projection && 'driverId' in child.projection ? child.projection.driverId : undefined;
              const basisLineId = driverId ? schema.drivers.find((d) => d.id === driverId)?.basisLineId : undefined;
              return (
                <InstanceRowDetail
                  line={child}
                  sectionName={row.sectionName ?? ''}
                  workbook={workbook}
                  schemaLineGroups={schemaLineGroups}
                  basisLineId={basisLineId}
                  isKpi={Boolean(row.isKpi)}
                  effectiveKind={effectiveLineKind(schema, child)}
                  sourceLineIds={m.sourceLineIds}
                  manualHistoricals={manualHistoricals[child.id] ?? []}
                  onChangeName={(name) => setDraftSchema((prev) => (prev ? patchLine(prev, child.id, { name }) : prev))}
                  onChangeSourceLines={(sourceLineIds) => setSourceLines(child, sourceLineIds)}
                  onChangeManualHistoricals={(values) => setManualHistoricals((prev) => ({ ...prev, [child.id]: values }))}
                  onChangeProjection={(selection: ChildProjectionSelection) =>
                    setDraftSchema((prev) => (prev ? setChildProjection(prev, child.id, selection) : prev))
                  }
                  onChangeDebtProperties={(patch: Partial<DebtTrancheProperties>) =>
                    setDraftSchema((prev) => (prev ? patchLine(prev, child.id, { debtProperties: { ...child.debtProperties, ...patch } }) : prev))
                  }
                  onDelete={() => requestDeleteChild(child.id)}
                />
              );
            }
            if (row.line) {
              const childCount = row.line.allowsSubLines ? childrenOf(schema, row.line.id).length : 0;
              return (
                <MappingRowDetail
                  target={row.line}
                  sectionName={row.sectionName ?? ''}
                  mapping={mapping[row.line.id]}
                  workbook={workbook}
                  onSetSourceLines={(ids) => setSourceLines(row.line as StatementLine, ids)}
                  onApprove={() => updateMapping((row.line as StatementLine).id, { approved: true })}
                  supersededByInstanceCount={childCount}
                />
              );
            }
            return null;
          }}
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
      <MappedLinesDialog open={mappedLinesOpen} statementSchema={schema} mapping={mapping} onClose={() => setMappedLinesOpen(false)} />

      <Dialog
        open={pendingTemplateId !== null}
        onClose={() => setPendingTemplateId(null)}
        icon="alert-triangle"
        title="Change statement schema?"
        subtitle={company.name}
        footer={
          <>
            <Button onClick={() => setPendingTemplateId(null)}>Keep current schema</Button>
            <Button variant="danger" iconLeft="refresh-cw" onClick={confirmSchemaChange}>
              Change schema
            </Button>
          </>
        }
      >
        <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--text-body)' }}>
          Starts over from the new template — every line will be re-matched, and any manual mapping corrections or
          sub-lines/tranches/KPIs added this session will be lost.
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

      <Dialog
        open={pendingLineRemoval !== null}
        onClose={() => setPendingLineRemoval(null)}
        icon="alert-triangle"
        title="Delete this sub-line?"
        subtitle={pendingLineRemoval ? schema.sections.flatMap((s) => s.lines).find((l) => l.id === pendingLineRemoval.lineId)?.name : undefined}
        footer={
          <>
            <Button onClick={() => setPendingLineRemoval(null)}>Cancel</Button>
            <Button variant="danger" iconLeft="trash-2" onClick={confirmPendingLineRemoval}>
              Delete anyway
            </Button>
          </>
        }
      >
        {pendingLineRemoval ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            {/* Two genuinely different outcomes, from findSchemaDependents' two checks — a
                driver using this line as its basis (percent-of/days-of/roll-off) falls back to
                flat, same as it always has; a line whose FORMULA references this one (a parent's
                regenerated sum, or a roll-off basis line's non-destructive wrapper — see
                lib/statementLineChildren.ts) has that formula automatically regenerated instead,
                not reset to flat. Conflating the two here would misdescribe exactly the roll-off
                case this mechanism exists for. */}
            {pendingLineRemoval.dependents.driverBases.length > 0 ? (
              <div>
                <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--text-body)' }}>
                  These will switch to "Flat (holds last actual)" since their basis will no longer exist:
                </p>
                <ul style={{ margin: 0, paddingLeft: 'var(--space-6)', fontSize: 'var(--text-sm)', color: 'var(--text-body)' }}>
                  {pendingLineRemoval.dependents.driverBases.map((d) => (
                    <li key={d.id}>{d.name}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {pendingLineRemoval.dependents.formulaLines.length > 0 ? (
              <div>
                <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--text-body)' }}>
                  These lines' formulas reference it and will be updated automatically (a rollup sum shrinks, or a
                  roll-off basis line's adjustment is removed):
                </p>
                <ul style={{ margin: 0, paddingLeft: 'var(--space-6)', fontSize: 'var(--text-sm)', color: 'var(--text-body)' }}>
                  {pendingLineRemoval.dependents.formulaLines.map((l) => (
                    <li key={l.id}>{l.name}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
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

function patchLine(schema: StatementSchema, lineId: string, patch: Partial<StatementLine>): StatementSchema {
  return {
    ...schema,
    sections: schema.sections.map((s) => ({ ...s, lines: s.lines.map((l) => (l.id === lineId ? { ...l, ...patch } : l)) })),
  };
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
