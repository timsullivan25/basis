import { useState } from 'react';
import { Button, DataTable, IconButton, Input, Select, Tag } from '@basis/design-system';
import type { LineNumberFormat, LineRowFormat, LineSign, StatementLine, StatementSection } from '../../data';

const ROW_FORMAT_OPTIONS = [
  { value: 'normal', label: 'Normal' },
  { value: 'total', label: 'Total' },
  { value: 'metric', label: 'Metric' },
];

const NUMBER_FORMAT_OPTIONS = [
  { value: 'number', label: 'Number' },
  { value: 'percentage', label: 'Percentage' },
  { value: 'multiple', label: 'Multiple' },
];

const SIGN_OPTIONS = [
  { value: 'natural', label: 'Natural' },
  { value: 'absolute', label: 'Absolute' },
];

interface SectionEditorProps {
  section: StatementSection;
  isFirst: boolean;
  isLast: boolean;
  otherSections: { id: string; name: string }[];
  onRename: (name: string) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
  onAddLine: () => void;
  onUpdateLine: (lineId: string, patch: Partial<StatementLine>) => void;
  onDeleteLine: (lineId: string) => void;
  onMoveLine: (lineId: string, direction: 'up' | 'down') => void;
  onMoveLineToSection: (lineId: string, targetSectionId: string) => void;
}

