import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Dialog, Field, IconButton, Input, Select, Toast } from '@basis/design-system';
import {
  statementSchemaRepository,
  type DriverDefinition,
  type ProjectionMethod,
  type StatementLine,
  type StatementSchema,
  type StatementSection,
} from '../data';
import { DEFAULT_SCHEMA_ID } from '../data/defaultStatementSchema';
import { SectionEditor, type ProjectionSelection } from '../components/statements/SectionEditor';
import {
  buildDaysFormula,
  buildFlatFormula,
  buildGrowthFormula,
  buildNameIndex,
  buildRatioFormula,
  collectRefIds,
  isCalculated,
} from '../lib/engine/resolve';
import { findSchemaDependents, hasSchemaDependents, type SchemaLineDependents } from '../lib/lineDependents';

// Roll-off/Actual are LineInstance-only projection methods (see instances/projectionMethod.tsx)
// — never selectable here, so this schema-line map deliberately only covers the subset
// SectionEditor's own PROJECTION_METHOD_OPTIONS actually offers.
const PROJECTION_METHOD_UNIT: Record<Extract<ProjectionMethod, 'growth' | 'percent-of' | 'days-of'>, string> = {
  growth: '%',
  'percent-of': '%',
  'days-of': 'days',
};
/** Phrasing for an auto-generated driver name — distinct from the Select's option labels
 *  ("Percent of…") so the two can read naturally in their own contexts: a dropdown option vs.
 *  "Revenue % of Cost of Revenue" once a basis line is appended to it. */
const DRIVER_NAME_PHRASE: Record<'percent-of' | 'days-of', string> = {
  'percent-of': '% of',
  'days-of': 'Days of',
};

/** Held between "delete clicked" and the user confirming/cancelling — `lineId` undefined means
 *  the whole section (every id in `deletedIds`) is being removed, not just one line. */
interface PendingLineRemoval {
  sectionId: string;
  lineId?: string;
  deletedIds: Set<string>;
  dependents: SchemaLineDependents;
}

function emptyLine(): StatementLine {
  return {
    id: crypto.randomUUID(),
    name: '',
    required: true,
    rowFormat: 'normal',
    numberFormat: 'number',
    sign: 'natural',
    aggregation: 'sum',
    formula: null,
    projection: null,
    aliases: [],
  };
}

