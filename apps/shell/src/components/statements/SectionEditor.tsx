import { useState } from 'react';
import { Badge, Button, DataTable, Icon, IconButton, Input, Select, Tag } from '@basis/design-system';
import type { DriverDefinition, LineNumberFormat, LineRowFormat, LineSign, ProjectionMethod, StatementLine, StatementSection } from '../../data';
import { collectRefIds, formatFormula, isCalculated, type NameIndex } from '../../lib/engine/resolve';
import { FormulaInput } from './FormulaInput';
import { NUMBER_FORMAT_META, ROW_FORMAT_META, SIGN_META, getLineRowStyle, getRequiredMeta } from './statementFormatting';

const ROW_FORMAT_OPTIONS = Object.entries(ROW_FORMAT_META).map(([value, meta]) => ({ value, label: meta.label }));
const NUMBER_FORMAT_OPTIONS = Object.entries(NUMBER_FORMAT_META).map(([value, meta]) => ({ value, label: meta.label }));
const SIGN_OPTIONS = Object.entries(SIGN_META).map(([value, meta]) => ({ value, label: meta.label }));
const REQUIRED_OPTIONS = [
  { value: 'required', label: 'Required' },
  { value: 'optional', label: 'Optional' },
];

/** What the "Projection method" control in LineDetail commits — mirrors StatementLine.projection
 *  plus the 'none' case, and carries a basisLineId only for the two methods that need one. */
export type ProjectionSelection =
  | { method: 'none' }
  | { method: 'flat' }
  | { method: 'growth' }
  | { method: 'percent-of' | 'days-of'; basisLineId: string };

/** A statement section's lines, for populating a basis-line picker grouped the same way the
 *  statement itself is organized — the same reason a long <Select> benefits from <optgroup>. */
export interface LineGroup {
  sectionName: string;
  lines: { id: string; name: string }[];
}

const PROJECTION_METHOD_OPTIONS: { value: 'none' | 'flat' | ProjectionMethod; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'flat', label: 'Flat (holds last actual)' },
  { value: 'growth', label: 'Growth Rate' },
  { value: 'percent-of', label: 'Percent of…' },
  { value: 'days-of', label: 'Days of…' },
];

interface SectionEditorProps {
  section: StatementSection;
  isFirst: boolean;
  isLast: boolean;
  otherSections: { id: string; name: string }[];
  lineGroups: LineGroup[];
  drivers: DriverDefinition[];
  nameIndex: NameIndex;
  onRename: (name: string) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
  onAddLine: () => void;
  onUpdateLine: (lineId: string, patch: Partial<StatementLine>) => void;
  onSetProjection: (lineId: string, selection: ProjectionSelection) => void;
  onDeleteLine: (lineId: string) => void;
  onMoveLine: (lineId: string, direction: 'up' | 'down') => void;
  onMoveLineToSection: (lineId: string, targetSectionId: string) => void;
}

