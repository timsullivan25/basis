import { useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, Card, DataTable, Dialog, Icon, IconButton, Input, Select, SegmentedControl, Tabs, Toast } from '@basis/design-system';
import {
  mappingRepository,
  modelImportRepository,
  modelRepository,
  statementSchemaRepository,
  type Company,
  type DebtTrancheProperties,
  type LineMapping,
  type Model,
  type LineRole,
  type ModelImport,
  type ModelTemplateType,
  type ParsedWorkbook,
  type StatementLine,
  type StatementSchema,
} from '../../../data';
import { DEFAULT_ADJUSTMENT_INSTANCE_SEEDS, DEFAULT_ADJUSTMENT_TARGET_LINE_NAME, DEFAULT_SCHEMA_ID } from '../../../data/defaultStatementSchema';
import { parseBasisTemplate, TemplateParseError } from '../../../lib/parseBasisTemplate';
import { matchStatementLines } from '../../../lib/matchStatementLines';
import { recomputeAndCacheModel } from '../../../lib/modelRecompute';
import { buildTimeline } from '../../../lib/periodTimeline';
import { resolveActuals } from '../../../lib/resolveActuals';
import { buildNameIndex, formatFormula } from '../../../lib/engine/resolve';
import { expectsMapping, isFormulaOnly } from '../../../lib/lineRole';
import { evaluateModel } from '../../../lib/engine/evaluate';
import { cloneStatementSchemaStructure } from '../../../lib/statementSchemaClone';
import { addChildLine, effectiveLineKind, removeChildLine } from '../../../lib/statementLineChildren';
import { periodsPerYearFor, regenerateDebtSchedule } from '../../../lib/debtSchedule';
import { findSchemaDependents, hasSchemaDependents, type SchemaLineDependents } from '../../../lib/lineDependents';
import { buildSectionRows, resolveFlatRowDropTarget } from '../../../lib/statementRowBuilder';
import * as schemaEdit from '../../../lib/statementSchemaEdit';
import { getLineRowStyle, getRequiredMeta } from '../../statements/statementFormatting';
import { LineSettingsPanelContent } from '../../statements/SectionEditor';
import type { InstanceTarget, SchemaLineGroup } from '../instances/projectionMethod';
import { InstanceMappingDetail } from './InstanceMappingDetail';
import { ImportStepper } from '../ImportStepper';
import { ImportedLinesDialog } from './ImportedLinesDialog';
import { MappedLinesDialog } from './MappedLinesDialog';
import { MappingRowDetail } from './MappingRowDetail';
import { applyStructureOp, proposeStructure, subLineParents, type StructureOp } from '../../../lib/aiImport/proposeStructure';
import { StructureProposalDialog } from './StructureProposalDialog';
import { getLlmProvider } from '../../../lib/aiImport/provider';
import { loadAiSettings } from '../../../lib/aiImport/aiSettings';
import { runAiReview, type AiReviewResult, type AiReviewStep } from '../../../lib/aiImport/runAiReview';
import { formatPeriodValue, isAmbiguous, isLowConfidence, isMissingRequired, needsReview, MATCH_METHOD_META } from './mappingFormatting';

const STEPS = ['Upload model', 'Map line items', 'Save'];

/** A blank mapping entry for a freshly-created child line — same shape matchStatementLines
 *  would produce for an unmatched ordinary line, so a child is indistinguishable from any other
 *  line the moment it exists. */
function blankMapping(lineId: string): LineMapping {
  return { targetLineId: lineId, sourceLineIds: [], method: 'none', confidence: 0, note: '', approved: false };
}

/** True for a line lib/debtSchedule.ts's regenerateDebtSchedule generated directly (a tranche's
 *  own Beginning/Interest/.../Ending Balance, or one of the three schedule-level totals) — never
 *  directly mappable, since its value comes entirely from other generated lines' formulas. Read-
 *  only here — see the mapping table's target/source/match columns and MappingRowDetail's
 *  calculatedByDebtSchedule branch. A line that merely REFERENCES a debt-schedule total by
 *  ordinary formula (Net Interest Expense, say) isn't tagged and needs no special handling at
 *  all — it's just a normal structural calculated line, same as Gross Profit, already covered by
 *  the existing isCalculated(line) && !line.projection treatment below. */