function moveWithinArray<T>(items: T[], index: number, direction: 'up' | 'down'): T[] {
  const target = direction === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= items.length) return items;
  const next = items.slice();
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** Shared, fully-controlled name-prompt dialog for "New schema", "Duplicate" and "Rename". */
function NameDialog({
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

/** Serializes the two pieces of schema content that get edited together, so the dirty-check and
 *  the saved-snapshot comparison see a drivers-only change (no section/line edit) as dirty too. */
function snapshotOf(sections: StatementSection[], drivers: DriverDefinition[]): string {
  return JSON.stringify({ sections, drivers });
}

export function StatementDefinitionsScreen() {
  const [schemas, setSchemas] = useState<StatementSchema[]>([]);
  const [selectedSchemaId, setSelectedSchemaId] = useState<string | null>(null);
  const [sections, setSections] = useState<StatementSection[]>([]);
  const [drivers, setDrivers] = useState<DriverDefinition[]>([]);
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'new' | 'duplicate' | 'rename' | null>(null);
  const [pendingName, setPendingName] = useState('');
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [pendingLineRemoval, setPendingLineRemoval] = useState<PendingLineRemoval | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = await statementSchemaRepository.list();
      if (cancelled) return;
      setSchemas(list);
      const first = list[0];
      setSelectedSchemaId(first?.id ?? null);
      setSections(first?.sections ?? []);
      setDrivers(first?.drivers ?? []);
      setSavedSnapshot(snapshotOf(first?.sections ?? [], first?.drivers ?? []));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(timer);
  }, [toast]);

  const selectedSchema = schemas.find((s) => s.id === selectedSchemaId) ?? null;
  const isDirty = savedSnapshot !== null && snapshotOf(sections, drivers) !== savedSnapshot;

  function selectSchema(id: string) {
    if (isDirty) return;
    const schema = schemas.find((s) => s.id === id);
    if (!schema) return;
    setSelectedSchemaId(id);
    setSections(schema.sections);
    setDrivers(schema.drivers);
    setSavedSnapshot(snapshotOf(schema.sections, schema.drivers));
  }

  function openDialog(kind: 'new' | 'duplicate' | 'rename', initialName: string) {
    setPendingName(initialName);
    setDialog(kind);
  }

  async function handleCreate() {
    const created = await statementSchemaRepository.create({ name: pendingName.trim() });
    setSchemas((prev) => [...prev, created]);
    setDialog(null);
    setSelectedSchemaId(created.id);
    setSections(created.sections);
    setDrivers(created.drivers);
    setSavedSnapshot(snapshotOf(created.sections, created.drivers));
  }

  async function handleDuplicate() {
    if (!selectedSchema) return;
    const { schema: copy } = await statementSchemaRepository.duplicate(selectedSchema.id, pendingName.trim());
    setSchemas((prev) => [...prev, copy]);
    setDialog(null);
    setSelectedSchemaId(copy.id);
    setSections(copy.sections);
    setDrivers(copy.drivers);
    setSavedSnapshot(snapshotOf(copy.sections, copy.drivers));
  }

  async function handleRename() {
    if (!selectedSchema) return;
    const renamed = await statementSchemaRepository.save({ ...selectedSchema, name: pendingName.trim(), sections, drivers });
    setSchemas((prev) => prev.map((s) => (s.id === renamed.id ? renamed : s)));
    setDialog(null);
    setToast('Schema renamed');
  }

  async function handleDelete() {
    if (!selectedSchema || schemas.length <= 1) return;
    await statementSchemaRepository.remove(selectedSchema.id);
    const remaining = schemas.filter((s) => s.id !== selectedSchema.id);
    setSchemas(remaining);
    setDeleteConfirmOpen(false);
    const next = remaining[0];
    setSelectedSchemaId(next?.id ?? null);
    setSections(next?.sections ?? []);
    setDrivers(next?.drivers ?? []);
    setSavedSnapshot(snapshotOf(next?.sections ?? [], next?.drivers ?? []));
    setToast('Schema deleted');
  }

  /** Regenerates "Basis Default" from the current code — see StatementSchemaRepository.resetDefault's
   *  own doc comment for why this is safe: no model depends on the default template's own ids past
   *  the moment it forks its own copy. The one way to get back a comprehensive, driver-complete
   *  template without hand-editing it back into shape after the underlying code has moved on. */
  async function handleResetDefault() {
    const fresh = await statementSchemaRepository.resetDefault();
    setSchemas((prev) => prev.map((s) => (s.id === fresh.id ? fresh : s)));
    if (selectedSchemaId === fresh.id) {
      setSections(fresh.sections);
      setDrivers(fresh.drivers);
      setSavedSnapshot(snapshotOf(fresh.sections, fresh.drivers));
    }
    setResetConfirmOpen(false);
    setToast('Basis Default reset to the current built-in template');
  }

  function addSection() {
    setSections((prev) => [...prev, { id: crypto.randomUUID(), name: '', lines: [] }]);
  }

  function renameSection(sectionId: string, name: string) {
    setSections((prev) => prev.map((s) => (s.id === sectionId ? { ...s, name } : s)));
  }

  function setSectionAllowsFreeformLines(sectionId: string, next: boolean) {
    setSections((prev) => prev.map((s) => (s.id === sectionId ? { ...s, allowsFreeformLines: next } : s)));
  }

  function moveSection(sectionId: string, direction: 'up' | 'down') {
    setSections((prev) => moveWithinArray(prev, prev.findIndex((s) => s.id === sectionId), direction));
  }

  /** Every driver targeting a line among `removedLineIds` is orphaned by the removal — drop it
   *  too, rather than leaving a driver in schema.drivers with no line pointing back at it. */
  function dropDriversForLines(removedLineIds: Set<string>) {
    setDrivers((prev) => prev.filter((d) => !removedLineIds.has(d.targetLineId)));
  }

  /** Deletes the section (all its lines at once) if nothing depends on any of them, otherwise
   *  holds the delete and opens a confirm dialog naming what does — see requestLineRemoval. */
  function deleteSection(sectionId: string) {
    const removed = sections.find((s) => s.id === sectionId);
    if (!removed) return;
    requestLineRemoval(sectionId, undefined, new Set(removed.lines.map((l) => l.id)));
  }

  function addLine(sectionId: string) {
    setSections((prev) => prev.map((s) => (s.id === sectionId ? { ...s, lines: [...s.lines, emptyLine()] } : s)));
  }

  function findLine(lineId: string): StatementLine | undefined {
    for (const s of sections) {
      const found = s.lines.find((l) => l.id === lineId);
      if (found) return found;
    }
    return undefined;
  }

  function updateLine(lineId: string, patch: Partial<StatementLine>) {
    // No rename cascade needed — formulas reference lines by resolved id (see
    // lib/engine/resolve.ts), so a rename here never touches anything that reads this line.
    setSections((prev) =>
      prev.map((s) => ({
        ...s,
        lines: s.lines.map((line) => (line.id === lineId ? { ...line, ...patch } : line)),
      })),
    );
  }

  /** The single entry point for the "Projection method" control in SectionEditor — computes and
   *  writes both the line's formula and (for the four driver-generating methods) a fresh
   *  DriverDefinition, replacing any driver this line previously had. A method change always
   *  discards the old driver rather than reinterpreting its per-model values under a new
   *  method's semantics, which would be silent and easy to get subtly wrong. */
  function setLineProjection(lineId: string, selection: ProjectionSelection) {
    const line = findLine(lineId);
    const existingDriverId = line?.projection && 'driverId' in line.projection ? line.projection.driverId : undefined;
    const remainingDrivers = existingDriverId ? drivers.filter((d) => d.id !== existingDriverId) : drivers;

    if (selection.method === 'none') {
      setDrivers(remainingDrivers);
      updateLine(lineId, { formula: null, projection: null });
      return;
    }
    if (selection.method === 'flat') {
      setDrivers(remainingDrivers);
      updateLine(lineId, { formula: buildFlatFormula(lineId), projection: { method: 'flat' } });
      return;
    }
    if (selection.method === 'growth') {
      const driverId = crypto.randomUUID();
      const driver: DriverDefinition = {
        id: driverId,
        name: `${line?.name || 'Line'} Growth Rate`,
        unit: PROJECTION_METHOD_UNIT.growth,
        targetLineId: lineId,
        method: 'growth',
      };
      setDrivers([...remainingDrivers, driver]);
      updateLine(lineId, { formula: buildGrowthFormula(lineId, driverId), projection: { method: 'growth', driverId } });
      return;
    }

    const driverId = crypto.randomUUID();
    const basisName = findLine(selection.basisLineId)?.name || 'basis';
    const driver: DriverDefinition = {
      id: driverId,
      name: `${line?.name || 'Line'} ${DRIVER_NAME_PHRASE[selection.method]} ${basisName}`,
      unit: PROJECTION_METHOD_UNIT[selection.method],
      targetLineId: lineId,
      method: selection.method,
      basisLineId: selection.basisLineId,
    };
    setDrivers([...remainingDrivers, driver]);
    const formula =
      selection.method === 'days-of'
        ? buildDaysFormula(selection.basisLineId, driverId)
        : buildRatioFormula(selection.basisLineId, driverId);
    updateLine(lineId, { formula, projection: { method: selection.method, driverId } });
  }

  /** Deletes the line if nothing depends on it, otherwise holds the delete and opens a confirm
   *  dialog naming what does — see requestLineRemoval. */
  function deleteLine(sectionId: string, lineId: string) {
    requestLineRemoval(sectionId, lineId, new Set([lineId]));
  }

  /** Looks up everything that references `deletedIds` within this statement definition — another
   *  line's formula, or a driver's basis — before actually deleting. Deliberately schema-only: a
   *  saved model's schema choice is locked, so what a specific model's own mapping/instances
   *  depend on is that model's own concern (see the mapping screen's own instance-delete check),
   *  not something this screen looks into. Nothing depending on it deletes immediately, same as
   *  before; anything found opens a confirm dialog instead of breaking silently. */
  function requestLineRemoval(sectionId: string, lineId: string | undefined, deletedIds: Set<string>) {
    if (!selectedSchema) return;
    const currentSchema: StatementSchema = { ...selectedSchema, sections, drivers };
    const dependents = findSchemaDependents(currentSchema, deletedIds);
    if (hasSchemaDependents(dependents)) {
      setPendingLineRemoval({ sectionId, lineId, deletedIds, dependents });
    } else {
      commitLineRemoval(sectionId, lineId, deletedIds);
    }
  }

  function commitLineRemoval(sectionId: string, lineId: string | undefined, deletedIds: Set<string>) {
    dropDriversForLines(deletedIds);
    if (lineId === undefined) {
      setSections((prev) => prev.filter((s) => s.id !== sectionId));
    } else {
      setSections((prev) =>
        prev.map((s) => (s.id === sectionId ? { ...s, lines: s.lines.filter((line) => line.id !== lineId) } : s)),
      );
    }
  }

  function confirmPendingLineRemoval() {
    if (!pendingLineRemoval) return;
    commitLineRemoval(pendingLineRemoval.sectionId, pendingLineRemoval.lineId, pendingLineRemoval.deletedIds);
    setPendingLineRemoval(null);
  }

  function pendingRemovalName(p: PendingLineRemoval): string {
    if (p.lineId !== undefined) return findLine(p.lineId)?.name ?? '';
    return sections.find((s) => s.id === p.sectionId)?.name ?? '';
  }

  function moveLine(sectionId: string, lineId: string, direction: 'up' | 'down') {
    setSections((prev) =>
      prev.map((s) =>
        s.id === sectionId
          ? { ...s, lines: moveWithinArray(s.lines, s.lines.findIndex((line) => line.id === lineId), direction) }
          : s,
      ),
    );
  }

  function moveLineToSection(fromSectionId: string, lineId: string, toSectionId: string) {
    setSections((prev) => {
      const fromSection = prev.find((s) => s.id === fromSectionId);
      const line = fromSection?.lines.find((l) => l.id === lineId);
      if (!line) return prev;
      return prev.map((s) => {
        if (s.id === fromSectionId) return { ...s, lines: s.lines.filter((l) => l.id !== lineId) };
        if (s.id === toSectionId) return { ...s, lines: [...s.lines, line] };
        return s;
      });
    });
  }

  async function handleSave() {
    if (!selectedSchema) return;
    setSaving(true);
    try {
      const updated = await statementSchemaRepository.save({ ...selectedSchema, sections, drivers });
      setSchemas((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
      setSavedSnapshot(snapshotOf(sections, drivers));
      setToast('Statement definitions saved');
    } finally {
      setSaving(false);
    }
  }

  const nameIndex = useMemo(() => buildNameIndex({ sections, drivers }), [sections, drivers]);
  const lineGroups = useMemo(
    () => sections.map((s) => ({ sectionName: s.name, lines: s.lines.map((l) => ({ id: l.id, name: l.name })) })),
    [sections],
  );

  // A stored formula is always valid when it's saved — the only way one can go stale afterward
  // is a reference to a line that's since been deleted, so that's what this counts.
  const errorLineCount = useMemo(() => {
    const liveIds = new Set(sections.flatMap((s) => s.lines.map((l) => l.id)));
    return sections
      .flatMap((s) => s.lines)
      .filter((line) => isCalculated(line) && collectRefIds(line.formula!).some((id) => !liveIds.has(id))).length;
  }, [sections]);

  if (loading) {
    return <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>Loading…</span>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gutter)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-6)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <h1 style={{ fontSize: 'var(--text-xl)' }}>Financial statement definitions</h1>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
            Sections and lines here define the structure every import and model is mapped against.
          </span>
        </div>
        <div style={{ flex: '1 1 auto' }} />
        <Button variant="primary" iconLeft="save" onClick={handleSave} loading={saving} disabled={!isDirty}>
          Save
        </Button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
        <div style={{ width: 240 }}>
          <Select
            size="sm"
            options={schemas.map((s) => ({ value: s.id, label: s.name }))}
            value={selectedSchemaId ?? ''}
            onChange={(e) => selectSchema(e.target.value)}
            disabled={isDirty}
          />
        </div>
        <Button size="sm" iconLeft="plus" onClick={() => openDialog('new', '')} disabled={isDirty}>
          New schema
        </Button>
        <Button
          size="sm"
          iconLeft="copy"
          onClick={() => selectedSchema && openDialog('duplicate', `${selectedSchema.name} copy`)}
          disabled={isDirty || !selectedSchema}
        >
          Duplicate
        </Button>
        <Button
          size="sm"
          iconLeft="pencil"
          onClick={() => selectedSchema && openDialog('rename', selectedSchema.name)}
          disabled={isDirty || !selectedSchema}
        >
          Rename
        </Button>
        <IconButton
          icon="trash-2"
          label="Delete schema"
          size="sm"
          variant="ghost"
          onClick={() => setDeleteConfirmOpen(true)}
          disabled={isDirty || !selectedSchema || schemas.length <= 1}
        />
        {selectedSchema?.id === DEFAULT_SCHEMA_ID ? (
          <IconButton
            icon="refresh-ccw"
            label="Reset to latest default"
            size="sm"
            variant="ghost"
            onClick={() => setResetConfirmOpen(true)}
            disabled={isDirty}
          />
        ) : null}
        {isDirty ? (
          <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-secondary)' }}>
            Save or discard changes to switch schemas.
          </span>
        ) : null}
      </div>

      {errorLineCount > 0 ? (
        <Alert tone="negative" compact>
          {errorLineCount} line{errorLineCount > 1 ? 's reference' : ' references'} a line that no longer exists.
        </Alert>
      ) : null}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-8)' }}>
        {sections.map((section, index) => (
          <SectionEditor
            key={section.id}
            section={section}
            isFirst={index === 0}
            isLast={index === sections.length - 1}
            otherSections={sections.filter((s) => s.id !== section.id).map((s) => ({ id: s.id, name: s.name }))}
            lineGroups={lineGroups}
            drivers={drivers}
            nameIndex={nameIndex}
            onRename={(name) => renameSection(section.id, name)}
            onSetAllowsFreeformLines={(next) => setSectionAllowsFreeformLines(section.id, next)}
            onMoveUp={() => moveSection(section.id, 'up')}
            onMoveDown={() => moveSection(section.id, 'down')}
            onDelete={() => deleteSection(section.id)}
            onAddLine={() => addLine(section.id)}
            onUpdateLine={updateLine}
            onSetProjection={setLineProjection}
            onDeleteLine={(lineId) => deleteLine(section.id, lineId)}
            onMoveLine={(lineId, direction) => moveLine(section.id, lineId, direction)}
            onMoveLineToSection={(lineId, toSectionId) => moveLineToSection(section.id, lineId, toSectionId)}
          />
        ))}
      </div>

      <Button variant="secondary" iconLeft="plus" onClick={addSection} style={{ alignSelf: 'flex-start' }}>
        Add section
      </Button>

      <NameDialog
        open={dialog === 'new'}
        title="New statement schema"
        name={pendingName}
        confirmLabel="Create"
        onChangeName={setPendingName}
        onClose={() => setDialog(null)}
        onConfirm={handleCreate}
      />
      <NameDialog
        open={dialog === 'duplicate'}
        title="Duplicate statement schema"
        name={pendingName}
        confirmLabel="Duplicate"
        onChangeName={setPendingName}
        onClose={() => setDialog(null)}
        onConfirm={handleDuplicate}
      />
      <NameDialog
        open={dialog === 'rename'}
        title="Rename statement schema"
        name={pendingName}
        confirmLabel="Rename"
        onChangeName={setPendingName}
        onClose={() => setDialog(null)}
        onConfirm={handleRename}
      />

      <Dialog
        open={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        icon="alert-triangle"
        title="Delete this schema?"
        subtitle={selectedSchema?.name}
        footer={
          <>
            <Button onClick={() => setDeleteConfirmOpen(false)}>Cancel</Button>
            <Button variant="danger" iconLeft="trash-2" onClick={handleDelete}>
              Delete schema
            </Button>
          </>
        }
      >
        <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--text-body)' }}>
          Sections and lines defined here will be permanently removed. Models already mapped against it keep their
          saved mapping, but it can no longer be edited or duplicated. This cannot be undone.
        </p>
      </Dialog>

      <Dialog
        open={resetConfirmOpen}
        onClose={() => setResetConfirmOpen(false)}
        icon="alert-triangle"
        title="Reset Basis Default to the latest built-in template?"
        footer={
          <>
            <Button onClick={() => setResetConfirmOpen(false)}>Cancel</Button>
            <Button variant="danger" iconLeft="refresh-ccw" onClick={handleResetDefault}>
              Reset
            </Button>
          </>
        }
      >
        <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--text-body)' }}>
          Any manual edits made to Basis Default will be discarded and replaced with the current built-in template.
          Models already built on it are unaffected — each owns its own private copy from the moment it was created.
          This cannot be undone.
        </p>
      </Dialog>

      <Dialog
        open={pendingLineRemoval !== null}
        onClose={() => setPendingLineRemoval(null)}
        icon="alert-triangle"
        title={pendingLineRemoval?.lineId === undefined ? 'Delete this section?' : 'Delete this line?'}
        subtitle={pendingLineRemoval ? pendingRemovalName(pendingLineRemoval) : undefined}
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
            <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--text-body)' }}>
              This still has references elsewhere that will break or silently change if you continue:
            </p>
            <ul style={{ margin: 0, paddingLeft: 'var(--space-6)', fontSize: 'var(--text-sm)', color: 'var(--text-body)' }}>
              {pendingLineRemoval.dependents.formulaLines.map((l) => (
                <li key={`formula-${l.id}`}>"{l.name}"'s formula references this — it will show a broken reference.</li>
              ))}
              {pendingLineRemoval.dependents.driverBases.map((d) => (
                <li key={`driver-${d.id}`}>The driver "{d.name}" uses this as its basis and will be left pointing at nothing.</li>
              ))}
            </ul>
          </div>
        ) : null}
      </Dialog>

      {toast ? (
        <div style={{ position: 'fixed', right: 'var(--space-8)', bottom: 'var(--space-8)', zIndex: 200 }}>
          <Toast tone="positive" title={toast} onDismiss={() => setToast(null)} />
        </div>
      ) : null}
    </div>
  );
}