export function SectionEditor({
  section, isFirst, isLast, otherSections,
  onRename, onMoveUp, onMoveDown, onDelete,
  onAddLine, onUpdateLine, onDeleteLine, onMoveLine, onMoveLineToSection,
}: SectionEditorProps) {
  const [expandedLineId, setExpandedLineId] = useState<string | null>(null);

  const columns = [
    {
      key: 'expand',
      label: '',
      width: 28,
      render: (_: unknown, row: StatementLine) => (
        <IconButton
          icon={expandedLineId === row.id ? 'chevron-down' : 'chevron-right'}
          label={expandedLineId === row.id ? 'Collapse' : 'Expand'}
          size="sm"
          variant="ghost"
        />
      ),
    },
    {
      key: 'name',
      label: 'Line name',
      emphasis: true,
      render: (_: unknown, row: StatementLine) => (
        <div onClick={(e) => e.stopPropagation()}>
          <Input
            size="sm"
            value={row.name}
            onChange={(e) => onUpdateLine(row.id, { name: e.target.value })}
            placeholder="Line name"
          />
        </div>
      ),
    },
    {
      key: 'rowFormat',
      label: 'Row format',
      width: 130,
      render: (_: unknown, row: StatementLine) => (
        <div onClick={(e) => e.stopPropagation()}>
          <Select
            size="sm"
            options={ROW_FORMAT_OPTIONS}
            value={row.rowFormat}
            onChange={(e) => onUpdateLine(row.id, { rowFormat: e.target.value as LineRowFormat })}
          />
        </div>
      ),
    },
    {
      key: 'numberFormat',
      label: 'Number format',
      width: 140,
      render: (_: unknown, row: StatementLine) => (
        <div onClick={(e) => e.stopPropagation()}>
          <Select
            size="sm"
            options={NUMBER_FORMAT_OPTIONS}
            value={row.numberFormat}
            onChange={(e) => onUpdateLine(row.id, { numberFormat: e.target.value as LineNumberFormat })}
          />
        </div>
      ),
    },
    {
      key: 'sign',
      label: 'Sign',
      width: 110,
      render: (_: unknown, row: StatementLine) => (
        <div onClick={(e) => e.stopPropagation()} title="Natural keeps the sign as imported; absolute always stores positive">
          <Select
            size="sm"
            options={SIGN_OPTIONS}
            value={row.sign}
            onChange={(e) => onUpdateLine(row.id, { sign: e.target.value as LineSign })}
          />
        </div>
      ),
    },
    {
      key: 'actions',
      label: '',
      width: 100,
      align: 'right' as const,
      render: (_: unknown, row: StatementLine) => (
        <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-1)' }}>
          <IconButton icon="arrow-up" label="Move line up" size="sm" variant="ghost" onClick={() => onMoveLine(row.id, 'up')} />
          <IconButton icon="arrow-down" label="Move line down" size="sm" variant="ghost" onClick={() => onMoveLine(row.id, 'down')} />
          <IconButton icon="trash-2" label="Delete line" size="sm" variant="ghost" onClick={() => onDeleteLine(row.id)} />
        </div>
      ),
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', background: 'var(--surface-card)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-6)', minHeight: 40, padding: '0 var(--space-8)', borderBottom: '1px solid var(--border-subtle)' }}>
        <Input
          size="sm"
          value={section.name}
          onChange={(e) => onRename(e.target.value)}
          placeholder="Section name"
          style={{ width: 240 }}
        />
        <div style={{ flex: '1 1 auto' }} />
        <IconButton icon="arrow-up" label="Move section up" size="sm" variant="ghost" onClick={onMoveUp} disabled={isFirst} />
        <IconButton icon="arrow-down" label="Move section down" size="sm" variant="ghost" onClick={onMoveDown} disabled={isLast} />
        <IconButton icon="trash-2" label="Delete section" size="sm" variant="ghost" onClick={onDelete} />
      </div>

      {section.lines.length > 0 ? (
        <DataTable
          columns={columns}
          rows={section.lines}
          rowKey="id"
          dense
          expandedKey={expandedLineId}
          onRowClick={(row) => setExpandedLineId(expandedLineId === row.id ? null : row.id)}
          renderDetail={(row: StatementLine) => (
            <LineDetail
              line={row}
              otherSections={otherSections}
              onUpdateLine={onUpdateLine}
              onMoveLineToSection={onMoveLineToSection}
            />
          )}
        />
      ) : (
        <div style={{ padding: 'var(--space-8)', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
          No lines in this section yet.
        </div>
      )}

      <div style={{ padding: 'var(--space-5) var(--space-8)', borderTop: '1px solid var(--border-subtle)' }}>
        <Button size="sm" variant="ghost" iconLeft="plus" onClick={onAddLine}>
          Add line
        </Button>
      </div>
    </div>
  );
}

interface LineDetailProps {
  line: StatementLine;
  otherSections: { id: string; name: string }[];
  onUpdateLine: (lineId: string, patch: Partial<StatementLine>) => void;
  onMoveLineToSection: (lineId: string, targetSectionId: string) => void;
}

function LineDetail({ line, otherSections, onUpdateLine, onMoveLineToSection }: LineDetailProps) {
  const [aliasDraft, setAliasDraft] = useState('');

  function addAlias() {
    const trimmed = aliasDraft.trim();
    if (!trimmed || line.aliases.includes(trimmed)) return;
    onUpdateLine(line.id, { aliases: [...line.aliases, trimmed] });
    setAliasDraft('');
  }

  function removeAlias(alias: string) {
    onUpdateLine(line.id, { aliases: line.aliases.filter((a) => a !== alias) });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)', maxWidth: 560 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <span style={{ fontSize: 'var(--text-2xs)', fontWeight: 'var(--weight-semibold)', letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
          Formula
        </span>
        <Input
          size="sm"
          value={line.formula}
          onChange={(e) => onUpdateLine(line.id, { formula: e.target.value })}
          placeholder="e.g. revenue - cogs"
          mono
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <span style={{ fontSize: 'var(--text-2xs)', fontWeight: 'var(--weight-semibold)', letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
          Aliases
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          {line.aliases.map((alias) => (
            <Tag key={alias} onRemove={() => removeAlias(alias)}>
              {alias}
            </Tag>
          ))}
          <Input
            size="sm"
            value={aliasDraft}
            onChange={(e) => setAliasDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addAlias();
              }
            }}
            placeholder="Add alias"
            fullWidth={false}
            style={{ width: 160 }}
          />
          <IconButton icon="plus" label="Add alias" size="sm" variant="ghost" onClick={addAlias} />
        </div>
      </div>

      {otherSections.length > 0 ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
          <span style={{ fontSize: 'var(--text-2xs)', fontWeight: 'var(--weight-semibold)', letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
            Move to
          </span>
          <Select
            size="sm"
            fullWidth={false}
            style={{ width: 200 }}
            value=""
            options={[{ value: '', label: 'Select a section…' }, ...otherSections.map((s) => ({ value: s.id, label: s.name }))]}
            onChange={(e) => {
              if (e.target.value) onMoveLineToSection(line.id, e.target.value);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
