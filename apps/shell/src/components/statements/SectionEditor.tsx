import { useState, type CSSProperties } from 'react';
import { Badge, Button, DataTable, Icon, IconButton, Input, Select, SegmentedControl, Switch, Tag } from '@basis/design-system';
import type { DriverDefinition, LineNumberFormat, LineRowFormat, LineSign, ProjectionMethod, StatementLine, StatementSchema, StatementSection } from '../../data';
import { collectRefIds, formatFormula, isCalculated, type NameIndex } from '../../lib/engine/resolve';
import { buildSectionRows, type SectionRow } from '../../lib/statementRowBuilder';
import type { InstanceTarget } from '../models/instances/projectionMethod';
import { FormulaInput } from './FormulaInput';
import { DEFAULT_CHECK_TOLERANCE, NUMBER_FORMAT_META, ROW_FORMAT_META, SIGN_META, getLineRowStyle, getRequiredMeta } from './statementFormatting';
import { LineSettingsPanel, type LineSettingsSection } from '../common/LineSettingsPanel';
import { DebtTranchePropertiesEditor, NumberInput, PercentInput } from '../models/instances/DebtTranchePropertiesEditor';
import type { DebtTrancheProperties } from '../../data';

const ROW_FORMAT_OPTIONS = Object.entries(ROW_FORMAT_META).map(([value, meta]) => ({ value, label: meta.label }));
const NUMBER_FORMAT_OPTIONS = Object.entries(NUMBER_FORMAT_META).map(([value, meta]) => ({ value, label: meta.label }));
const SIGN_OPTIONS = Object.entries(SIGN_META).map(([value, meta]) => ({ value, label: meta.label }));
const REQUIRED_OPTIONS = [
  { value: 'required', label: 'Required' },
  { value: 'optional', label: 'Optional' },
];

/** What the "Projection method" control in LineSettingsPanelContent commits — mirrors
 *  StatementLine.projection plus the 'none' case, and carries a basisLineId only for the two
 *  methods that need one. Deliberately the same simplified set for a top-level line and a child
 *  line here — 'roll-off'/'actual' (child-only, mapping-time concepts that reference reported
 *  values) aren't offered by this editor; a child already on one of those shows a read-only note
 *  instead (see LineSettingsPanelContent). */
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
  schema: StatementSchema;
  section: StatementSection;
  isFirst: boolean;
  isLast: boolean;
  nameIndex: NameIndex;
  /** The row currently shown in the shared side panel (owned by the parent screen, since only
   *  one panel exists across every section's own DataTable) — highlights that row here. A plain
   *  line/section id for a top-level line, or `child-<id>` for a sub-line/KPI (see
   *  lib/statementRowBuilder.ts). */
  selectedLineId: string | null;
  onSelectLine: (rowId: string) => void;
  onAddSubLine: (target: InstanceTarget) => void;
  onRename: (name: string) => void;
  /** KPI-style sections only — see StatementSection.allowsFreeformLines' own doc comment. A
   *  section with real lines rarely needs this; it exists for a section holding nothing BUT
   *  freestanding, model-level instance rows. */
  onSetAllowsFreeformLines: (next: boolean) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
  onAddLine: () => void;
  onUpdateLine: (lineId: string, patch: Partial<StatementLine>) => void;
  onDeleteLine: (lineId: string) => void;
  onMoveLine: (lineId: string, direction: 'up' | 'down') => void;
}

