import { Button } from '@basis/design-system';
import type { Company } from '../data';

interface SnapshotViewScreenProps {
  company: Company;
  snapshotId: string;
  onReturnToLive: () => void;
}

/**
 * Read-only viewer for a frozen Snapshot — a sibling screen to ModelWorkspaceScreen, not a mode
 * nested inside it (see AppShell's viewingSnapshotId). Stub for now: proves navigation lands
 * correctly. Full content (mode banner, case switcher, Summary/statement tabs, formula
 * inspection) lands in Slices 3-4.
 */
export function SnapshotViewScreen({ company, snapshotId, onReturnToLive }: SnapshotViewScreenProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)', padding: 'var(--gutter)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-secondary)' }}>{company.name}</span>
        <h1 style={{ fontSize: 'var(--text-2xl)' }}>Snapshot {snapshotId}</h1>
      </div>
      <Button variant="secondary" onClick={onReturnToLive}>
        Return to live model
      </Button>
    </div>
  );
}
