import { useMemo, useState } from 'react';
import { Alert, Button, Dialog } from '@basis/design-system';
import type { DebtTrancheProperties, LineRole, StatementLine, StatementSchema } from '../../data';
import { SectionEditor, LineSettingsPanelContent } from './SectionEditor';
import { buildNameIndex, collectRefIds, isCalculated } from '../../lib/engine/resolve';
import { findSchemaDependents, hasSchemaDependents, type SchemaLineDependents } from '../../lib/lineDependents';
import { addChildLine, effectiveLineKind, removeChildLine } from '../../lib/statementLineChildren';
import { buildSectionRows } from '../../lib/statementRowBuilder';
import type { InstanceTarget } from '../models/instances/projectionMethod';
import * as schemaEdit from '../../lib/statementSchemaEdit';

/** Held between "delete clicked" and the user confirming/cancelling. A 'section' removal takes
 *  every line in it down too; a 'child' removal (a sub-line/KPI) never needs a sectionId — see
 *  lib/statementLineChildren.ts's removeChildLine. */
type PendingRemoval =
  | { kind: 'section'; sectionId: string; dependents: SchemaLineDependents }
  | { kind: 'line'; sectionId: string; lineId: string; dependents: SchemaLineDependents }
  | { kind: 'child'; lineId: string; dependents: SchemaLineDependents };

interface SchemaStructureEditorProps {
  schema: StatementSchema;
  onChangeSchema: (next: StatementSchema) => void;
}

/** The full "define what a statement looks like" editing surface — sections, lines, sub-lines,
 *  projection/formula/aliases/debt-tranche settings, add/remove/reorder — shared by the template
 *  builder (StatementDefinitionsScreen, wrapping this with schema-lifecycle chrome: picker, new/
 *  duplicate/rename/delete, manual Save) and the model workspace's own schema-edit mode (wrapping
 *  this with eager per-edit persistence instead). This component owns no persistence itself —
 *  every mutation goes through `onChangeSchema`, so the host decides entirely when/how a change
 *  becomes durable, and (for a model's own schema) whether to regenerate the Debt Schedule
 *  afterward — this editor has no timeline to run that against, so it never does so itself. */
