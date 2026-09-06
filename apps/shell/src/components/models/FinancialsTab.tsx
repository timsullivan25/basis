import { useEffect, useState } from 'react';
import { Button, Card, Icon } from '@basis/design-system';
import {
  modelImportRepository,
  statementSchemaRepository,
  type Company,
  type ModelImport,
  type ModelTemplateType,
  type StatementSchema,
} from '../../data';
import { CreateModelDialog } from './CreateModelDialog';
import { ModelMappingScreen } from './mapping/ModelMappingScreen';

const TEMPLATE_LABELS: Record<ModelTemplateType, string> = {
  'basis-template': 'Basis Template',
  'extract-ai': 'Extract with AI',
};

interface FinancialsTabProps {
  company: Company;
}

export function FinancialsTab({ company }: FinancialsTabProps) {
  const [model, setModel] = useState<ModelImport | null | undefined>(undefined);
  const [schema, setSchema] = useState<StatementSchema | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [mapping, setMapping] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [existing, statementSchema] = await Promise.all([
        modelImportRepository.getForCompany(company.id),
        statementSchemaRepository.get(),
      ]);
      if (!cancelled) {
        setModel(existing ?? null);
        setSchema(statementSchema);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [company.id]);

  async function handleSubmit(input: { templateType: ModelTemplateType; file: File }) {
    const created = await modelImportRepository.create({ companyId: company.id, ...input });
    setModel(created);
  }

  if (model === undefined || !schema) {
    return <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>Loading…</span>;
  }

  if (mapping && model) {
    return (
      <ModelMappingScreen
        company={company}
        modelImport={model}
        statementSchema={schema}
        onCancel={() => setMapping(false)}
        onSaved={(updated) => {
          setModel(updated);
          setMapping(false);
        }}
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gutter)' }}>
      {model ? (
        <Card title="Model" icon="file-spreadsheet" actions={<Button size="sm" iconLeft="git-merge" onClick={() => setMapping(true)}>{model.mapping ? 'Edit mapping' : 'Map line items'}</Button>}>
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
        onSubmit={handleSubmit}
      />
    </div>
  );
}