export function SectionEditor({
  section, isFirst, isLast, otherSections, lineGroups, drivers, nameIndex,
  onRename, onMoveUp, onMoveDown, onDelete,
  onAddLine, onUpdateLine, onSetProjection, onDeleteLine, onMoveLine, onMoveLineToSection,
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
      render: (_: unknown, row: StatementLine) => {
        const hasFormula = isCalculated(row);
        // A stored formula is always syntactically valid (it was compiled before being saved) —
        // the one way it can go stale is a reference to a line deleted since, so that's the
        // only thing worth flagging here rather than re-validating text that no longer exists.
        // Checked regardless of projection — a broken reference matters whether the formula was
        // hand-written or generated, but the informational sigma icon below is deliberately not:
        // it's only for a genuine structural formula, since a projection-carrying line already
        // shows its (non-"Calculated") status in the Required column and its formula in the
        // expanded row detail — showing the icon on every projected line too would just be noise.
        const dangling = hasFormula ? collectRefIds(row.formula!).filter((id) => !nameIndex.describe(id)) : [];
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            {row.name || <span style={{ color: 'var(--text-tertiary)' }}>Untitled line</span>}
            {dangling.length > 0 ? (
              <span title="References a line that no longer exists">
                <Icon name="alert-triangle" size={12} color="var(--text-negative)" />
              </span>
            ) : hasFormula && !row.projection ? (
              <span title={`Formula: ${formatFormula(row.formula, nameIndex)}`}>
                <Icon name="sigma" size={12} color="var(--text-tertiary)" />
              </span>
            ) : null}
            {row.aliases.length > 0 ? (
              <span
                title={`Aliases: ${row.aliases.join(', ')}`}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 2, color: 'var(--text-tertiary)' }}
              >
                <Icon name="tags" size={12} color="var(--text-tertiary)" />
                <span style={{ fontSize: 'var(--text-3xs)', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'var(--numeric-tabular)' }}>
                  {row.aliases.length}
                </span>
              </span>
            ) : null}
          </span>
        );
      },
      renderEdit: (_: unknown, row: StatementLine) => (
        <Input
          size="sm"
          autoFocus
          value={row.name}
          onChange={(e) => onUpdateLine(row.id, { name: e.target.value })}
          placeholder="Line name"
        />
      ),
    },
    {
      key: 'required',
      label: 'Required',
      width: 120,
      // A line with a projection method still needs a real mapped value for actual periods —
      // only a genuine structural formula (no projection attached) locks this.
      canEdit: (row: StatementLine) => !isCalculated(row) || Boolean(row.projection),
      render: (_: unknown, row: StatementLine) => {
        const meta = getRequiredMeta(row);
        return (
          <Badge tone={meta.tone} size="sm">
            {meta.label}
          </Badge>
        );
      },
      renderEdit: (_: unknown, row: StatementLine) => (
        <Select
          size="sm"
          autoFocus
          options={REQUIRED_OPTIONS}
          value={row.required ? 'required' : 'optional'}
          onChange={(e) => onUpdateLine(row.id, { required: e.target.value === 'required' })}
        />
      ),
    },
    {
      key: 'rowFormat',
      label: 'Row format',
      width: 130,
      render: (_: unknown, row: StatementLine) => (
        <Badge tone={ROW_FORMAT_META[row.rowFormat].tone} size="sm">
          {ROW_FORMAT_META[row.rowFormat].label}
        </Badge>
      ),
      renderEdit: (_: unknown, row: StatementLine) => (
        <Select
          size="sm"
          autoFocus
          options={ROW_FORMAT_OPTIONS}
          value={row.rowFormat}
          onChange={(e) => onUpdateLine(row.id, { rowFormat: e.target.value as LineRowFormat })}
        />
      ),
    },
    {
      key: 'numberFormat',
      label: 'Number format',
      width: 140,
      render: (_: unknown, row: StatementLine) => (
        <Badge tone={NUMBER_FORMAT_META[row.numberFormat].tone} size="sm">
          {NUMBER_FORMAT_META[row.numberFormat].label}
        </Badge>
      ),
      renderEdit: (_: unknown, row: StatementLine) => (
        <Select
          size="sm"
          autoFocus
          options={NUMBER_FORMAT_OPTIONS}
          value={row.numberFormat}
          onChange={(e) => onUpdateLine(row.id, { numberFormat: e.target.value as LineNumberFormat })}
        />
      ),
    },
    {
      key: 'sign',
      label: 'Sign',
      width: 110,
      render: (_: unknown, row: StatementLine) => (
        <Badge tone={SIGN_META[row.sign].tone} size="sm">
          {SIGN_META[row.sign].label}
        </Badge>
      ),
      renderEdit: (_: unknown, row: StatementLine) => (
        <Select
          size="sm"
          autoFocus
          options={SIGN_OPTIONS}
          value={row.sign}
          onChange={(e) => onUpdateLine(row.id, { sign: e.target.value as LineSign })}
        />
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
        <SectionName name={section.name} onRename={onRename} />
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
          rowStyle={getLineRowStyle}
          expandedKey={expandedLineId}
          onRowClick={(row) => setExpandedLineId(expandedLineId === row.id ? null : row.id)}
          renderDetail={(row: StatementLine) => (
            <LineDetail
              line={row}
              otherSections={otherSections}
              lineGroups={lineGroups}
              drivers={drivers}
              nameIndex={nameIndex}
              onUpdateLine={onUpdateLine}
              onSetProjection={onSetProjection}
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

function SectionName({ name, onRename }: { name: string; onRename: (name: string) => void }) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <Input
        size="sm"
        autoFocus
        value={name}
        onChange={(e) => onRename(e.target.value)}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur();
        }}
        placeholder="Section name"
        style={{ width: 240 }}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      style={{
        padding: '0 var(--space-2)', margin: '0 calc(-1 * var(--space-2))', border: 'none', borderRadius: 'var(--radius-sm)',
        background: 'transparent', cursor: 'pointer', textAlign: 'left',
        fontFamily: 'var(--font-sans)', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)',
        letterSpacing: 'var(--tracking-heading)', color: name ? 'var(--text-primary)' : 'var(--text-tertiary)',
        transition: 'var(--transition-control)',
      }}
    >
      {name || 'Untitled section'}
    </button>
  );
}

