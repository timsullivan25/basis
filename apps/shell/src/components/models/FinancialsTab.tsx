import { useEffect, useMemo, useState } from 'react';
import { Button, Card, Dialog, Icon, IconButton } from '@basis/design-system';
import {
  computedResultRepository,
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
import {
  buildComputedResult,
  computeVersionStamp,
  materializeEvaluation,
  toLineValues,
  versionStampMatches,
  type LineValues,
} from '../../lib/computedCache';
import { evaluateModel } from '../../lib/engine/evaluate';
import { createDefaultStatementSchema } from '../../data/defaultStatementSchema';
import { AiImportDialog } from './AiImportDialog';
import { CreateModelDialog } from './CreateModelDialog';
import { SummaryPanel } from './SummaryPanel';
import type { ModelMappingScreenProps } from './mapping/ModelMappingScreen';

const TEMPLATE_LABELS: Record<ModelTemplateType, string> = {
  'basis-template': 'Basis Template',
  'extract-ai': 'Extract with AI',
};

interface FinancialsTabProps {
  company: Company;
  /** Opens the mapping screen as a dedicated app-level overlay — see AppShell. */
  onOpenMapping: (props: ModelMappingScreenProps) => void;
  /** Navigates to the model workspace — see AppShell. */
  onOpenWorkspace: () => void;
}

/** Read-through cache lookup: a version-stamp hit skips the engine entirely — see DashboardTab's
 *  own former copy of this (moved here now that the full summary lives on Financials, not
 *  Dashboard). A miss computes live once and writes the fresh result back. */
async function readOrComputeResult(model: Model, schema: StatementSchema): Promise<LineValues> {
  const cached = await computedResultRepository.get(model.id, 'base');
  if (cached && versionStampMatches(cached.versionStamp, model, null, schema)) {
    return toLineValues(cached);
  }
  const evaluation = evaluateModel(schema, model);
  const materialized = materializeEvaluation(schema, model, evaluation);
  const versionStamp = computeVersionStamp(model, null, schema);
  const built = buildComputedResult(model.id, 'base', versionStamp, materialized);
  await computedResultRepository.set(built);
  return toLineValues(built);
}

export function FinancialsTab({ company, onOpenMapping, onOpenWorkspace }: FinancialsTabProps) {
  const [model, setModel] = useState<Model | null | undefined>(undefined);
  const [modelImport, setModelImport] = useState<ModelImport | null>(null);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [schemas, setSchemas] = useState<StatementSchema[] | null>(null);
  const [modelSchema, setModelSchema] = useState<StatementSchema | null>(null);
  const [summaryResult, setSummaryResult] = useState<LineValues | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  // The upload currently being reviewed by the AI importer (null when that dialog is closed).
  const [aiFile, setAiFile] = useState<File | null>(null);
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
      setModelSchema(null);
      setSummaryResult(null);

      if (!existingModel) return;
      const existingSchema = await statementSchemaRepository.get(existingModel.statementSchemaId);
      if (cancelled || !existingSchema) return;
      setModelSchema(existingSchema);
      const lineValues = await readOrComputeResult(existingModel, existingSchema);
      if (!cancelled) setSummaryResult(lineValues);
    })();
    return () => {
      cancelled = true;
    };
  }, [company.id]);

  // Line names and aliases the AI importer scores sheets against: the first template, like the
  // mapping screen's default choice — falling back to the seeded default if none has loaded.
  const aiSections = useMemo(() => schemas?.[0]?.sections ?? createDefaultStatementSchema().sections, [schemas]);

  async function handleDelete() {
    if (!model) return;
    setDeleting(true);
    try {
      await modelRepository.remove(model.id);
      setModel(null);
      setModelImport(null);
      setMapping(null);
      setModelSchema(null);
      setSummaryResult(null);
    } finally {
      setDeleting(false);
      setDeleteConfirmOpen(false);
    }
  }

  async function loadModelDetails(savedModel: Model) {
    const [imp, map, schema] = await Promise.all([
      modelImportRepository.get(savedModel.modelImportId),
      mappingRepository.get(savedModel.mappingId),
      statementSchemaRepository.get(savedModel.statementSchemaId),
    ]);
    setModel(savedModel);
    setModelImport(imp ?? null);
    setMapping(map ?? null);
    setModelSchema(schema ?? null);
    setSummaryResult(schema ? await readOrComputeResult(savedModel, schema) : null);
  }

  function startNewImport(input: { templateType: ModelTemplateType; file: File; originalFile?: File }) {
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
    // `schemas` (statementSchemaRepository.list(), templates only) is unused by
    // ModelMappingScreen for the `editing` case — it fetches the model's own private schema
    // directly by id instead — but is still required by ModelMappingScreenProps, so it's passed
    // through unchanged.
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
      {model && modelSchema && summaryResult ? (
        <SummaryPanel schema={modelSchema} model={model} result={summaryResult} onOpenWorkspace={onOpenWorkspace} />
      ) : null}
      {model && modelImport && mapping ? (
        <Card
          title="Model"
          icon="file-spreadsheet"
          actions={
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
              <Button size="sm" variant="primary" iconLeft="layout-dashboard" onClick={onOpenWorkspace}>
                Open workspace
              </Button>
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
        <div
          style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 'var(--space-5)',
            padding: 'var(--space-13) var(--space-8)', border: '1px dashed var(--border-default)',
            borderRadius: 'var(--radius-md)', background: 'var(--surface-app)',
          }}
        >
          <Icon name="file-spreadsheet" size={28} color="var(--text-tertiary)" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', color: 'var(--text-primary)' }}>No financials yet</span>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
              Upload a file to map it against a statement template and start building a model.
            </span>
          </div>
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
          if (input.templateType === 'extract-ai') setAiFile(input.file);
          else startNewImport(input);
        }}
      />

      <AiImportDialog
        open={aiFile !== null}
        file={aiFile}
        companyName={company.name}
        sections={aiSections}
        onClose={() => setAiFile(null)}
        onDone={(templateFile) => {
          const original = aiFile;
          setAiFile(null);
          if (original) startNewImport({ templateType: 'extract-ai', file: templateFile, originalFile: original });
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