function isDebtScheduleGenerated(line: StatementLine): boolean {
  return Boolean(line.debtScheduleRole);
}

export interface ModelMappingScreenProps {
  company: Company;
  /** Every TEMPLATE available to start a new model from (never a model's own private fork —
   *  see statementSchemaRepository.list()'s own doc comment). Unused when `editing` — optional
   *  for exactly that case, so a caller that only ever opens `editing` sessions (e.g.
   *  ModelWorkspaceScreen's own "Edit statement" button) isn't forced to fetch the template list
   *  just to satisfy this prop. */
  schemas?: StatementSchema[];
  /** Re-reviewing an already-saved model's existing file — Save updates its mapping/schema in place. */
  editing?: { model: Model; modelImport: ModelImport };
  /** A freshly-picked, not-yet-saved file — Save creates a new model (template choice editable until saved). */
  draft?: {
    templateType: ModelTemplateType;
    file: File;
    /** The user's own upload, when `file` is a Basis Template generated from it (AI extraction). */
    originalFile?: File;
    /** The company's current model, if any — seeds prior-mapping hints and triggers the replace confirm on save. */
    existingModel?: Model;
  };
  /** Which mode the Edit mapping/Edit schema toggle opens on — defaults to 'mapping' (reviewing
   *  an import) unless a caller has a reason to jump straight to schema editing (e.g. the
   *  workspace's own "Edit statement" button, which is about structure, not a fresh import). */
  initialMode?: 'mapping' | 'schema';
  onCancel: () => void;
  onSaved: (model: Model) => void;
}

