import { useEffect, useState } from 'react';
import { Button, Card, Icon } from '@basis/design-system';
import { modelImportRepository, type Company, type ModelImport, type ModelTemplateType } from '../../data';
import { CreateModelDialog } from './CreateModelDialog';

const TEMPLATE_LABELS: Record<ModelTemplateType, string> = {
  'basis-template': 'Basis Template',
  'extract-ai': 'Extract with AI',
};

interface FinancialsTabProps {
  company: Company;
}

export function FinancialsTab({ company }: FinancialsTabProps) {
  const [model, setModel] = useState<ModelImport | null | undefined>(undefined);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const existing = await modelImportRepository.getForCompany(company.id);
      if (!cancelled) setModel(existing ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [company.id]);

  async function handleSubmit(input: { templateType: ModelTemplateType; file: File }) {
    const created = await modelImportRepository.create({ companyId: company.id, ...input });
    setModel(created);
  }

  if (model === undefined) {
    return <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>Loading…</span>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gutter)' }}>
      {model ? (
        <Card title="Model" icon="file-spreadsheet">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>{model.fileName}</span>
            <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-secondary)' }}>
              {TEMPLATE_LABELS[model.templateType]} · uploaded {new Date(model.uploadedAt).toLocaleDateString()}
            </span>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: 'var(--space-3)' }}>
              Mapping this model to the statement definitions is the next step.
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
        onSubmit={handleSubmit}
      />
    </div>
  );
}
