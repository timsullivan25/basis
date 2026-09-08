import { useEffect, useState } from 'react';
import { Button, Card, Dialog, Icon, IconButton } from '@basis/design-system';
import {
  modelImportRepository,
  statementSchemaRepository,
  type Company,
  type ModelImport,
  type ModelTemplateType,
  type StatementSchema,
} from '../../data';
import { CreateModelDialog } from './CreateModelDialog';
import type { ModelMappingScreenProps } from './mapping/ModelMappingScreen';

const TEMPLATE_LABELS: Record<ModelTemplateType, string> = {
  'basis-template': 'Basis Template',
  'extract-ai': 'Extract with AI',
};

interface FinancialsTabProps {
  company: Company;
  /** Opens the mapping screen as a dedicated app-level overlay — see AppShell. */
  onOpenMapping: (props: ModelMappingScreenProps) => void;
}

export function FinancialsTab({ company, onOpenMapping }: FinancialsTabProps) {
  const [model, setModel] = useState<ModelImport | null | undefined>(undefined);
  const [schemas, setSchemas] = useState<StatementSchema[] | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [existing, schemaList] = await Promise.all([
        modelImportRepository.getForCompany(company.id),
        statementSchemaRepository.list(),
      ]);
      if (!cancelled) {
        setModel(existing ?? null);
        setSchemas(schemaList);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [company.id]);

  async function handleDelete() {
    if (!model) return;
    setDeleting(true);
    try {
      await modelImportRepository.remove(model.id);
      setModel(null);
    } finally {
      setDeleting(false);
      setDeleteConfirmOpen(false);
    }
  }

  function startNewImport(input: { templateType: ModelTemplateType; file: File }) {
    if (!schemas) return;
    onOpenMapping({
      company,
      schemas,
      draft: input,
      onCancel: () => {},
      onSaved: (created) => setModel(created),
    });
  }

  function startEditMapping() {
    if (!schemas || !model) return;
    onOpenMapping({
      company,
      schemas,
      modelImport: model,
      onCancel: () => {},
      onSaved: (updated) => setModel(updated),
    });
  }

  if (model === undefined || !schemas) {
    return <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>Loading…</span>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gutter)' }}>
      {model ? (
        <Card
          title="Model"
          icon="file-spreadsheet"
          actions={
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
              <Button size="sm" iconLeft="git-merge" onClick={startEditMapping}>
                {model.mapping ? 'Edit mapping' : 'Map line items'}
              </Button>
              <IconButton icon="trash-2" label="Delete model" size="sm" variant="ghost" onClick={() => setDeleteConfirmOpen(true)} />
            </div>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>{model.fileName}</span>
            <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-secondary)' }}>
              {TEMPLATE_LABELS[model.templateType]} · uploaded {new Date(model.uploadedAt).toLocaleDateString()}
            </span>
            {model.mapping ? (
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: 'var(--space-3)' }}>
                Mapped {model.mappedAt ? new Date(model.mappedAt).toLocaleDateString() : ''} ·{' '}
                {model.mapping.filter((m) => m.sourceLineIds.length > 0).length} of {model.mapping.length} lines mapped
              </span>
            ) : (
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: 'var(--space-3)' }}>
                Not mapped to the statement definitions yet.
              </span>
            )}
          </div>
        </Card>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 'var(--space-5)', padding: 'var(--space-11) 0' }}>
          <Icon name="file-spreadsheet" size={22} color="var(--text-tertiary)" />
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>No financials yet.</span>
          <Button variant="primary" iconLeft="plus" onClick={() => setDialogOpen(true)}>
            Create new model
          </Button>
        </div>
      )}

      <CreateModelDialog
        open={dialogOpen}
        companyName={company.name}
        onClose={() => setDialogOpen(false)}
        onContinue={(input) => {
          setDialogOpen(false);
          startNewImport(input);
        }}
      />

      <Dialog
        open={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        icon="alert-triangle"
        title="Delete this model?"
        subtitle={model?.fileName}
        footer={
          <>
            <Button onClick={() => setDeleteConfirmOpen(false)}>Cancel</Button>
            <Button variant="danger" iconLeft="trash-2" loading={deleting} onClick={handleDelete}>
              Delete model
            </Button>
          </>
        }
      >
        <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--text-body)' }}>
          The uploaded file and its mapping will be permanently removed. This cannot be undone.
        </p>
      </Dialog>
    </div>
  );
}