export function SchemaStructureEditor({ schema, onChangeSchema }: SchemaStructureEditorProps) {
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<PendingRemoval | null>(null);

  const { sections, drivers } = schema;
  const nameIndex = useMemo(() => buildNameIndex({ sections, drivers }), [sections, drivers]);
  const lineGroups = useMemo(
    () => sections.map((s) => ({ sectionName: s.name, lines: s.lines.map((l) => ({ id: l.id, name: l.name })) })),
    [sections],
  );

  // The one row shown in the shared side panel, wherever it lives — only one line (or sub-line/
  // KPI) can be selected across every section's DataTable at a time. Built the same way
  // ModelMappingScreen resolves its own selected row, from the same shared row builder, so a
  // selection means the same thing in both places.
  const selectedRowSection = selectedRowId
    ? sections.find((s) => buildSectionRows(schema, s).some((r) => r.id === selectedRowId))
    : undefined;
  const selectedRow = selectedRowSection ? buildSectionRows(schema, selectedRowSection).find((r) => r.id === selectedRowId) : undefined;
  const selectedLine = selectedRow?.line ?? selectedRow?.childLine;
  const selectedIsChild = Boolean(selectedRow?.childLine);
  const selectedIsKpi = selectedRow?.isKpi;
  const selectedIsDebtLine = selectedLine ? effectiveLineKind(schema, selectedLine) === 'debt' : false;

  // A stored formula is always valid when it's saved — the only way one can go stale afterward
  // is a reference to a line that's since been deleted, so that's what this counts.
  const errorLineCount = useMemo(() => {
    const liveIds = new Set(sections.flatMap((s) => s.lines.map((l) => l.id)));
    return sections
      .flatMap((s) => s.lines)
      .filter((line) => isCalculated(line) && collectRefIds(line.formula!).some((id) => !liveIds.has(id))).length;
  }, [sections]);

  function addSection() {
    onChangeSchema(schemaEdit.addSection(schema));
  }

  function renameSection(sectionId: string, name: string) {
    onChangeSchema(schemaEdit.renameSection(schema, sectionId, name));
  }

  function setSectionAllowsFreeformLines(sectionId: string, next: boolean) {
    onChangeSchema(schemaEdit.setSectionAllowsFreeformLines(schema, sectionId, next));
  }

  function moveSection(sectionId: string, direction: 'up' | 'down') {
    onChangeSchema(schemaEdit.moveSection(schema, sectionId, direction));
  }

  /** Deletes the section (all its lines at once) if nothing depends on any of them, otherwise
   *  holds the delete and opens a confirm dialog naming what does. */
  function deleteSection(sectionId: string) {
    const removed = schema.sections.find((s) => s.id === sectionId);
    if (!removed) return;
    const deletedIds = new Set(removed.lines.map((l) => l.id));
    const dependents = findSchemaDependents(schema, deletedIds);
    if (hasSchemaDependents(dependents)) {
      setPendingRemoval({ kind: 'section', sectionId, dependents });
    } else {
      onChangeSchema(schemaEdit.removeSection(schema, sectionId));
    }
  }

  /** Appends a blank line and selects it, so its settings panel opens with the (autofocused)
   *  name field ready to type into — same as addSubLine below. */
  function addLine(sectionId: string) {
    const next = schemaEdit.addLine(schema, sectionId);
    onChangeSchema(next);
    const added = next.sections.find((s) => s.id === sectionId)?.lines.at(-1);
    if (added) setSelectedRowId(added.id);
  }

  function updateLine(lineId: string, patch: Partial<StatementLine>) {
    onChangeSchema(schemaEdit.updateLine(schema, lineId, patch));
  }

  function setLineProjection(lineId: string, selection: schemaEdit.ProjectionSelection) {
    onChangeSchema(schemaEdit.setLineProjection(schema, lineId, selection));
  }

  function setLineRole(lineId: string, role: LineRole) {
    onChangeSchema(schemaEdit.setLineRole(schema, lineId, role));
  }

  function changeDebtProperties(lineId: string, patch: Partial<DebtTrancheProperties>) {
    const line = schemaEdit.findLine(schema, lineId);
    onChangeSchema(schemaEdit.updateLine(schema, lineId, { debtProperties: { ...line?.debtProperties, ...patch } }));
  }

  /** Deletes the line if nothing depends on it, otherwise holds the delete and opens a confirm
   *  dialog naming what does. */
  function deleteLine(sectionId: string, lineId: string) {
    const dependents = findSchemaDependents(schema, new Set([lineId]));
    if (hasSchemaDependents(dependents)) {
      setPendingRemoval({ kind: 'line', sectionId, lineId, dependents });
    } else {
      onChangeSchema(schemaEdit.removeLine(schema, sectionId, lineId));
    }
  }

  /** Creates a new, empty-named sub-line/KPI and selects it immediately — the user types its name
   *  straight into the panel, same convention ModelMappingScreen's own "+ Add sub-line" uses. */
  function addSubLine(target: InstanceTarget) {
    const { schema: next, lineId } = addChildLine(
      schema,
      target.kind === 'line' ? { kind: 'line', parentLineId: target.id } : { kind: 'section', sectionId: target.id },
      '',
    );
    onChangeSchema(next);
    setSelectedRowId(`child-${lineId}`);
  }

  /** Deletes the sub-line/KPI if nothing depends on it, otherwise holds the delete and opens a
   *  confirm dialog naming what does — same split as an ordinary line's delete, reused as-is
   *  since a child is just an ordinary line now (see lib/statementLineChildren.ts). */
  function deleteChildLine(lineId: string) {
    const dependents = findSchemaDependents(schema, new Set([lineId]));
    if (hasSchemaDependents(dependents)) {
      setPendingRemoval({ kind: 'child', lineId, dependents });
    } else {
      onChangeSchema(removeChildLine(schema, lineId));
      setSelectedRowId(null);
    }
  }

  function confirmPendingRemoval() {
    if (!pendingRemoval) return;
    if (pendingRemoval.kind === 'section') onChangeSchema(schemaEdit.removeSection(schema, pendingRemoval.sectionId));
    else if (pendingRemoval.kind === 'line') onChangeSchema(schemaEdit.removeLine(schema, pendingRemoval.sectionId, pendingRemoval.lineId));
    else {
      onChangeSchema(removeChildLine(schema, pendingRemoval.lineId));
      setSelectedRowId(null);
    }
    setPendingRemoval(null);
  }

  function pendingRemovalName(p: PendingRemoval): string {
    if (p.kind === 'section') return schema.sections.find((s) => s.id === p.sectionId)?.name ?? '';
    return schemaEdit.findLine(schema, p.lineId)?.name ?? '';
  }

  function reorderLine(toSectionId: string, lineId: string, beforeLineId: string | null) {
    onChangeSchema(schemaEdit.reorderLine(schema, lineId, toSectionId, beforeLineId));
  }

  return (
    <>
      {errorLineCount > 0 ? (
        <Alert tone="negative" compact>
          {errorLineCount} line{errorLineCount > 1 ? 's reference' : ' references'} a line that no longer exists.
        </Alert>
      ) : null}

      <div style={{ display: 'flex', flexDirection: 'row', gap: 'var(--space-8)', alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-8)' }}>
          {sections.map((section, index) => (
            <SectionEditor
              key={section.id}
              schema={schema}
              section={section}
              isFirst={index === 0}
              isLast={index === sections.length - 1}
              nameIndex={nameIndex}
              selectedLineId={selectedRowId}
              onSelectLine={(rowId) => setSelectedRowId((prev) => (prev === rowId ? null : rowId))}
              onAddSubLine={addSubLine}
              onRename={(name) => renameSection(section.id, name)}
              onSetAllowsFreeformLines={(next) => setSectionAllowsFreeformLines(section.id, next)}
              onMoveUp={() => moveSection(section.id, 'up')}
              onMoveDown={() => moveSection(section.id, 'down')}
              onDelete={() => deleteSection(section.id)}
              onAddLine={() => addLine(section.id)}
              onUpdateLine={updateLine}
              onSetRole={setLineRole}
              onDeleteLine={(lineId) => deleteLine(section.id, lineId)}
              onReorderLine={(lineId, beforeLineId) => reorderLine(section.id, lineId, beforeLineId)}
            />
          ))}

          <Button variant="secondary" iconLeft="plus" onClick={addSection} style={{ alignSelf: 'flex-start' }}>
            Add section
          </Button>
        </div>

        {selectedLine && selectedRowSection ? (
          <LineSettingsPanelContent
            key={selectedLine.id}
            line={selectedLine}
            isChild={selectedIsChild}
            isKpi={selectedIsKpi}
            isDebtLine={selectedIsDebtLine}
            debtProperties={selectedLine.debtProperties}
            onChangeDebtProperties={(patch) => changeDebtProperties(selectedLine.id, patch)}
            lineGroups={lineGroups}
            drivers={drivers}
            nameIndex={nameIndex}
            onUpdateLine={updateLine}
            onSetProjection={setLineProjection}
            onSetRole={setLineRole}
            onDeleteChildLine={deleteChildLine}
            onClose={() => setSelectedRowId(null)}
            // Sticks just below the screen's own sticky header when it publishes one (--defs-header-h).
            style={{ position: 'sticky', top: 'calc(var(--defs-header-h, 0px) + var(--space-4))', maxHeight: 'calc(100vh - var(--defs-header-h, 0px) - 160px)' }}
          />
        ) : null}
      </div>

      <Dialog
        open={pendingRemoval !== null}
        onClose={() => setPendingRemoval(null)}
        icon="alert-triangle"
        title={pendingRemoval?.kind === 'section' ? 'Delete this section?' : 'Delete this line?'}
        subtitle={pendingRemoval ? pendingRemovalName(pendingRemoval) : undefined}
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
            <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--text-body)' }}>
              This still has references elsewhere that will break or silently change if you continue:
            </p>
            <ul style={{ margin: 0, paddingLeft: 'var(--space-6)', fontSize: 'var(--text-sm)', color: 'var(--text-body)' }}>
              {pendingRemoval.dependents.formulaLines.map((l) => (
                <li key={`formula-${l.id}`}>"{l.name}"'s formula references this — it will show a broken reference.</li>
              ))}
              {pendingRemoval.dependents.driverBases.map((d) => (
                <li key={`driver-${d.id}`}>The driver "{d.name}" uses this as its basis and will be left pointing at nothing.</li>
              ))}
            </ul>
          </div>
        ) : null}
      </Dialog>
    </>
  );
}