export function ModelMappingScreen({ company, schemas = [], editing, draft, initialMode, onCancel, onSaved }: ModelMappingScreenProps) {
  const file = editing?.modelImport.file ?? draft?.file;
  const fileName = editing?.modelImport.fileName ?? draft?.originalFile?.name ?? draft?.file.name ?? '';
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
  const [aiState, setAiState] = useState<{ status: 'idle' } | { status: 'running'; step: AiReviewStep } | { status: 'done'; result: AiReviewResult; asked: number } | { status: 'failed'; message: string }>({ status: 'idle' });
  // "Edit mapping" (the historical default) vs "Edit schema" — same rows either way (see
  // buildSectionRows), only the columns and the side panel differ. See changeSchema's own
  // comment for how a schema-mode edit gets persisted.
  const [mode, setMode] = useState<'mapping' | 'schema'>(initialMode ?? 'mapping');
  // Held between "delete clicked" and the user confirming/cancelling, only when something else in
  // the schema actually depends on what's being removed — see requestDeleteChild/requestDeleteLine's
  // own comments. A 'child' removal (a sub-line/KPI) needs no sectionId — see
  // lib/statementLineChildren.ts's removeChildLine.
  const [pendingRemoval, setPendingRemoval] = useState<
    | { kind: 'child'; lineId: string; dependents: SchemaLineDependents }
    | { kind: 'line'; sectionId: string; lineId: string; dependents: SchemaLineDependents }
    | null
  >(null);

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
        // Defensive, not load-bearing — the persisted schema's debt schedule should already be
        // fresh (see ModelWorkspaceScreen's circular-calc toggle, which regenerates on save), but
        // regenerating here is cheap/idempotent and guards against any drift.
        setDraftSchema(regenerateDebtSchedule(clonedDraft, periodsPerYearFor(buildTimeline(workbook.periods)[0]?.type ?? 'FY'), editing.model.circularCalcsEnabled ?? false));

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
  const parentLineIds = useMemo(() => new Set((schema?.sections ?? []).flatMap((sec) => sec.lines.map((l) => l.parentLineId)).filter(Boolean) as string[]), [schema]);
  const allLines = useMemo(() => (schema ? schema.sections.flatMap((section) => section.lines.map((line) => ({ line, section }))) : []), [schema]);
  // Lines expected to carry a real mapped value — the Required and Optional ones. A calculated
  // or check line is never mapped (its formula is its value in every period), and a parent that
  // sums real sub-lines has handed mapping to them.
  const mappableLines = useMemo(
    () => allLines.filter(({ line }) => !isDebtScheduleGenerated(line) && expectsMapping(line) && !parentLineIds.has(line.id)),
    [allLines, parentLineIds],
  );
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

  // The circular-calc toggle lives on the model, edited from ModelWorkspaceScreen's settings
  // popover (see Model.circularCalcsEnabled's own doc comment) — this screen only reads whatever
  // it's currently set to (false for a brand-new, not-yet-created model) so every tranche edit
  // here keeps regenerating a schedule consistent with it.
  const circularCalcsEnabled = editing?.model.circularCalcsEnabled ?? false;

  /** Re-derives the "Debt Schedule" section from the current tranches/properties — cheap and
   *  idempotent (see regenerateDebtSchedule's own doc comment), so every mutation that could
   *  possibly affect it (add/remove a tranche, edit its properties) just runs it again rather
   *  than trying to special-case which specific change actually matters. */
  function applyDebtSchedule(next: StatementSchema): StatementSchema {
    const periodType = timeline[0]?.type ?? 'FY';
    return regenerateDebtSchedule(next, periodsPerYearFor(periodType), circularCalcsEnabled);
  }

  /** The single entry point for every Edit-schema-mode mutation (and the pre-existing add/delete-
   *  child paths, which are schema edits too) — regenerates the Debt Schedule, same as every
   *  other schema write here, and updates the draft. For `editing`, a debounced effect below
   *  eagerly persists this independently of "Save mapping" (see that effect's own comment); for a
   *  brand-new import there's no durable schema row yet, so it just stays in the draft until Save,
   *  unchanged from before this mode existed. */
  function changeSchema(next: StatementSchema) {
    setDraftSchema(applyDebtSchedule(next));
  }

  function updateMapping(targetLineId: string, patch: Partial<LineMapping>) {
    setMapping((prev) => ({ ...prev, [targetLineId]: { ...prev[targetLineId], ...patch } }));
  }

  /** Unmapped and tied lines only — anything already matched (however weakly) is left for the reviewer. */
  const isAiSettled = (m: LineMapping | undefined) => (m?.sourceLineIds.length ?? 0) > 0 && !isAmbiguous(m);
  const aiCandidateCount = mappableLines.filter(({ line }) => !isAiSettled(mapping[line.id])).length;

  async function reviewWithAi() {
    if (!workbook) return;
    if (!schema) return;
    setAiState({ status: 'running', step: 'fill' });
    try {
      const result = await runAiReview({
        provider: getLlmProvider(), schema, targets: mappableLines, workbook, mapping, manualHistoricals, isSettled: isAiSettled,
        onStep: (step) => setAiState({ status: 'running', step }),
        passes: loadAiSettings().passes,
      });
      setMapping(result.mapping);
      setAiState({ status: 'done', result, asked: aiCandidateCount });
    } catch (error) {
      setAiState({ status: 'failed', message: error instanceof Error ? error.message : String(error) });
    }
  }

  const [structureOps, setStructureOps] = useState<StructureOp[] | null>(null);
  const [structureRunning, setStructureRunning] = useState(false);
  const canSuggestStructure = !!schema && subLineParents(schema).length > 0;

  async function suggestSubLines() {
    if (!workbook || !schema) return;
    setStructureRunning(true);
    try {
      setStructureOps(await proposeStructure(getLlmProvider(), schema, workbook, mapping));
    } catch (error) {
      setAiState({ status: 'failed', message: error instanceof Error ? error.message : String(error) });
    } finally {
      setStructureRunning(false);
    }
  }

  function applyStructure(ops: StructureOp[]) {
    if (!schema) return;
    let nextSchema = schema;
    let nextMapping = mapping;
    for (const op of ops) ({ schema: nextSchema, mapping: nextMapping } = applyStructureOp(nextSchema, nextMapping, op));
    setDraftSchema(applyDebtSchedule(nextSchema));
    setMapping(nextMapping);
    setStructureOps(null);
  }

  /** Undoes one AI suggestion: the line goes back to what it was mapped to before the review touched it. */
  function rejectAiSuggestion(lineId: string) {
    setMapping((prev) => {
      const restore = prev[lineId]?.previous;
      return restore ? { ...prev, [lineId]: { ...restore } } : prev;
    });
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
    setDraftSchema(applyDebtSchedule(next));
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
      setPendingRemoval({ kind: 'child', lineId, dependents });
    } else {
      commitDeleteChild(lineId);
    }
  }

  function commitDeleteChild(lineId: string) {
    setDraftSchema((prev) => (prev ? applyDebtSchedule(removeChildLine(prev, lineId)) : prev));
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

  /** Edit-schema-mode counterpart of requestDeleteChild, for a top-level line — same dependency-
   *  check-then-confirm split, reused from lib/lineDependents.ts as-is. */
  function requestDeleteLine(sectionId: string, lineId: string) {
    if (!schema) return;
    const dependents = findSchemaDependents(schema, new Set([lineId]));
    if (hasSchemaDependents(dependents)) {
      setPendingRemoval({ kind: 'line', sectionId, lineId, dependents });
    } else {
      changeSchema(schemaEdit.removeLine(schema, sectionId, lineId));
    }
  }

  function confirmPendingRemoval() {
    if (!pendingRemoval || !schema) return;
    if (pendingRemoval.kind === 'child') commitDeleteChild(pendingRemoval.lineId);
    else changeSchema(schemaEdit.removeLine(schema, pendingRemoval.sectionId, pendingRemoval.lineId));
    setPendingRemoval(null);
  }

  // Edit-schema-mode mutations — thin wrappers over lib/statementSchemaEdit.ts's pure functions,
  // same pattern SchemaStructureEditor uses, routed through changeSchema so every one of them
  // regenerates the Debt Schedule and (for `editing`) eagerly persists. Section-level management
  // (rename/reorder/delete/freeform toggle) is deliberately out of scope here — this screen's flat,
  // tab-filtered table has no per-section header to host those controls, and a model's sections
  // rarely need restructuring on their own (unlike lines); use the template builder for that, or
  // change templates before creating the model. Only "add a line" and "add a section" are offered.
  function addSection() {
    if (schema) changeSchema(schemaEdit.addSection(schema));
  }
  // Selects the new line so its settings panel opens with the name field ready to type into.
  function addLine(sectionId: string) {
    if (!schema) return;
    const next = schemaEdit.addLine(schema, sectionId);
    changeSchema(next);
    const added = next.sections.find((s) => s.id === sectionId)?.lines.at(-1);
    if (added) setExpandedLineId(added.id);
  }
  function updateLineSchema(lineId: string, patch: Partial<StatementLine>) {
    if (schema) changeSchema(schemaEdit.updateLine(schema, lineId, patch));
  }
  function setLineProjectionSchema(lineId: string, selection: schemaEdit.ProjectionSelection) {
    if (schema) changeSchema(schemaEdit.setLineProjection(schema, lineId, selection));
  }
  function setLineRoleSchema(lineId: string, role: LineRole) {
    if (schema) changeSchema(schemaEdit.setLineRole(schema, lineId, role));
  }
  function changeDebtPropertiesSchema(lineId: string, patch: Partial<DebtTrancheProperties>) {
    if (!schema) return;
    const line = schemaEdit.findLine(schema, lineId);
    changeSchema(schemaEdit.updateLine(schema, lineId, { debtProperties: { ...line?.debtProperties, ...patch } }));
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
          originalFile: draft!.originalFile,
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
      await recomputeAndCacheModel(savedSchema, savedModel, savedEvaluation);

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
    if (onlyReview && !needsReview(line, mapping[line.id], (childCountByLineId.get(line.id) ?? 0) > 0)) return false;
    if (query) {
      const sourceNames = (mapping[line.id]?.sourceLineIds ?? [])
        .map((id) => wb.lines.find((source) => source.id === id)?.name ?? '')
        .join(' ');
      if (!`${line.name} ${sourceNames}`.toLowerCase().includes(query)) return false;
    }
    return true;
  }
  // Schema mode has no mapping status to filter by — just a plain name search.
  function passesSchemaSearch(line: StatementLine): boolean {
    return !query || line.name.toLowerCase().includes(query);
  }

  // Computed once and reused by every column (target/source/status/match) so a superseded
  // parent reads consistently across the whole row, not just the one column that happened to
  // check for it — see the "source"/"match" column fix below.
  const childCountByLineId = new Map<string, number>();
  for (const line of schema.sections.flatMap((s) => s.lines)) {
    if (line.parentLineId === undefined) continue;
    childCountByLineId.set(line.parentLineId, (childCountByLineId.get(line.parentLineId) ?? 0) + 1);
  }

  const rows: Array<{
    id: string; __group?: string; line?: StatementLine; sectionName?: string; sectionId?: string;
    addInstanceTarget?: InstanceTarget; childLine?: StatementLine; isKpi?: boolean;
  }> = [];
  schema.sections.forEach((section) => {
    if (tab !== 'all' && tab !== section.id) return;
    // "+ Add sub-line/KPI" rows are schema-mode-only now — adding a line is a structural edit,
    // not a mapping act (see Edit-schema mode's own "+ Add" affordances).
    const sectionRows = buildSectionRows(schema, section, mode === 'schema' ? passesSchemaSearch : passes).filter(
      (row) => mode === 'schema' || !row.addInstanceTarget,
    );
    if (!sectionRows.length) return;
    rows.push({ id: `group-${section.id}`, __group: section.name });
    sectionRows.forEach((row) => rows.push({ ...row, sectionName: section.name, sectionId: section.id }));
  });

  // The row shown in the shared side panel — resolved once here (rather than inside the
  // DataTable's own render) so it can be rendered alongside the table instead of inline.
  const selectedRow = expandedLineId ? rows.find((r) => r.id === expandedLineId) : undefined;

  function reorderLineSchema(lineId: string, beforeKey: string | null) {
    if (!schema) return;
    const target = resolveFlatRowDropTarget(rows, schema.sections, beforeKey);
    if (target) changeSchema(schemaEdit.reorderLine(schema, lineId, target.toSectionId, target.beforeLineId));
  }

  const columns = [
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
        const childCount = childCountByLineId.get(row.line.id) ?? 0;
        const byDebtSchedule = isDebtScheduleGenerated(row.line);
        const formulaOnly = isFormulaOnly(row.line);
        const superseded = childCount > 0 || byDebtSchedule || formulaOnly;
        // "Missing required"/"low confidence" are mapping concepts — meaningless while editing
        // structure, so schema mode skips both the computation and (more importantly for the
        // drag handle's own spacing) reserving this dot's width + gap at all, rather than
        // rendering it transparent. A transparent-but-present dot was invisible in either mode,
        // but its reserved space combined with the handle's own gutter looked like a second,
        // uneven padding next to the handle — schema mode is the one place that visibly showed.
        const missing = mode === 'mapping' && !superseded && isMissingRequired(row.line, m, childCount > 0);
        const ambiguous = mode === 'mapping' && !superseded && isAmbiguous(m);
        const low = mode === 'mapping' && !superseded && (isLowConfidence(m) || ambiguous);
        const dot = missing ? 'var(--red-600)' : low ? 'var(--violet-600)' : null;
        const rowLineStyle = getLineRowStyle(row.line);
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', minWidth: 0 }}>
            {mode === 'mapping' ? (
              <span
                title={missing ? 'Missing required line' : ambiguous ? 'Multiple matches — pick one' : low ? 'Low confidence match' : undefined}
                style={{ width: 6, height: 6, borderRadius: '50%', flex: '0 0 auto', background: dot ?? 'transparent' }}
              />
            ) : null}
            <span
              style={{
                fontSize: 'var(--text-sm)', whiteSpace: 'nowrap', fontWeight: 'var(--weight-medium)',
                color: superseded ? 'var(--text-tertiary)' : 'var(--text-primary)', ...rowLineStyle, background: undefined, borderTop: undefined,
              }}
            >
              {row.line.name}
            </span>
            {childCount ? (
              <span title={`Superseded by ${childCount} sub-line${childCount > 1 ? 's' : ''} — direct mapping disabled`}>
                <Icon name="git-branch" size={11} color="var(--text-tertiary)" />
              </span>
            ) : byDebtSchedule ? (
              <span title="Auto-generated by the Debt Schedule — expand for its formula">
                <Icon name="sparkles" size={11} color="var(--text-tertiary)" />
              </span>
            ) : formulaOnly ? (
              <span title={`Formula: ${formatFormula(row.line.formula, nameIndex)}`}>
                <Icon name="function-square" size={11} color="var(--text-tertiary)" />
              </span>
            ) : null}
          </div>
        );
      },
    },
    ...(mode === 'schema'
      ? [
          {
            key: 'actions',
            label: '',
            width: 100,
            align: 'right' as const,
            render: (_: unknown, row: { id: string; line?: StatementLine; sectionId?: string }, isRowHovered: boolean) =>
              row.line && row.sectionId ? (
                <div
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    display: 'flex', justifyContent: 'flex-end',
                    opacity: isRowHovered || expandedLineId === row.id ? 1 : 0,
                    transition: 'opacity var(--dur-instant) var(--ease-out)',
                  }}
                >
                  <IconButton icon="trash-2" label="Delete line" size="sm" variant="ghost" onClick={() => requestDeleteLine(row.sectionId!, row.line!.id)} />
                </div>
              ) : null,
          },
        ]
      : []),
    ...(mode !== 'mapping'
      ? []
      : [
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
        const childCount = childCountByLineId.get(row.line.id) ?? 0;
        // A retained mapping is inactive, not gone, the moment this line has real children — its
        // own historicals still exist (so removing every child reverts to it, per
        // injectRollups/regenerateParentSumFormula's own "no children ⇒ no formula override"
        // behavior) but showing its stale mapped source here would look like it's still active.
        if (childCount > 0) {
          return (
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
              Aggregating {childCount} sub-line{childCount > 1 ? 's' : ''}
            </span>
          );
        }
        if (isDebtScheduleGenerated(row.line)) {
          // Formula shown only in the expanded detail panel (MappingRowDetail's "Formula" field),
          // same as every other calculated line — this column is just a status, not a preview.
          return (
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
              Auto-generated by the Debt Schedule
            </span>
          );
        }
        // A calculated / linked / check line is never mapped — its formula is its value in every period.
        if (isFormulaOnly(row.line)) {
          return (
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
              {row.line.role === 'linked' ? 'Linked — not mapped' : 'Calculated — not mapped'}
            </span>
          );
        }
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
        if ((childCountByLineId.get(row.line.id) ?? 0) > 0 || isDebtScheduleGenerated(row.line)) return null;
        const m = mapping[row.line.id];
        if (isFormulaOnly(row.line) || !m) return null;
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
      ]),
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
      const issues = section.lines.filter((line) => !line.parentLineId && needsReview(line, mapping[line.id], (childCountByLineId.get(line.id) ?? 0) > 0)).length;
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
        <ImportStepper steps={STEPS} current={2} />

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
            <Input
              size="sm"
              iconLeft="search"
              placeholder={mode === 'schema' ? 'Find a line' : 'Find target or source line'}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: 220 }}
            />
            {mode === 'mapping' ? (
              <Button size="sm" iconLeft="filter" selected={onlyReview} onClick={() => setOnlyReview(!onlyReview)}>
                Needs review · {reviewLines.length}
              </Button>
            ) : null}
            {mode === 'mapping' && (({ fill, consolidate, checks }) => fill || consolidate || checks)(loadAiSettings().passes) ? (
              <Button
                size="sm"
                iconLeft="sparkles"
                disabled={aiState.status === 'running'}
                onClick={reviewWithAi}
                title="Ask AI to (1) place unmapped and tied lines, (2) add leftover lines onto existing matches, and (3) use failing checks to find what's missing. Sends line names and latest values to the model."
              >
                {aiState.status === 'running' ? `${{ fill: 'Matching', consolidate: 'Consolidating', checks: 'Checking' }[aiState.step]}…` : `Review with AI · ${aiCandidateCount}`}
              </Button>
            ) : null}
            {mode === 'mapping' && canSuggestStructure && loadAiSettings().passes.subLines ? (
              <Button
                size="sm"
                iconLeft="sparkles"
                disabled={structureRunning}
                onClick={suggestSubLines}
                title="Ask AI which unmatched imported lines are sub-lines (segments, EBITDA adjustments, debt tranches). Sends line names and latest values to the model."
              >
                {structureRunning ? 'Looking…' : 'Suggest sub-lines'}
              </Button>
            ) : null}
          </>
        }
      />

      <div style={{ display: 'flex', flexDirection: 'row', gap: 'var(--space-6)', alignItems: 'flex-start' }}>
        <Card
          padding="none"
          icon={mode === 'schema' ? 'layout-list' : 'git-merge'}
          title={mode === 'schema' ? 'Statement structure' : 'Line item mapping'}
          actions={
            <SegmentedControl
              size="sm"
              options={[
                { value: 'mapping', label: 'Edit mapping' },
                { value: 'schema', label: 'Edit schema' },
              ]}
              value={mode}
              onChange={(value) => setMode(value as 'mapping' | 'schema')}
            />
          }
          footer={
            mode === 'schema' ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
                <Button size="sm" variant="ghost" iconLeft="plus" onClick={addSection}>
                  Add section
                </Button>
                {tab !== 'all' ? (
                  <Button size="sm" variant="ghost" iconLeft="plus" onClick={() => addLine(tab)}>
                    Add line to {schema.sections.find((s) => s.id === tab)?.name || 'this section'}
                  </Button>
                ) : null}
              </div>
            ) : undefined
          }
          style={{ flex: '1 1 auto', minWidth: 0 }}
        >
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
            draggableRows={mode === 'schema'}
            dragHandleMode="hover"
            canDragRow={(row: { line?: StatementLine }) => Boolean(row.line)}
            canDropBeforeRow={(row: { addInstanceTarget?: InstanceTarget }) => !row.addInstanceTarget}
            onReorder={mode === 'schema' ? reorderLineSchema : undefined}
          />
        </Card>

        {mode === 'schema' && (selectedRow?.line || selectedRow?.childLine) ? (
          (() => {
            const line = (selectedRow!.line ?? selectedRow!.childLine)!;
            const isChild = Boolean(selectedRow!.childLine);
            return (
              <LineSettingsPanelContent
                key={line.id}
                line={line}
                isChild={isChild}
                isKpi={selectedRow!.isKpi}
                isDebtLine={effectiveLineKind(schema, line) === 'debt'}
                debtProperties={line.debtProperties}
                onChangeDebtProperties={(patch) => changeDebtPropertiesSchema(line.id, patch)}
                lineGroups={schemaLineGroups}
                drivers={schema.drivers}
                nameIndex={nameIndex}
                onUpdateLine={updateLineSchema}
                onSetProjection={setLineProjectionSchema}
                onSetRole={setLineRoleSchema}
                onDeleteChildLine={isChild ? requestDeleteChild : undefined}
                onClose={() => setExpandedLineId(null)}
              />
            );
          })()
        ) : mode === 'mapping' && selectedRow?.childLine ? (
          (() => {
            const child = selectedRow.childLine;
            const m = mapping[child.id] ?? blankMapping(child.id);
            return (
              <InstanceMappingDetail
                line={child}
                sectionName={selectedRow.sectionName ?? ''}
                workbook={workbook}
                isKpi={Boolean(selectedRow.isKpi)}
                sourceLineIds={m.sourceLineIds}
                manualHistoricals={manualHistoricals[child.id] ?? []}
                onChangeSourceLines={(sourceLineIds) => setSourceLines(child, sourceLineIds)}
                onChangeManualHistoricals={(values) => setManualHistoricals((prev) => ({ ...prev, [child.id]: values }))}
                onClose={() => setExpandedLineId(null)}
              />
            );
          })()
        ) : mode === 'mapping' && selectedRow?.line ? (
          (() => {
            const line = selectedRow.line;
            const childCount = childCountByLineId.get(line.id) ?? 0;
            return (
              <MappingRowDetail
                target={line}
                sectionName={selectedRow.sectionName ?? ''}
                mapping={mapping[line.id] ?? blankMapping(line.id)}
                workbook={workbook}
                onSetSourceLines={(ids) => setSourceLines(line, ids)}
                onApprove={() => updateMapping(line.id, { approved: true })}
                onReject={() => rejectAiSuggestion(line.id)}
                supersededByInstanceCount={childCount}
                calculatedByDebtSchedule={isDebtScheduleGenerated(line)}
                calculated={isFormulaOnly(line)}
                formula={formatFormula(line.formula, nameIndex)}
                onClose={() => setExpandedLineId(null)}
              />
            );
          })()
        ) : null}
      </div>

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
        open={pendingRemoval !== null}
        onClose={() => setPendingRemoval(null)}
        icon="alert-triangle"
        title="Delete this line?"
        subtitle={pendingRemoval ? schema.sections.flatMap((s) => s.lines).find((l) => l.id === pendingRemoval.lineId)?.name : undefined}
        footer={
          <>
            <Button onClick={() => setPendingRemoval(null)}>Cancel</Button>
            <Button variant="danger" iconLeft="trash-2" onClick={confirmPendingRemoval}>
              Delete anyway
            </Button>
          </>
        }
      >
        {pendingRemoval ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            {/* Two genuinely different outcomes, from findSchemaDependents' two checks — a
                driver using this line as its basis (percent-of/days-of/roll-off) falls back to
                flat, same as it always has; a line whose FORMULA references this one (a parent's
                regenerated sum, or a roll-off basis line's non-destructive wrapper — see
                lib/statementLineChildren.ts) has that formula automatically regenerated instead,
                not reset to flat. Conflating the two here would misdescribe exactly the roll-off
                case this mechanism exists for. */}
            {pendingRemoval.dependents.driverBases.length > 0 ? (
              <div>
                <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--text-body)' }}>
                  These will switch to "Flat (holds last actual)" since their basis will no longer exist:
                </p>
                <ul style={{ margin: 0, paddingLeft: 'var(--space-6)', fontSize: 'var(--text-sm)', color: 'var(--text-body)' }}>
                  {pendingRemoval.dependents.driverBases.map((d) => (
                    <li key={d.id}>{d.name}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {pendingRemoval.dependents.formulaLines.length > 0 ? (
              <div>
                <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--text-body)' }}>
                  These lines' formulas reference it and will be updated automatically (a rollup sum shrinks, or a
                  roll-off basis line's adjustment is removed):
                </p>
                <ul style={{ margin: 0, paddingLeft: 'var(--space-6)', fontSize: 'var(--text-sm)', color: 'var(--text-body)' }}>
                  {pendingRemoval.dependents.formulaLines.map((l) => (
                    <li key={l.id}>{l.name}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </Dialog>

      {structureOps && schema ? (
        <StructureProposalDialog
          key={structureOps.map((o) => o.name).join('|')}
          open
          ops={structureOps}
          schema={schema}
          workbook={workbook}
          mapping={mapping}
          onApply={applyStructure}
          onClose={() => setStructureOps(null)}
        />
      ) : null}

      {aiState.status === 'done' || aiState.status === 'failed' ? (
        <div style={{ position: 'fixed', right: 'var(--space-8)', bottom: 'var(--space-8)', zIndex: 200 }}>
          <Toast
            tone={aiState.status === 'failed' ? 'negative' : aiState.result.checks.some((c) => c.status !== 'resolved') ? 'caution' : aiState.result.filled + aiState.result.consolidated > 0 ? 'positive' : 'info'}
            title={aiState.status === 'failed' ? 'AI review failed' : 'AI review finished'}
            onDismiss={() => setAiState({ status: 'idle' })}
          >
            {aiState.status === 'failed'
              ? aiState.message
              : aiReviewSummary(aiState.result, aiState.asked)}
          </Toast>
        </div>
      ) : null}

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

/** One plain sentence per pass, ending with any check the review could not close — that one is the reviewer's to chase. */
function aiReviewSummary(result: AiReviewResult, asked: number): string {
  const parts = [
    result.filled > 0 ? `Suggested a match for ${result.filled} of ${asked} open lines.` : asked > 0 ? `No suggestion for the ${asked} open lines.` : '',
    result.consolidated > 0 ? `Suggested adding lines to ${result.consolidated} existing match${result.consolidated === 1 ? '' : 'es'}.` : '',
    result.fixed > 0 ? `Changed ${result.fixed} more line${result.fixed === 1 ? '' : 's'} to close check gaps.` : '',
    ...result.reverted.map((section) => `Undid the later suggestions in ${section}: its check ended worse than it started.`),
    ...result.checks.map((c) =>
      c.status === 'resolved' ? `${c.section} check now passes.` : `${c.section} check ${c.status === 'improved' ? 'is closer but still fails' : 'still fails'}${c.latest === null ? '' : ` (${Math.round(c.latest * 100) / 100} in the latest period)`} — a line may still be missing.`,
    ),
  ].filter(Boolean);
  return `${parts.join(' ')} Everything suggested is flagged for review.`;
}
