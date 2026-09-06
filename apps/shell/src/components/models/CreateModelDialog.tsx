import { useState } from 'react';
import { Button, Dialog, Field, FileDropzone, Icon, IconButton, Select } from '@basis/design-system';
import type { ModelTemplateType } from '../../data';

const TEMPLATE_OPTIONS = [
  { value: 'basis-template', label: 'Basis Template' },
  { value: 'extract-ai', label: 'Extract with AI (coming soon)', disabled: true },
];

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface CreateModelDialogProps {
  open: boolean;
  companyName: string;
  onClose: () => void;
  onSubmit: (input: { templateType: ModelTemplateType; file: File }) => Promise<void>;
}

export function CreateModelDialog({ open, companyName, onClose, onSubmit }: CreateModelDialogProps) {
  const [templateType, setTemplateType] = useState<ModelTemplateType>('basis-template');
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setTemplateType('basis-template');
    setFile(null);
    setFileError(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  function handleFilesSelected(files: File[]) {
    const picked = files[0];
    if (!picked) return;
    if (!picked.name.toLowerCase().endsWith('.xlsx')) {
      setFileError('Only .xlsx files are supported.');
      return;
    }
    setFileError(null);
    setFile(picked);
  }

  async function handleSubmit() {
    if (!file) return;
    setSubmitting(true);
    try {
      await onSubmit({ templateType, file });
      reset();
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title="Create new model"
      subtitle={companyName}
      width={480}
      footer={
        <>
          <Button variant="secondary" onClick={handleClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={!file} loading={submitting}>
            Save
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
        <Field label="Company">
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>{companyName}</span>
        </Field>

        <Field label="Type of financials">
          <Select
            size="sm"
            options={TEMPLATE_OPTIONS}
            value={templateType}
            onChange={(e) => setTemplateType(e.target.value as ModelTemplateType)}
          />
        </Field>

        <Field label="Model file" error={fileError ?? undefined}>
          {file ? (
            <div
              style={{
                display: 'flex', alignItems: 'center', gap: 'var(--space-4)',
                padding: 'var(--space-4) var(--space-6)', background: 'var(--surface-card)',
                border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)',
              }}
            >
              <Icon name="file-spreadsheet" size={16} color="var(--text-brand)" />
              <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', color: 'var(--text-primary)' }}>
                  {file.name}
                </span>
                <span style={{ fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)' }}>
                  {formatFileSize(file.size)}
                </span>
              </div>
              <div style={{ marginLeft: 'auto' }}>
                <IconButton icon="x" label="Remove file" size="sm" variant="ghost" onClick={() => setFile(null)} />
              </div>
            </div>
          ) : (
            <FileDropzone accept=".xlsx" hint="XLSX files only" onFilesSelected={handleFilesSelected} />
          )}
        </Field>
      </div>
    </Dialog>
  );
}
