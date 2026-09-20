import { useState, type CSSProperties } from 'react';
import { Badge, Button, DataTable, Icon, IconButton, Input, Select, SegmentedControl, Switch, Tag, Tooltip } from '@basis/design-system';
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

const PROJECTION_METHOD_OPTIONS: { value: 'flat' | ProjectionMethod; label: string }[] = [
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
  /** Drag-and-drop's one move primitive (see lib/statementSchemaEdit.ts's reorderLine) —
   *  `beforeLineId: null` means "at the end of THIS section". Subsumes the old up/down arrows
   *  AND the old "Move to section" dropdown: dragging a line's handle into a DIFFERENT section's
   *  own SectionEditor fires THAT section's onReorderLine, with lineId identifying a line that
   *  isn't even one of its own rows — DataTable's onReorder is deliberately origin-agnostic (see
   *  its own doc comment), so cross-section drag needs no extra plumbing beyond this. */
  onReorderLine: (lineId: string, beforeLineId: string | null) => void;
}

export function SectionEditor({
  schema, section, isFirst, isLast, nameIndex,
  selectedLineId, onSelectLine, onAddSubLine,
  onRename, onSetAllowsFreeformLines, onMoveUp, onMoveDown, onDelete,
  onAddLine, onUpdateLine, onDeleteLine, onReorderLine,
}: SectionEditorProps) {
  const rows = buildSectionRows(schema, section);

  const columns = [
    {
      key: 'name',
      label: 'Line name',
      emphasis: true,
      canEdit: (row: SectionRow) => Boolean(row.line),
      // A single click opens this row's settings panel instead (see the DataTable's own
      // onRowClick below) — the identity column is the one place that's a more useful default
      // than "start renaming," since every other column here still activates on a single click.
      editTrigger: 'dblclick' as const,
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
      render: (_: unknown, row: SectionRow, isRowHovered: boolean) =>
        row.line ? (
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              display: 'flex', justifyContent: 'flex-end',
              opacity: isRowHovered || selectedLineId === row.id ? 1 : 0,
              transition: 'opacity var(--dur-instant) var(--ease-out)',
            }}
          >
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
          draggableRows
          dragHandleMode="hover"
          canDragRow={(row: SectionRow) => Boolean(row.line)}
          onReorder={(draggedKey, beforeKey) => onReorderLine(draggedKey, beforeKey)}
        />
      ) : (
        // Still a valid drop target for a line dragged in from another section — otherwise an
        // emptied-out section could never receive one back via drag-and-drop.
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const draggedKey = e.dataTransfer.getData('text/plain');
            if (draggedKey) onReorderLine(draggedKey, null);
          }}
          style={{ padding: 'var(--space-8)', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}
        >
          No lines in this section yet. Drag a line here to move it in.
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
  lineGroups: LineGroup[];
  drivers: DriverDefinition[];
  nameIndex: NameIndex;
  onUpdateLine: (lineId: string, patch: Partial<StatementLine>) => void;
  onSetProjection: (lineId: string, selection: ProjectionSelection) => void;
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

// 'properties' (the four table columns, mirrored) starts collapsed — it's the least-touched group.
const DEFAULT_OPEN_SECTIONS = ['name', 'structure', 'calculation'];

type CalcType = 'formula' | 'projection' | 'hardcode';

const CALC_TYPE_OPTIONS = [
  { value: 'formula', label: 'Formula' },
  { value: 'projection', label: 'Projection' },
  { value: 'hardcode', label: 'Hardcode' },
];

function FieldLabel({ children }: { children: string }) {
  return (
    <span style={{ fontSize: 'var(--text-2xs)', fontWeight: 'var(--weight-semibold)', letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
      {children}
    </span>
  );
}

const SIGN_TOOLTIP =
  'Natural keeps values as reported. Absolute treats them as positive amounts — e.g. costs listed without a minus sign.';

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
  lineGroups, drivers, nameIndex, onUpdateLine, onSetProjection, onDeleteChildLine, onClose, style,
}: LineSettingsPanelContentProps) {
  const [aliasDraft, setAliasDraft] = useState('');
  // A method that needs a basis line isn't committed to the line until one is picked — held here
  // locally in the meantime rather than writing a half-configured projection onto the line.
  const [pendingMethod, setPendingMethod] = useState<'percent-of' | 'days-of' | null>(null);
  const [openKeys, setOpenKeys] = useState<string[]>(DEFAULT_OPEN_SECTIONS);

  const rawMethod = methodOf(line);
  // Derived once per selected line (callers key this component by line id): a projection method
  // means Projection, anything else opens on Formula — including a brand-new line with neither.
  // Hardcode isn't stored (it's just "no projection, no formula"), so it can only be picked
  // here, not inferred: a line left on Hardcode reopens on an empty Formula field instead.
  const [calcType, setCalcType] = useState<CalcType>(() => (rawMethod !== 'none' ? 'projection' : 'formula'));
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

  function handleCalcTypeChange(next: CalcType) {
    if (next === calcType) return;
    setCalcType(next);
    if (next === 'projection') {
      // Flat is the default projection — commits immediately, like picking it from the dropdown.
      handleMethodChange('flat');
      return;
    }
    // Formula and Hardcode both start from a clean slate: drop any projection (and the driver and
    // generated formula that came with it). Hardcode additionally clears a hand-written formula,
    // since "no projection and no formula" is what marks a line as manually entered.
    setPendingMethod(null);
    if (currentMethod !== 'none') {
      onSetProjection(line.id, { method: 'none' });
    } else if (next === 'hardcode' && line.formula !== null) {
      onUpdateLine(line.id, { formula: null });
    }
  }

  // The Calculation section's body, shared by a child's and a top-level Normal line's — Debt and
  // Check skip the type selector entirely below (a debt-kind line's value comes from the Debt
  // Schedule, never a projection method picked here; a check is always a hand-written formula).
  const calculationControls = !isSchemaEditorMethod(rawMethod) ? (
    <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
      Uses a mapping-time projection method ({rawMethod}) — change it from the mapping screen instead.
    </p>
  ) : (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <FieldLabel>Calculation type</FieldLabel>
        <SegmentedControl
          size="sm"
          value={calcType}
          options={CALC_TYPE_OPTIONS}
          onChange={(value) => handleCalcTypeChange(value as CalcType)}
        />
      </div>

      {calcType === 'projection' ? (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <FieldLabel>Projection method</FieldLabel>
            <Select
              size="sm"
              options={PROJECTION_METHOD_OPTIONS}
              value={currentMethod === 'none' ? 'flat' : currentMethod}
              onChange={(e) => handleMethodChange(e.target.value as 'flat' | ProjectionMethod)}
            />
          </div>

          {needsBasisLine(currentMethod) ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              <FieldLabel>Basis line</FieldLabel>
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
            <FieldLabel>Formula</FieldLabel>
            {currentMethod === 'flat' ? (
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
      ) : calcType === 'formula' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <FieldLabel>Formula</FieldLabel>
          <FormulaInput
            value={line.formula}
            onChange={(formula) => onUpdateLine(line.id, { formula })}
            nameIndex={nameIndex}
            ownLineId={line.id}
          />
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <FieldLabel>Formula</FieldLabel>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>Values to be input manually.</span>
        </div>
      )}
    </>
  );

  const nameControls = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <FieldLabel>{isChild ? (isKpi ? 'KPI name' : 'Sub-line name') : 'Line name'}</FieldLabel>
        <Input
          size="sm"
          autoFocus={!line.name}
          value={line.name}
          onChange={(e) => onUpdateLine(line.id, { name: e.target.value })}
          placeholder={isChild ? (isKpi ? 'e.g. Monthly Active Users' : 'e.g. Segment A') : 'e.g. Revenue'}
        />
      </div>
      {/* A check is never matched against an uploaded statement, so nothing would ever alias to it. */}
      {isChild || lineType === 'check' ? null : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <FieldLabel>Aliases</FieldLabel>
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
      )}
    </div>
  );

  // Line type, then sub-lines, then whatever the type itself adds (a debt line's tranche
  // properties, a check's tolerance). "Move to section" is gone — drag the row's own handle into
  // another section's table instead (see SectionEditor's onReorderLine/DataTable's onReorder).
  const isPercentCheck = line.numberFormat === 'percentage';
  const structureContent = isChild ? (
    isDebtLine ? (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
        <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>Debt (inherited from its parent line).</p>
        <DebtTranchePropertiesEditor instance={debtProperties ?? {}} onChange={onChangeDebtProperties} />
      </div>
    ) : (
      <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>Normal (inherited from its parent line).</p>
    )
  ) : (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <FieldLabel>Line type</FieldLabel>
        <SegmentedControl
          size="sm"
          value={lineType}
          options={LINE_TYPE_OPTIONS}
          onChange={(value) => handleLineTypeChange(value as 'normal' | 'debt' | 'check')}
        />
      </div>
      {/* A check is always a leaf, so it never offers sub-lines. */}
      {lineType !== 'check' ? (
        <Switch
          size="sm"
          label="Allow sub-lines"
          checked={line.allowsSubLines ?? false}
          onChange={(next) => onUpdateLine(line.id, { allowsSubLines: next })}
        />
      ) : null}
      {lineType === 'debt' ? <DebtTranchePropertiesEditor instance={debtProperties ?? {}} onChange={onChangeDebtProperties} /> : null}
      {lineType === 'check' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <FieldLabel>Tolerance</FieldLabel>
          {isPercentCheck ? (
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
            Flagged red in the model workspace when the computed value's magnitude exceeds this{isPercentCheck ? ' (as a % of its own denominator)' : ''}.
          </p>
        </div>
      ) : null}
    </div>
  );

  // The same four fields as the table's own columns, edited through the same onUpdateLine — just
  // another way in. Top-level lines only, matching the table (a child/KPI shows none of these).
  // A genuine structural formula locks Required, exactly as the table's canEdit does.
  const requiredLocked = isCalculated(line) && !line.projection;
  const propertiesContent = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <FieldLabel>Required</FieldLabel>
        {requiredLocked ? (
          <Select size="sm" disabled options={[{ value: 'calculated', label: 'Calculated' }]} value="calculated" />
        ) : (
          <Select
            size="sm"
            options={REQUIRED_OPTIONS}
            value={line.required ? 'required' : 'optional'}
            onChange={(e) => onUpdateLine(line.id, { required: e.target.value === 'required' })}
          />
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <FieldLabel>Row format</FieldLabel>
        <Select
          size="sm"
          options={ROW_FORMAT_OPTIONS}
          value={line.rowFormat}
          onChange={(e) => onUpdateLine(line.id, { rowFormat: e.target.value as LineRowFormat })}
        />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <FieldLabel>Number format</FieldLabel>
        <Select
          size="sm"
          options={NUMBER_FORMAT_OPTIONS}
          value={line.numberFormat}
          onChange={(e) => onUpdateLine(line.id, { numberFormat: e.target.value as LineNumberFormat })}
        />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <FieldLabel>Sign</FieldLabel>
          <Tooltip content={SIGN_TOOLTIP} placement="right" maxWidth={260}>
            <IconButton icon="info" label="About sign" size="sm" variant="ghost" />
          </Tooltip>
        </div>
        <Select
          size="sm"
          options={SIGN_OPTIONS}
          value={line.sign}
          onChange={(e) => onUpdateLine(line.id, { sign: e.target.value as LineSign })}
        />
      </div>
    </div>
  );

  const sections: LineSettingsSection[] = [
    { key: 'name', label: 'Line name', summary: !isChild && lineType !== 'check' && line.aliases.length ? `${line.aliases.length} alias${line.aliases.length === 1 ? '' : 'es'}` : undefined, content: nameControls },
    ...(isChild ? [] : [{ key: 'properties', label: 'Line properties', content: propertiesContent }]),
    { key: 'structure', label: 'Structure', content: structureContent },
  ];
  // A top-level debt line's value comes from the Debt Schedule, so it has nothing to calculate here.
  if (isChild || lineType !== 'debt') {
    sections.push({
      key: 'calculation',
      label: 'Calculation',
      content:
        !isChild && lineType === 'check' ? (
          // A check is nothing but a hand-written formula expected to read ~0 — no projection, no
          // hardcode.
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <FieldLabel>Formula</FieldLabel>
            <FormulaInput value={line.formula} onChange={(formula) => onUpdateLine(line.id, { formula })} nameIndex={nameIndex} ownLineId={line.id} />
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>{calculationControls}</div>
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
