// TEMPORARY test data — see ./README.md. Delete this whole folder (and its one use in
// PortfolioScreen.tsx) to remove it.
import { useState } from 'react';
import { Button, Popover } from '@basis/design-system';
import type { Company } from '../../data';
import { buildDummyWorkbookFile, removeDummyIssuers, seedDummyIssuer } from './seedDummyIssuer';

interface DummyDataControlsProps {
  onCreated: (company: Company) => void;
  onChanged: () => void;
}

export function DummyDataControls({ onCreated, onChanged }: DummyDataControlsProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function download() {
    const file = await buildDummyWorkbookFile();
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Popover
      placement="bottom-end"
      trigger={
        <Button variant="ghost" iconLeft="flask-conical" disabled={busy}>
          {busy ? 'Working…' : 'Test data'}
        </Button>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', padding: 'var(--space-4)', width: 260 }}>
        <Button variant="secondary" iconLeft="plus" disabled={busy} onClick={() => void run(async () => onCreated(await seedDummyIssuer()))}>
          Create dummy issuer
        </Button>
        <Button variant="secondary" iconLeft="download" disabled={busy} onClick={() => void run(download)}>
          Download dummy workbook
        </Button>
        <Button variant="danger" iconLeft="trash-2" disabled={busy} onClick={() => void run(async () => { await removeDummyIssuers(); onChanged(); })}>
          Remove all dummy issuers
        </Button>
        {error ? <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-negative, var(--text-secondary))' }}>{error}</span> : null}
      </div>
    </Popover>
  );
}
