import { useEffect, useState } from 'react';
import { Button, Card, Dialog, Icon, IconButton } from '@basis/design-system';
import {
  mappingRepository,
  modelImportRepository,
  modelRepository,
  statementSchemaRepository,
  type Company,
  type Mapping,
  type Model,
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
  const [model, setModel] = useState<Model | null | undefined>(undefined);
  const [modelImport, setModelImport] = useState<ModelImport | null>(null);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [schemas, setSchemas] = useState<StatementSchema[] | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [existingModel, schemaList] = await Promise.all([
        modelRepository.getForCompany(company.id),
        statementSchemaRepository.list(),
      ]);
      if (cancelled) return;
      const [imp, map] = existingModel
        ? await Promise.all([
            modelImportRepository.get(existingModel.modelImportId),
            mappingRepository.get(existingModel.mappingId),
          ])
        : [null, null];
      if (cancelled) return;
      setModel(existingModel ?? null);
      setModelImport(imp ?? null);
      setMapping(map ?? null);
      setSchemas(schemaList);
    })();
    return () => {
      cancelled = true;
    };
  }, [company.id]);

  async function handleDelete() {
    if (!model) return;
    setDeleting(true);
    try {
      await modelRepository.remove(model.id);
      setModel(null);
      setModelImport(null);
      setMapping(null);
    } finally {
      setDeleting(false);
      setDeleteConfirmOpen(false);
    }
  }

  async function loadModelDetails(savedModel: Model) {
    const [imp, map] = await Promise.all([
      modelImportRepository.get(savedModel.modelImportId),
      mappingRepository.get(savedModel.mappingId),
    ]);
    setModel(savedModel);
    setModelImport(imp ?? null);
    setMapping(map ?? null);
  }

  function startNewImport(input: { templateType: ModelTemplateType; file: File }) {
    if (!schemas) return;
    onOpenMapping({
      company,
      schemas,
      draft: { ...input, existingModel: model ?? undefined },
      onCancel: () => {},
      onSaved: (savedModel) => {
        void loadModelDetails(savedModel);
      },
    });
  }

  function startEditMapping() {
    if (!schemas || !model || !modelImport) return;
    onOpenMapping({
      company,
      schemas,
      editing: { model, modelImport },
      onCancel: () => {},
      onSaved: (updatedModel) => {
        void loadModelDetails(updatedModel);
      },
    });
  }

  if (model === undefined || !schemas) {
    return <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>Loading…</span>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gutter)' }}>
      {model && modelImport && mapping ? (
        <Card
          title="Model"
          icon="file-spreadsheet"
          actions={
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
              <Button size="sm" iconLeft="git-merge" onClick={startEditMapping}>
                Edit mapping
              </Button>
              <Button size="sm" iconLeft="upload" onClick={() => setDialogOpen(true)}>
                Upload new file
              </Button>
              <IconButton icon="trash-2" label="Delete model" size="sm" variant="ghost" onClick={() => setDeleteConfirmOpen(true)} />
            </div>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>{modelImport.fileName}</span>
            <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-secondary)' }}>
              {TEMPLATE_LABELS[modelImport.templateType]} · uploaded {new Date(modelImport.uploadedAt).toLocaleDateString()}
            </span>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: 'var(--space-3)' }}>
              Mapped {new Date(mapping.mappedAt).toLocaleDateString()} ·{' '}
              {mapping.lines.filter((m) => m.sourceLineIds.length > 0).length} of {mapping.lines.length} lines mapped
            </span>
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
        subtitle={modelImport?.fileName}
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