export function SectionEditor({
  schema, section, isFirst, isLast, nameIndex,
  selectedLineId, onSelectLine, onAddSubLine,
  onRename, onSetAllowsFreeformLines, onMoveUp, onMoveDown, onDelete,
  onAddLine, onUpdateLine, onDeleteLine, onMoveLine,
}: SectionEditorProps) {
  const rows = buildSectionRows(schema, section);

  const columns = [
    {
      key: 'expand',
      label: '',
      width: 28,
      render: (_: unknown, row: SectionRow) =>
        row.line || row.childLine ? (
          <IconButton
            icon={selectedLineId === row.id ? 'chevron-down' : 'chevron-right'}
            label={selectedLineId === row.id ? 'Collapse' : 'Expand'}
            size="sm"
            variant="ghost"
          />
        ) : null,
    },
    {
      key: 'name',
      label: 'Line name',
      emphasis: true,
      canEdit: (row: SectionRow) => Boolean(row.line),
      render: (_: unknown, row: SectionRow) => {
        if (row.addInstanceTarget) {
          return (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-medium)', color: 'var(--text-brand)' }}>
              <Icon name="plus" size={12} color="var(--text-brand)" />
              Add {row.addInstanceTarget.kind === 'section' ? 'KPI' : 'sub-line'}
            </span>
          );
        }
        if (row.childLine) {
          const name = row.childLine.name.trim();
          return (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-3)', paddingLeft: 'var(--space-7)' }}>
              <Icon name="corner-down-right" size={11} color="var(--text-tertiary)" />
              <span style={{ fontSize: 'var(--text-sm)', color: name ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>
                {name || 'Untitled — click to name'}
              </span>
            </span>
          );
        }
        if (!row.line) return null;
        const hasFormula = isCalculated(row.line);
        // A stored formula is always syntactically valid (it was compiled before being saved) —
        // the one way it can go stale is a reference to a line deleted since, so that's the
        // only thing worth flagging here rather than re-validating text that no longer exists.
        // Checked regardless of projection — a broken reference matters whether the formula was
        // hand-written or generated, but the informational sigma icon below is deliberately not:
        // it's only for a genuine structural formula, since a projection-carrying line already
        // shows its (non-"Calculated") status in the Required column and its formula in the
        // expanded row detail — showing the icon on every projected line too would just be noise.
        const dangling = hasFormula ? collectRefIds(row.line.formula!).filter((id) => !nameIndex.describe(id)) : [];
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            {row.line.name || <span style={{ color: 'var(--text-tertiary)' }}>Untitled line</span>}
            {dangling.length > 0 ? (
              <span title="References a line that no longer exists">
                <Icon name="alert-triangle" size={12} color="var(--text-negative)" />
              </span>
            ) : hasFormula && !row.line.projection ? (
              <span title={`Formula: ${formatFormula(row.line.formula, nameIndex)}`}>
                <Icon name="sigma" size={12} color="var(--text-tertiary)" />
              </span>
            ) : null}
            {row.line.aliases.length > 0 ? (
              <span
                title={`Aliases: ${row.line.aliases.join(', ')}`}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 2, color: 'var(--text-tertiary)' }}
              >
                <Icon name="tags" size={12} color="var(--text-tertiary)" />
                <span style={{ fontSize: 'var(--text-3xs)', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'var(--numeric-tabular)' }}>
                  {row.line.aliases.length}
                </span>
              </span>
            ) : null}
          </span>
        );
      },
      renderEdit: (_: unknown, row: SectionRow) =>
        row.line ? (
          <Input
            size="sm"
            autoFocus
            selectOnFocus
            value={row.line.name}
            onChange={(e) => onUpdateLine(row.line!.id, { name: e.target.value })}
            placeholder="Line name"
          />
        ) : null,
    },
    {
      key: 'required',
      label: 'Required',
      width: 120,
      // A line with a projection method still needs a real mapped value for actual periods —
      // only a genuine structural formula (no projection attached) locks this. Only a top-level
      // line shows this at all — a child/KPI's status lives in the mapping screen instead.
      canEdit: (row: SectionRow) => Boolean(row.line) && (!isCalculated(row.line!) || Boolean(row.line!.projection)),
      render: (_: unknown, row: SectionRow) => {
        if (!row.line) return null;
        const meta = getRequiredMeta(row.line);
        return (
          <Badge tone={meta.tone} size="sm">
            {meta.label}
          </Badge>
        );
      },
      renderEdit: (_: unknown, row: SectionRow) =>
        row.line ? (
          <Select
            size="sm"
            autoFocus
            options={REQUIRED_OPTIONS}
            value={row.line.required ? 'required' : 'optional'}
            onChange={(e) => onUpdateLine(row.line!.id, { required: e.target.value === 'required' })}
          />
        ) : null,
    },
    {
      key: 'rowFormat',
      label: 'Row format',
      width: 130,
      canEdit: (row: SectionRow) => Boolean(row.line),
      render: (_: unknown, row: SectionRow) =>
        row.line ? (
          <Badge tone={ROW_FORMAT_META[row.line.rowFormat].tone} size="sm">
            {ROW_FORMAT_META[row.line.rowFormat].label}
          </Badge>
        ) : null,
      renderEdit: (_: unknown, row: SectionRow) =>
        row.line ? (
          <Select
            size="sm"
            autoFocus
            options={ROW_FORMAT_OPTIONS}
            value={row.line.rowFormat}
            onChange={(e) => onUpdateLine(row.line!.id, { rowFormat: e.target.value as LineRowFormat })}
          />
        ) : null,
    },
    {
      key: 'numberFormat',
      label: 'Number format',
      width: 140,
      canEdit: (row: SectionRow) => Boolean(row.line),
      render: (_: unknown, row: SectionRow) =>
        row.line ? (
          <Badge tone={NUMBER_FORMAT_META[row.line.numberFormat].tone} size="sm">
            {NUMBER_FORMAT_META[row.line.numberFormat].label}
          </Badge>
        ) : null,
      renderEdit: (_: unknown, row: SectionRow) =>
        row.line ? (
          <Select
            size="sm"
            autoFocus
            options={NUMBER_FORMAT_OPTIONS}
            value={row.line.numberFormat}
            onChange={(e) => onUpdateLine(row.line!.id, { numberFormat: e.target.value as LineNumberFormat })}
          />
        ) : null,
    },
    {
      key: 'sign',
      label: 'Sign',
      width: 110,
      canEdit: (row: SectionRow) => Boolean(row.line),
      render: (_: unknown, row: SectionRow) =>
        row.line ? (
          <Badge tone={SIGN_META[row.line.sign].tone} size="sm">
            {SIGN_META[row.line.sign].label}
          </Badge>
        ) : null,
      renderEdit: (_: unknown, row: SectionRow) =>
        row.line ? (
          <Select
            size="sm"
            autoFocus
            options={SIGN_OPTIONS}
            value={row.line.sign}
            onChange={(e) => onUpdateLine(row.line!.id, { sign: e.target.value as LineSign })}
          />
        ) : null,
    },
    {
      key: 'actions',
      label: '',
      width: 100,
      align: 'right' as const,
      render: (_: unknown, row: SectionRow) =>
        row.line ? (
          <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-1)' }}>
            <IconButton icon="arrow-up" label="Move line up" size="sm" variant="ghost" onClick={() => onMoveLine(row.line!.id, 'up')} />
            <IconButton icon="arrow-down" label="Move line down" size="sm" variant="ghost" onClick={() => onMoveLine(row.line!.id, 'down')} />
            <IconButton icon="trash-2" label="Delete line" size="sm" variant="ghost" onClick={() => onDeleteLine(row.line!.id)} />
          </div>
        ) : null,
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', background: 'var(--surface-card)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-6)', minHeight: 40, padding: '0 var(--space-8)', borderBottom: '1px solid var(--border-subtle)' }}>
        <SectionName name={section.name} onRename={onRename} />
        <div style={{ flex: '1 1 auto' }} />
        <Switch
          size="sm"
          label="Freeform lines"
          checked={section.allowsFreeformLines ?? false}
          onChange={onSetAllowsFreeformLines}
        />
        <IconButton icon="arrow-up" label="Move section up" size="sm" variant="ghost" onClick={onMoveUp} disabled={isFirst} />
        <IconButton icon="arrow-down" label="Move section down" size="sm" variant="ghost" onClick={onMoveDown} disabled={isLast} />
        <IconButton icon="trash-2" label="Delete section" size="sm" variant="ghost" onClick={onDelete} />
      </div>

      {rows.length > 0 ? (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey="id"
          dense
          rowStyle={(row: SectionRow) => (row.line ? getLineRowStyle(row.line) : row.childLine ? getLineRowStyle(row.childLine) : {})}
          expandedKey={selectedLineId}
          onRowClick={(row: SectionRow) => {
            if (row.addInstanceTarget) {
              onAddSubLine(row.addInstanceTarget);
              return;
            }
            if (row.line || row.childLine) onSelectLine(row.id);
          }}
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
        selectOnFocus
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

export interface LineSettingsPanelContentProps {
  line: StatementLine;
  /** True for a sub-line/KPI (StatementLine.parentLineId set) — hides "Allow sub-lines"/"Move to
   *  section" (a child can't itself have children, and doesn't move independently of its parent),
   *  shows a read-only "inherited from parent" debt note instead of an editable toggle, and adds
   *  a "Delete sub-line/KPI" footer action. */
  isChild: boolean;
  /** Only meaningful when isChild — a freeform section's child is a KPI, an ordinary section's is
   *  a sub-line; changes the footer button's wording only. */
  isKpi?: boolean;
  /** Whether this line's effective kind is 'debt' (own or, for a child, inherited from its
   *  parent — see lib/statementLineChildren.ts's effectiveLineKind) — shows the Debt tranche
   *  section when true. */
  isDebtLine: boolean;
  debtProperties?: DebtTrancheProperties;
  onChangeDebtProperties: (patch: Partial<DebtTrancheProperties>) => void;
  otherSections: { id: string; name: string }[];
  lineGroups: LineGroup[];
  drivers: DriverDefinition[];
  nameIndex: NameIndex;
  onUpdateLine: (lineId: string, patch: Partial<StatementLine>) => void;
  onSetProjection: (lineId: string, selection: ProjectionSelection) => void;
  onMoveLineToSection: (lineId: string, targetSectionId: string) => void;
  onDeleteChildLine?: (lineId: string) => void;
  onClose: () => void;
  style?: CSSProperties;
}

function methodOf(line: StatementLine): 'none' | 'flat' | ProjectionMethod {
  return line.projection?.method ?? 'none';
}

function needsBasisLine(method: 'none' | 'flat' | ProjectionMethod): method is 'percent-of' | 'days-of' {
  return method === 'percent-of' || method === 'days-of';
}

/** A method this simplified editor doesn't offer at all — reachable only via the mapping screen's
 *  own ProjectionMethodEditor (roll-off/actual read reported values that don't exist yet at
 *  schema-definition time). Shown as a read-only note instead of a Select with an out-of-range
 *  value, so switching it away can't silently skip the roll-off-contra cleanup setChildProjection
 *  would otherwise do. */
function isSchemaEditorMethod(method: string): method is 'none' | 'flat' | ProjectionMethod {
  return method === 'none' || method === 'flat' || method === 'growth' || method === 'percent-of' || method === 'days-of';
}

const DEFAULT_OPEN_SECTIONS = ['projection', 'structure', 'debt', 'formula', 'check', 'aliases'];

const LINE_TYPE_OPTIONS = [
  { value: 'normal', label: 'Normal' },
  { value: 'debt', label: 'Debt' },
  { value: 'check', label: 'Check' },
];

/** The side panel shown for whichever line (or sub-line/KPI) is selected in any of a schema's
 *  sections — rendered once by the parent screen (StatementDefinitionsScreen, or the model
 *  workspace's own schema-edit mode), not per-SectionEditor, since only one line can be selected
 *  across the whole schema at a time. Groups the same controls SectionEditor used to show inline
 *  into collapsible sections so a line with a lot going on (e.g. a debt-kind line's projection +
 *  structure + tranche properties) doesn't require scrolling a giant expanded row. */
export function LineSettingsPanelContent({
  line, isChild, isKpi, isDebtLine, debtProperties, onChangeDebtProperties,
  otherSections, lineGroups, drivers, nameIndex, onUpdateLine, onSetProjection, onMoveLineToSection, onDeleteChildLine, onClose, style,
}: LineSettingsPanelContentProps) {
  const [aliasDraft, setAliasDraft] = useState('');
  // A method that needs a basis line isn't committed to the line until one is picked — held here
  // locally in the meantime rather than writing a half-configured projection onto the line.
  const [pendingMethod, setPendingMethod] = useState<'percent-of' | 'days-of' | null>(null);
  const [openKeys, setOpenKeys] = useState<string[]>(DEFAULT_OPEN_SECTIONS);

  const rawMethod = methodOf(line);
  const currentMethod = pendingMethod ?? (isSchemaEditorMethod(rawMethod) ? rawMethod : 'none');
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

  function toggleSection(key: string) {
    setOpenKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  // A top-level line picks ONE of three types up front — what follows is just which sections
  // that implies, not a pile of independent toggles (isDebtLine/isChild aside) to reconcile in
  // your head. A child never picks its own (kind is always inherited from its parent — see
  // effectiveLineKind's own doc comment), and 'check' never applies to one at all: a check line
  // never offers "Allow sub-lines", so it can never have children to inherit into.
  const lineType: 'normal' | 'debt' | 'check' = isChild
    ? (isDebtLine ? 'debt' : 'normal')
    : line.lineKind === 'debt'
      ? 'debt'
      : line.lineKind === 'check'
        ? 'check'
        : 'normal';

  function handleLineTypeChange(next: 'normal' | 'debt' | 'check') {
    onUpdateLine(line.id, { lineKind: next === 'normal' ? undefined : next });
  }

  // Shared between a child's own Projection section (which also carries its name field, the one
  // place a freshly-created sub-line/KPI gets named) and a top-level Normal line's — Debt and
  // Check skip Projection entirely below (a debt-kind line's value comes from the Debt Schedule,
  // never a projection method picked here; a check is always a hand-written formula).
  const projectionControls = !isSchemaEditorMethod(rawMethod) ? (
    <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
      Uses a mapping-time projection method ({rawMethod}) — change it from the mapping screen instead.
    </p>
  ) : (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <span style={{ fontSize: 'var(--text-2xs)', fontWeight: 'var(--weight-semibold)', letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
          Projection method
        </span>
        <Select
          size="sm"
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
            value={basisLineId}
            options={[{ value: '', label: 'None / N/A' }]}
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
    </>
  );

  const structureContent = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <Switch
        size="sm"
        label="Allow sub-lines"
        checked={line.allowsSubLines ?? false}
        onChange={(next) => onUpdateLine(line.id, { allowsSubLines: next })}
      />
      {otherSections.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <span style={{ fontSize: 'var(--text-2xs)', fontWeight: 'var(--weight-semibold)', letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
            Move to section
          </span>
          <Select
            size="sm"
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

  const sections: LineSettingsSection[] = [];

  if (isChild) {
    // Unchanged by the Normal/Debt/Check redesign below — a child never shows the type selector,
    // so it keeps its own name field plus whichever projection controls apply, and a read-only
    // note + tranche properties when its parent is debt-kind.
    sections.push({
      key: 'projection',
      label: 'Projection',
      content: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <span style={{ fontSize: 'var(--text-2xs)', fontWeight: 'var(--weight-semibold)', letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
              {isKpi ? 'KPI' : 'Sub-line'} name
            </span>
            <Input
              size="sm"
              autoFocus={!line.name}
              value={line.name}
              onChange={(e) => onUpdateLine(line.id, { name: e.target.value })}
              placeholder={isKpi ? 'e.g. Monthly Active Users' : 'e.g. Segment A'}
            />
          </div>
          {projectionControls}
        </div>
      ),
    });
    if (isDebtLine) {
      sections.push({
        key: 'structure',
        label: 'Structure',
        content: (
          <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
            Debt (inherited from its parent line).
          </p>
        ),
      });
      sections.push({
        key: 'debt',
        label: 'Debt tranche',
        content: <DebtTranchePropertiesEditor instance={debtProperties ?? {}} onChange={onChangeDebtProperties} />,
      });
    }
  } else if (lineType === 'check') {
    // A check is nothing but a formula expected to read ~0 and a tolerance for how close counts
    // as tied out — no projection (always hand-written), no sub-lines (always a leaf), no
    // aliases (never matched against an uploaded statement, so nothing would ever alias to it).
    sections.push({
      key: 'formula',
      label: 'Formula',
      content: (
        <FormulaInput value={line.formula} onChange={(formula) => onUpdateLine(line.id, { formula })} nameIndex={nameIndex} ownLineId={line.id} />
      ),
    });
    const isPercent = line.numberFormat === 'percentage';
    sections.push({
      key: 'check',
      label: 'Tolerance',
      content: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {isPercent ? (
            <PercentInput
              value={line.checkTolerance ?? DEFAULT_CHECK_TOLERANCE}
              onCommit={(next) => onUpdateLine(line.id, { checkTolerance: next ?? DEFAULT_CHECK_TOLERANCE })}
            />
          ) : (
            <NumberInput
              value={line.checkTolerance ?? DEFAULT_CHECK_TOLERANCE}
              onCommit={(next) => onUpdateLine(line.id, { checkTolerance: next ?? DEFAULT_CHECK_TOLERANCE })}
            />
          )}
          <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
            Flagged red in the model workspace when the computed value's magnitude exceeds this{isPercent ? ' (as a % of its own denominator)' : ''}.
          </p>
        </div>
      ),
    });
  } else {
    // Normal and Debt both get Structure (sub-lines + move-to-section); Normal additionally gets
    // Projection, Debt additionally gets its tranche properties.
    if (lineType === 'normal') {
      sections.push({
        key: 'projection',
        label: 'Projection',
        content: <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>{projectionControls}</div>,
      });
    }
    sections.push({ key: 'structure', label: 'Structure', content: structureContent });
    if (lineType === 'debt') {
      sections.push({
        key: 'debt',
        label: 'Debt tranche',
        content: <DebtTranchePropertiesEditor instance={debtProperties ?? {}} onChange={onChangeDebtProperties} />,
      });
    }
    sections.push({
      key: 'aliases',
      label: 'Aliases',
      summary: line.aliases.length ? String(line.aliases.length) : undefined,
      content: (
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
      ),
    });
  }

  return (
    <LineSettingsPanel
      title={line.name || (isChild ? `Untitled ${isKpi ? 'KPI' : 'sub-line'}` : 'Untitled line')}
      subtitle={isChild ? (isKpi ? 'KPI' : 'Sub-line') : 'Line settings'}
      icon="settings-2"
      onClose={onClose}
      openKeys={openKeys}
      onToggleSection={toggleSection}
      style={style}
      sections={sections}
      beforeSections={
        !isChild ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <span style={{ fontSize: 'var(--text-2xs)', fontWeight: 'var(--weight-semibold)', letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
              Line type
            </span>
            <SegmentedControl
              size="sm"
              value={lineType}
              options={LINE_TYPE_OPTIONS}
              onChange={(value) => handleLineTypeChange(value as 'normal' | 'debt' | 'check')}
            />
          </div>
        ) : undefined
      }
      footer={
        isChild && onDeleteChildLine ? (
          <Button size="sm" variant="ghost" iconLeft="trash-2" onClick={() => onDeleteChildLine(line.id)}>
            Delete {isKpi ? 'KPI' : 'sub-line'}
          </Button>
        ) : undefined
      }
    />
  );
}
