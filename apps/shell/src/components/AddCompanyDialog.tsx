import { useState } from 'react';
import { Button, Dialog, Field, Input } from '@basis/design-system';

interface AddCompanyDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (name: string) => Promise<void>;
}

export function AddCompanyDialog({ open, onClose, onSubmit }: AddCompanyDialogProps) {
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const trimmed = name.trim();
  const canSubmit = trimmed.length > 0 && !submitting;

  function handleClose() {
    setName('');
    onClose();
  }

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onSubmit(trimmed);
      setName('');
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title="Add company"
      subtitle="Start with a name — everything else can be filled in later."
      footer={
        <>
          <Button variant="secondary" onClick={handleClose}>Cancel</Button>
          <Button variant="primary" onClick={handleSubmit} disabled={!canSubmit} loading={submitting}>
            Add company
          </Button>
        </>
      }
    >
      <Field label="Company name" required>
        <Input
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') handleSubmit();
          }}
          placeholder="e.g. Gen Digital Inc."
        />
      </Field>
    </Dialog>
  );
}
