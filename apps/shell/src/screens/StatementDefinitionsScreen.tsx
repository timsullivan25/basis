import { useEffect, useState } from 'react';
import { Button, Dialog, Field, IconButton, Input, Select, Toast } from '@basis/design-system';
import { statementSchemaRepository, type StatementSchema } from '../data';
import { DEFAULT_SCHEMA_ID } from '../data/defaultStatementSchema';
import { SchemaStructureEditor } from '../components/statements/SchemaStructureEditor';

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
 *  the saved-snapshot comparison see a drivers-only change (no section/line edit) as dirty too —
 *  deliberately excludes name/id/timestamps, which are never edited via the live draft. */
function snapshotOf(schema: StatementSchema | null): string {
  return JSON.stringify({ sections: schema?.sections ?? [], drivers: schema?.drivers ?? [] });
}

/** The template-builder screen: schema-lifecycle chrome (picker, new/duplicate/rename/delete/
 *  reset, manual Save) wrapped around SchemaStructureEditor, the same section/line editing surface
 *  the model workspace's own schema-edit mode uses — see that component's own doc comment. */
export function StatementDefinitionsScreen() {
  const [schemas, setSchemas] = useState<StatementSchema[]>([]);
  const [selectedSchemaId, setSelectedSchemaId] = useState<string | null>(null);
  // The live-edited schema (sections + drivers + identity) — schemas above holds only the
  // last-persisted versions, used for the picker and as the dirty-diff baseline.
  const [draftSchema, setDraftSchema] = useState<StatementSchema | null>(null);
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'new' | 'duplicate' | 'rename' | null>(null);
  const [pendingName, setPendingName] = useState('');
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = await statementSchemaRepository.list();
      if (cancelled) return;
      setSchemas(list);
      const first = list[0] ?? null;
      setSelectedSchemaId(first?.id ?? null);
      setDraftSchema(first);
      setSavedSnapshot(snapshotOf(first));
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
  const isDirty = savedSnapshot !== null && snapshotOf(draftSchema) !== savedSnapshot;

  function selectSchema(id: string) {
    if (isDirty) return;
    const schema = schemas.find((s) => s.id === id);
    if (!schema) return;
    setSelectedSchemaId(id);
    setDraftSchema(schema);
    setSavedSnapshot(snapshotOf(schema));
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
    setDraftSchema(created);
    setSavedSnapshot(snapshotOf(created));
  }

  async function handleDuplicate() {
    if (!selectedSchema) return;
    const { schema: copy } = await statementSchemaRepository.duplicate(selectedSchema.id, pendingName.trim());
    setSchemas((prev) => [...prev, copy]);
    setDialog(null);
    setSelectedSchemaId(copy.id);
    setDraftSchema(copy);
    setSavedSnapshot(snapshotOf(copy));
  }

  async function handleRename() {
    if (!draftSchema) return;
    const renamed = await statementSchemaRepository.save({ ...draftSchema, name: pendingName.trim() });
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
    const next = remaining[0] ?? null;
    setSelectedSchemaId(next?.id ?? null);
    setDraftSchema(next);
    setSavedSnapshot(snapshotOf(next));
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
      setDraftSchema(fresh);
      setSavedSnapshot(snapshotOf(fresh));
    }
    setResetConfirmOpen(false);
    setToast('Basis Default reset to the current built-in template');
  }

  async function handleSave() {
    if (!draftSchema) return;
    setSaving(true);
    try {
      const updated = await statementSchemaRepository.save(draftSchema);
      setSchemas((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
      setDraftSchema(updated);
      setSavedSnapshot(snapshotOf(updated));
      setToast('Statement definitions saved');
    } finally {
      setSaving(false);
    }
  }

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

      {draftSchema ? <SchemaStructureEditor schema={draftSchema} onChangeSchema={setDraftSchema} /> : null}

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

      {toast ? (
        <div style={{ position: 'fixed', right: 'var(--space-8)', bottom: 'var(--space-8)', zIndex: 200 }}>
          <Toast tone="positive" title={toast} onDismiss={() => setToast(null)} />
        </div>
      ) : null}
    </div>
  );
}