interface LineDetailProps {
  line: StatementLine;
  otherSections: { id: string; name: string }[];
  lineGroups: LineGroup[];
  drivers: DriverDefinition[];
  nameIndex: NameIndex;
  onUpdateLine: (lineId: string, patch: Partial<StatementLine>) => void;
  onSetProjection: (lineId: string, selection: ProjectionSelection) => void;
  onMoveLineToSection: (lineId: string, targetSectionId: string) => void;
}

function methodOf(line: StatementLine): 'none' | 'flat' | ProjectionMethod {
  return line.projection?.method ?? 'none';
}

function needsBasisLine(method: 'none' | 'flat' | ProjectionMethod): method is 'percent-of' | 'days-of' {
  return method === 'percent-of' || method === 'days-of';
}

function LineDetail({ line, otherSections, lineGroups, drivers, nameIndex, onUpdateLine, onSetProjection, onMoveLineToSection }: LineDetailProps) {
  const [aliasDraft, setAliasDraft] = useState('');
  // A method that needs a basis line isn't committed to the line until one is picked — held here
  // locally in the meantime rather than writing a half-configured projection onto the line.
  const [pendingMethod, setPendingMethod] = useState<'percent-of' | 'days-of' | null>(null);

  const currentMethod = pendingMethod ?? methodOf(line);
  const currentDriverId = line.projection && 'driverId' in line.projection ? line.projection.driverId : undefined;
  const currentDriver = drivers.find((d) => d.id === currentDriverId);
  // Blank while a new basis-needing method is pending (nothing chosen yet); otherwise reflects
  // the already-committed driver's basis line, so reopening a configured line shows it correctly.
  const basisLineId = pendingMethod ? '' : (currentDriver?.basisLineId ?? '');

  function handleMethodChange(method: 'none' | 'flat' | ProjectionMethod) {
    if (needsBasisLine(method)) {
      setPendingMethod(method);
      return;
    }
    setPendingMethod(null);
    onSetProjection(line.id, method === 'none' ? { method: 'none' } : method === 'flat' ? { method: 'flat' } : { method: 'growth' });
  }

  function handleBasisLineChange(nextBasisLineId: string) {
    if (!needsBasisLine(currentMethod) || !nextBasisLineId) return;
    onSetProjection(line.id, { method: currentMethod, basisLineId: nextBasisLineId });
    setPendingMethod(null);
  }

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
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-6)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <span style={{ fontSize: 'var(--text-2xs)', fontWeight: 'var(--weight-semibold)', letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
            Projection method
          </span>
          <Select
            size="sm"
            fullWidth={false}
            style={{ width: 220 }}
            options={PROJECTION_METHOD_OPTIONS}
            value={currentMethod}
            onChange={(e) => handleMethodChange(e.target.value as 'none' | 'flat' | ProjectionMethod)}
          />
        </div>

        {needsBasisLine(currentMethod) ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <span style={{ fontSize: 'var(--text-2xs)', fontWeight: 'var(--weight-semibold)', letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
              Basis line
            </span>
            <Select
              size="sm"
              fullWidth={false}
              style={{ width: 220 }}
              value={basisLineId}
              options={[{ value: '', label: 'Select a line…' }]}
              groups={lineGroups
                .map((g) => ({
                  label: g.sectionName,
                  options: g.lines.filter((l) => l.id !== line.id).map((l) => ({ value: l.id, label: l.name })),
                }))
                .filter((g) => g.options.length > 0)}
              onChange={(e) => handleBasisLineChange(e.target.value)}
            />
          </div>
        ) : null}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <span style={{ fontSize: 'var(--text-2xs)', fontWeight: 'var(--weight-semibold)', letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
          Formula
        </span>
        {currentMethod === 'none' ? (
          <FormulaInput
            value={line.formula}
            onChange={(formula) => onUpdateLine(line.id, { formula })}
            nameIndex={nameIndex}
            ownLineId={line.id}
          />
        ) : currentMethod === 'flat' ? (
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>Holds the last actual value.</span>
        ) : pendingMethod ? (
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>Choose a basis line to generate the formula.</span>
        ) : (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
            {formatFormula(line.formula, nameIndex)}
          </span>
        )}
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
