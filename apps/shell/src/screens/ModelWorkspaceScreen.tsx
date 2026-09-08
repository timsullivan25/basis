import { useEffect, useState } from 'react';
import { Card, DataTable, Tabs } from '@basis/design-system';
import { modelRepository, statementSchemaRepository, type Company, type Model, type StatementLine, type StatementSchema } from '../data';
import { getLineRowStyle } from '../components/statements/statementFormatting';
import { formatPeriodValue } from '../components/models/mapping/mappingFormatting';

interface ModelWorkspaceScreenProps {
  company: Company;
}

/**
 * The current model's live view — statement sub-tabs over a period grid reading the model's
 * persisted historicals. Purely today's model; no history/read-only mode (that's phase 07, once
 * Snapshot exists) and no computed/projected values (that's phase 03's engine) — calculated
 * lines render an em dash rather than a number that doesn't exist yet.
 */
export function ModelWorkspaceScreen({ company }: ModelWorkspaceScreenProps) {
  const [model, setModel] = useState<Model | null | undefined>(undefined);
  const [schema, setSchema] = useState<StatementSchema | null>(null);
  const [tab, setTab] = useState('all');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const existingModel = await modelRepository.getForCompany(company.id);
      if (cancelled) return;
      const existingSchema = existingModel ? await statementSchemaRepository.get(existingModel.statementSchemaId) : null;
      if (cancelled) return;
      setModel(existingModel ?? null);
      setSchema(existingSchema ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [company.id]);

  if (model === undefined) {
    return <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>Loading…</span>;
  }

  if (!model || !schema) {
    return <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>No model to show.</span>;
  }

  const tabs = [
    { value: 'all', label: 'All' },
    ...schema.sections.map((section) => ({ value: section.id, label: section.name })),
  ];

  const rows: Array<{ id: string; __group?: string; line?: StatementLine }> = [];
  schema.sections.forEach((section) => {
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
    ...model.timeline.map((period, i) => ({
      key: `p${i}`,
      label: period.label,
      numeric: true,
      width: 110,
      render: (_: unknown, row: { line?: StatementLine }) => {
        if (!row.line) return null;
        const value = row.line.formula.trim() ? null : (model.historicals[row.line.id]?.[i] ?? null);
        return (
          <span
            style={{
              fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', fontVariantNumeric: 'var(--numeric-tabular)',
              color: value === null ? 'var(--text-disabled)' : 'var(--text-body)',
            }}
          >
            {formatPeriodValue(value)}
          </span>
        );
      },
    })),
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)', padding: 'var(--gutter)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-secondary)' }}>{company.name}</span>
        <h1 style={{ fontSize: 'var(--text-2xl)' }}>{model.name}</h1>
      </div>

      <Tabs tabs={tabs} value={tab} onChange={setTab} size="sm" />

      <Card padding="none">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey="id"
          rowStyle={(row: { line?: StatementLine }) => (row.line ? getLineRowStyle(row.line) : {})}
          dense
          stickyHeader
          stickyFirstColumn
          maxHeight="calc(100vh - 260px)"
        />
      </Card>
    </div>
  );
}
