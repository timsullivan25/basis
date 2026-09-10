import { useEffect, useState } from 'react';
import { Alert, Button, Card, DataTable, Icon, Select, Tabs } from '@basis/design-system';
import { snapshotRepository, type Company, type ScenarioKey, type Snapshot, type StatementLine } from '../data';
import { getLineRowStyle } from '../components/statements/statementFormatting';
import { formatPeriodValue } from '../components/models/mapping/mappingFormatting';

interface SnapshotViewScreenProps {
  company: Company;
  snapshotId: string;
  onReturnToLive: () => void;
}

/**
 * Read-only viewer for a frozen Snapshot — a sibling screen to ModelWorkspaceScreen, not a mode
 * nested inside it (see AppShell's viewingSnapshotId). Loads the Snapshot itself, never touches
 * modelRepository/scenarioRepository — it's genuinely self-contained, which is exactly why an old
 * snapshot from a since-superseded model still opens cleanly after a re-map or deletion.
 */
export function SnapshotViewScreen({ company, snapshotId, onReturnToLive }: SnapshotViewScreenProps) {
  const [snapshot, setSnapshot] = useState<Snapshot | null | undefined>(undefined);
  const [activeScenarioId, setActiveScenarioId] = useState<ScenarioKey>('base');
  const [tab, setTab] = useState('all');

  useEffect(() => {
    let cancelled = false;
    snapshotRepository.get(snapshotId).then((found) => {
      if (cancelled) return;
      setSnapshot(found ?? null);
    });
    return () => {
      cancelled = true;
    };
    // AppShell keys this screen by snapshotId (see AppShell.tsx), so a new snapshotId always means
    // a fresh mount — this effect only ever runs once per instance, no reset-on-change needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (snapshot === undefined) {
    return <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>Loading…</span>;
  }
  if (!snapshot) {
    return <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>Snapshot not found.</span>;
  }

  const activeCase = snapshot.scenarios.find((s) => s.scenarioId === activeScenarioId) ?? snapshot.scenarios[0];

  const tabs = [
    { value: 'all', label: 'All' },
    ...snapshot.schema.sections.map((section) => ({ value: section.id, label: section.name })),
  ];

  const rows: Array<{ id: string; __group?: string; line?: StatementLine }> = [];
  snapshot.schema.sections.forEach((section) => {
    if (tab !== 'all' && tab !== section.id) return;
    if (!section.lines.length) return;
    rows.push({ id: `group-${section.id}`, __group: section.name });
    section.lines.forEach((line) => rows.push({ id: line.id, line }));
  });

  const columns = [
    {
      key: 'name',
      label: 'Line',
      width: 240,
      render: (_: unknown, row: { line?: StatementLine }) =>
        row.line ? (
          <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', color: 'var(--text-primary)' }}>
            {row.line.name}
          </span>
        ) : null,
    },
    ...snapshot.timeline.map((period, i) => ({
      key: `p${i}`,
      label: period.label,
      numeric: true,
      width: 110,
      background: period.kind === 'projected' ? 'var(--alpha-blue-06)' : undefined,
      render: (_: unknown, row: { line?: StatementLine }) => {
        if (!row.line) return null;
        const error = activeCase?.errors[row.line.id];
        if (error) {
          return (
            <span title={error} style={{ display: 'inline-flex', justifyContent: 'flex-end', width: '100%' }}>
              <Icon name="alert-triangle" size={12} color="var(--text-negative)" />
            </span>
          );
        }
        const value = activeCase?.values[row.line.id]?.[i] ?? null;
        return (
          <span
            style={{
              fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', fontVariantNumeric: 'var(--numeric-tabular)',
              color: value === null ? 'var(--text-disabled)' : 'var(--text-body)',
            }}
          >
            {formatPeriodValue(value, row.line.numberFormat)}
          </span>
        );
      },
    })),
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)', padding: 'var(--gutter)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-6)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-secondary)' }}>{company.name}</span>
          <h1 style={{ fontSize: 'var(--text-2xl)' }}>{snapshot.label}</h1>
        </div>
        <div style={{ flex: '1 1 auto' }} />
        <Button variant="secondary" iconLeft="arrow-left" onClick={onReturnToLive}>
          Return to live model
        </Button>
      </div>

      <Alert
        tone="info"
        icon="camera"
        title={`Viewing snapshot "${snapshot.label}" — read-only`}
      >
        {snapshot.note ? snapshot.note : null}
      </Alert>

      <Tabs
        tabs={tabs}
        value={tab}
        onChange={setTab}
        size="sm"
        actions={
          snapshot.scenarios.length > 1 ? (
            <Select
              size="sm"
              options={snapshot.scenarios.map((s) => ({ value: s.scenarioId, label: s.name }))}
              value={activeScenarioId}
              onChange={(e) => setActiveScenarioId(e.target.value)}
              style={{ width: 180 }}
            />
          ) : null
        }
      />

      <Card padding="none">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey="id"
          rowStyle={(row: { line?: StatementLine }) => (row.line ? getLineRowStyle(row.line) : {})}
          dense
          stickyHeader
          stickyFirstColumn
          maxHeight="calc(100vh - 320px)"
        />
      </Card>
    </div>
  );
}
