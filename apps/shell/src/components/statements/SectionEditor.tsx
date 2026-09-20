import { useState, type CSSProperties } from 'react';
import { Badge, Button, DataTable, Icon, IconButton, Input, Select, SegmentedControl, Switch, Tag, Tooltip } from '@basis/design-system';
import type { DriverDefinition, LineNumberFormat, LineRole, LineRowFormat, LineSign, ProjectionMethod, StatementLine, StatementSchema, StatementSection } from '../../data';
import { collectRefIds, formatFormula, isCalculated, type NameIndex } from '../../lib/engine/resolve';
import { buildSectionRows, type SectionRow } from '../../lib/statementRowBuilder';
import { isFormulaOnly } from '../../lib/lineRole';
import { summarizeProjection } from '../../lib/projectionSummary';
import type { ProjectionSelection } from '../../lib/statementSchemaEdit';
import type { InstanceTarget } from '../models/instances/projectionMethod';
import { FormulaInput } from './FormulaInput';
import { FormulaHelp } from './FormulaHelp';
import { DEFAULT_CHECK_TOLERANCE, NUMBER_FORMAT_META, ROW_FORMAT_META, SIGN_META, getLineRowStyle, getRequiredMeta } from './statementFormatting';
import { LineSettingsPanel, type LineSettingsSection } from '../common/LineSettingsPanel';
import { DebtTranchePropertiesEditor, NumberInput, PercentInput } from '../models/instances/DebtTranchePropertiesEditor';
import type { DebtTrancheProperties } from '../../data';

const ROW_FORMAT_OPTIONS = Object.entries(ROW_FORMAT_META).map(([value, meta]) => ({ value, label: meta.label }));
const NUMBER_FORMAT_OPTIONS = Object.entries(NUMBER_FORMAT_META).map(([value, meta]) => ({ value, label: meta.label }));
const SIGN_OPTIONS = Object.entries(SIGN_META).map(([value, meta]) => ({ value, label: meta.label }));
const ROLE_OPTIONS = [
  { value: 'required', label: 'Required' },
  { value: 'optional', label: 'Optional' },
  { value: 'calculated', label: 'Calculated' },
  { value: 'check', label: 'Check' },
];

export type { ProjectionSelection };

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
  /** The "Role" column's editor — a role change can also reshape the line's formula,
   *  projection and structure (see lib/statementSchemaEdit.ts's setLineRole), so it isn't just an
   *  onUpdateLine patch. */
  onSetRole: (lineId: string, role: LineRole) => void;
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
  onAddLine, onUpdateLine, onSetRole, onDeleteLine, onReorderLine,
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
        // shows its (non-"Calculated") status in the Role column and its formula in the
        // expanded row detail — showing the icon on every projected line too would just be noise.
        const dangling = hasFormula ? collectRefIds(row.line.formula!).filter((id) => !nameIndex.describe(id)) : [];
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            {row.line.name || <span style={{ color: 'var(--text-tertiary)' }}>Untitled line</span>}
            {dangling.length > 0 ? (
              <span title="References a line that no longer exists">
                <Icon name="alert-triangle" size={12} color="var(--text-negative)" />
              </span>
            ) : isFormulaOnly(row.line) && hasFormula ? (
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
      key: 'role',
      label: 'Role',
      width: 120,
      // The line's role — Required / Optional / Calculated / Check. A Debt Schedule line is
      // generated, so its role is fixed. Only a top-level line shows this at all — a child/KPI's
      // status lives in the mapping screen instead.
      canEdit: (row: SectionRow) => Boolean(row.line) && !row.line!.debtScheduleRole,
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
            options={ROLE_OPTIONS}
            value={row.line.role}
            onChange={(e) => onSetRole(row.line!.id, e.target.value as LineRole)}
          />
        ) : null,
    },
    {
      key: 'projection',
      label: 'Projection',
      width: 150,
      // Read-only on purpose — a projection is only ever edited in the line's settings panel.
      // Blank for a Calculated / Check line (nothing to project); a sourced line with none reads
      // "Not set" in red, which is the thing this column is here to make easy to spot.
      render: (_: unknown, row: SectionRow) => {
        const target = row.line ?? row.childLine;
        if (!target) return null;
        const summary = summarizeProjection(target, schema.drivers, nameIndex);
        if (!summary) return null;
        return (
          <span
            title={summary.label}
            style={{
              display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              fontSize: 'var(--text-xs)',
              color: summary.tone === 'missing' ? 'var(--text-negative)' : summary.tone === 'derived' ? 'var(--text-tertiary)' : 'var(--text-body)',
              fontStyle: summary.tone === 'derived' ? 'italic' : undefined,
            }}
          >
            {summary.label}
          </span>
        );
      },
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
  onSetRole: (lineId: string, role: LineRole) => void;
  onDeleteChildLine?: (lineId: string) => void;
  onClose: () => void;
  style?: CSSProperties;
}

type StandardMethod = 'flat' | 'growth' | 'percent-of' | 'days-of';
type ProjectionType = 'standard' | 'link' | 'formula' | 'hardcode';

const PROJECTION_TYPE_OPTIONS = [
  { value: 'standard', label: 'Standard' },
  { value: 'link', label: 'Link' },
  { value: 'formula', label: 'Formula' },
  { value: 'hardcode', label: 'Hardcode' },
];

function isStandardMethod(method: string): method is StandardMethod {
  return method === 'flat' || method === 'growth' || method === 'percent-of' || method === 'days-of';
}

function needsBasisLine(method: StandardMethod): method is 'percent-of' | 'days-of' {
  return method === 'percent-of' || method === 'days-of';
}

// 'properties' (the four table columns, mirrored) starts collapsed — it's the least-touched group.
const DEFAULT_OPEN_SECTIONS = ['name', 'structure', 'calculation'];

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
];

const fieldColumn = { display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' } as const;
const mutedNote = { fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' } as const;

/** The side panel shown for whichever line (or sub-line/KPI) is selected in any of a schema's
 *  sections — rendered once by the parent screen (StatementDefinitionsScreen, or the model
 *  workspace's own schema-edit mode), not per-SectionEditor, since only one line can be selected
 *  across the whole schema at a time. What it shows follows the line's role (see LineRole): a
 *  Calculated line has just a formula; a Check adds its tolerance; a Required/Optional line has
 *  structure (line type, sub-lines) and a Projection with an explicit type, so a projection can't
 *  be forgotten. Callers key it by line id, which is what resets its local state on selection. */
export function LineSettingsPanelContent({
  line, isChild, isKpi, isDebtLine, debtProperties, onChangeDebtProperties,
  lineGroups, drivers, nameIndex, onUpdateLine, onSetProjection, onSetRole, onDeleteChildLine, onClose, style,
}: LineSettingsPanelContentProps) {
  const [aliasDraft, setAliasDraft] = useState('');
  // A choice that needs a basis line isn't committed to the line until one is picked — held here
  // meanwhile rather than writing a half-configured projection onto the line.
  const [pendingMethod, setPendingMethod] = useState<'percent-of' | 'days-of' | null>(null);
  const [pendingLink, setPendingLink] = useState(false);
  // The Link's Flip sign switch — held here so it can be set before a basis line is chosen.
  const [flipSign, setFlipSign] = useState(line.projection?.method === 'link' && line.projection.flipSign === true);
  const [openKeys, setOpenKeys] = useState<string[]>(DEFAULT_OPEN_SECTIONS);

  const role = line.role;
  const sourced = role === 'required' || role === 'optional';
  const projection = line.projection;
  const rawMethod = projection?.method ?? 'flat';
  // roll-off / actual are child-only, mapping-time methods this editor doesn't offer — a read-only
  // note instead of a control, so switching it away can't skip the roll-off-contra cleanup
  // setChildProjection does.
  const unsupportedMethod = !isStandardMethod(rawMethod) && rawMethod !== 'link' && rawMethod !== 'formula' && rawMethod !== 'hardcode';
  const committedType: ProjectionType =
    rawMethod === 'link' || rawMethod === 'formula' || rawMethod === 'hardcode' ? rawMethod : 'standard';
  const projectionType: ProjectionType = pendingLink ? 'link' : committedType;
  const currentMethod: StandardMethod = pendingMethod ?? (isStandardMethod(rawMethod) ? rawMethod : 'flat');
  const currentDriverId = projection && 'driverId' in projection ? projection.driverId : undefined;
  const currentDriver = drivers.find((d) => d.id === currentDriverId);
  // Blank while a new basis-needing method is pending (nothing chosen yet); otherwise reflects
  // the already-committed driver's basis line, so reopening a configured line shows it correctly.
  const ratioBasisLineId = pendingMethod ? '' : (currentDriver?.basisLineId ?? '');
  const linkBasisLineId = projection?.method === 'link' && !pendingLink ? projection.basisLineId : '';

  function handleProjectionTypeChange(next: ProjectionType) {
    if (next === projectionType) return;
    setPendingMethod(null);
    if (next === 'link') {
      // Nothing to link to yet — wait for a basis line before touching the line itself.
      setPendingLink(committedType !== 'link');
      return;
    }
    setPendingLink(false);
    onSetProjection(line.id, next === 'standard' ? { method: 'flat' } : { method: next });
  }

  function handleMethodChange(method: StandardMethod) {
    if (needsBasisLine(method)) {
      setPendingMethod(method);
      return;
    }
    setPendingMethod(null);
    onSetProjection(line.id, method === 'flat' ? { method: 'flat' } : { method: 'growth' });
  }

  function handleRatioBasisChange(nextBasisLineId: string) {
    if (!needsBasisLine(currentMethod) || !nextBasisLineId) return;
    onSetProjection(line.id, { method: currentMethod, basisLineId: nextBasisLineId });
    setPendingMethod(null);
  }

  function handleLinkBasisChange(nextBasisLineId: string) {
    if (!nextBasisLineId) return;
    onSetProjection(line.id, { method: 'link', basisLineId: nextBasisLineId, flipSign });
    setPendingLink(false);
  }

  function handleFlipSignChange(next: boolean) {
    setFlipSign(next);
    if (linkBasisLineId) onSetProjection(line.id, { method: 'link', basisLineId: linkBasisLineId, flipSign: next });
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

  // A top-level sourced line is Normal or Debt. A child never picks its own (kind is always
  // inherited from its parent — see effectiveLineKind's own doc comment). A Check is a role now,
  // not a line type.
  const lineType: 'normal' | 'debt' = isChild ? (isDebtLine ? 'debt' : 'normal') : line.lineKind === 'debt' ? 'debt' : 'normal';

  const basisGroups = lineGroups
    .map((g) => ({
      label: g.sectionName,
      options: g.lines.filter((l) => l.id !== line.id).map((l) => ({ value: l.id, label: l.name })),
    }))
    .filter((g) => g.options.length > 0);

  const formulaField = (
    <div style={fieldColumn}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <FieldLabel>Formula</FieldLabel>
        <FormulaHelp />
      </div>
      <FormulaInput value={line.formula} onChange={(formula) => onUpdateLine(line.id, { formula })} nameIndex={nameIndex} ownLineId={line.id} />
    </div>
  );

  // A Required/Optional line's Projection body: the type selector, then whatever that type needs.
  const projectionControls = unsupportedMethod ? (
    <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
      Uses a mapping-time projection method ({rawMethod}) — change it from the mapping screen instead.
    </p>
  ) : (
    <>
      <div style={fieldColumn}>
        <FieldLabel>Projection type</FieldLabel>
        <SegmentedControl
          size="sm"
          value={projectionType}
          options={PROJECTION_TYPE_OPTIONS}
          onChange={(value) => handleProjectionTypeChange(value as ProjectionType)}
        />
      </div>

      {projectionType === 'standard' ? (
        <>
          <div style={fieldColumn}>
            <FieldLabel>Projection method</FieldLabel>
            <Select
              size="sm"
              options={PROJECTION_METHOD_OPTIONS}
              value={currentMethod}
              onChange={(e) => handleMethodChange(e.target.value as StandardMethod)}
            />
          </div>
          {needsBasisLine(currentMethod) ? (
            <div style={fieldColumn}>
              <FieldLabel>Basis line</FieldLabel>
              <Select
                size="sm"
                value={ratioBasisLineId}
                options={[{ value: '', label: 'None / N/A' }]}
                groups={basisGroups}
                onChange={(e) => handleRatioBasisChange(e.target.value)}
              />
            </div>
          ) : null}
          <div style={fieldColumn}>
            <FieldLabel>Formula</FieldLabel>
            {currentMethod === 'flat' ? (
              <span style={mutedNote}>Holds the last actual value.</span>
            ) : pendingMethod ? (
              <span style={mutedNote}>Choose a basis line to generate the formula.</span>
            ) : (
              <span style={{ ...mutedNote, fontFamily: 'var(--font-mono)' }}>{formatFormula(line.formula, nameIndex)}</span>
            )}
          </div>
        </>
      ) : projectionType === 'link' ? (
        <>
          <div style={fieldColumn}>
            <FieldLabel>Basis line</FieldLabel>
            <Select
              size="sm"
              value={linkBasisLineId}
              options={[{ value: '', label: 'Choose a line…' }]}
              groups={basisGroups}
              onChange={(e) => handleLinkBasisChange(e.target.value)}
            />
          </div>
          <Switch size="sm" label="Flip sign" checked={flipSign} onChange={handleFlipSignChange} />
          <div style={fieldColumn}>
            <FieldLabel>Formula</FieldLabel>
            {linkBasisLineId ? (
              <span style={{ ...mutedNote, fontFamily: 'var(--font-mono)' }}>{formatFormula(line.formula, nameIndex)}</span>
            ) : (
              <span style={mutedNote}>Choose a line to generate the formula.</span>
            )}
          </div>
        </>
      ) : projectionType === 'formula' ? (
        formulaField
      ) : (
        <div style={fieldColumn}>
          <FieldLabel>Formula</FieldLabel>
          <span style={mutedNote}>Values to be input manually.</span>
        </div>
      )}
    </>
  );

  const nameControls = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <div style={fieldColumn}>
        <FieldLabel>{isChild ? (isKpi ? 'KPI name' : 'Sub-line name') : 'Line name'}</FieldLabel>
        <Input
          size="sm"
          autoFocus={!line.name}
          value={line.name}
          onChange={(e) => onUpdateLine(line.id, { name: e.target.value })}
          placeholder={isChild ? (isKpi ? 'e.g. Monthly Active Users' : 'e.g. Segment A') : 'e.g. Revenue'}
        />
      </div>
      {/* Aliases only matter for a line that's matched against an uploaded statement — a sourced,
          top-level one. A Calculated / Check line is never mapped, so nothing would alias to it. */}
      {isChild || !sourced ? null : (
        <div style={fieldColumn}>
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

  // The same four fields as the table's own columns, edited through the same callbacks — just
  // another way in. Top-level lines only, matching the table (a child/KPI shows none of these).
  // A Debt Schedule line is generated, so its role is fixed.
  const propertiesContent = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <div style={fieldColumn}>
        <FieldLabel>Role</FieldLabel>
        <Select
          size="sm"
          disabled={Boolean(line.debtScheduleRole)}
          options={ROLE_OPTIONS}
          value={role}
          onChange={(e) => onSetRole(line.id, e.target.value as LineRole)}
        />
      </div>
      <div style={fieldColumn}>
        <FieldLabel>Row format</FieldLabel>
        <Select
          size="sm"
          options={ROW_FORMAT_OPTIONS}
          value={line.rowFormat}
          onChange={(e) => onUpdateLine(line.id, { rowFormat: e.target.value as LineRowFormat })}
        />
      </div>
      <div style={fieldColumn}>
        <FieldLabel>Number format</FieldLabel>
        <Select
          size="sm"
          options={NUMBER_FORMAT_OPTIONS}
          value={line.numberFormat}
          onChange={(e) => onUpdateLine(line.id, { numberFormat: e.target.value as LineNumberFormat })}
        />
      </div>
      <div style={fieldColumn}>
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

  // Line type, then sub-lines, then the debt tranche properties for a debt line. "Move to section"
  // is gone — drag the row's own handle into another section's table instead.
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
      <div style={fieldColumn}>
        <FieldLabel>Line type</FieldLabel>
        <SegmentedControl
          size="sm"
          value={lineType}
          options={LINE_TYPE_OPTIONS}
          onChange={(value) => onUpdateLine(line.id, { lineKind: value === 'debt' ? 'debt' : undefined })}
        />
      </div>
      <Switch
        size="sm"
        label="Allow sub-lines"
        checked={line.allowsSubLines ?? false}
        onChange={(next) => onUpdateLine(line.id, { allowsSubLines: next })}
      />
      {lineType === 'debt' ? <DebtTranchePropertiesEditor instance={debtProperties ?? {}} onChange={onChangeDebtProperties} /> : null}
    </div>
  );

  const isPercentCheck = line.numberFormat === 'percentage';
  const toleranceField = (
    <div style={fieldColumn}>
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
  );

  const sections: LineSettingsSection[] = [
    {
      key: 'name',
      label: 'Line name',
      summary: !isChild && sourced && line.aliases.length ? `${line.aliases.length} alias${line.aliases.length === 1 ? '' : 'es'}` : undefined,
      content: nameControls,
    },
  ];
  if (!isChild) sections.push({ key: 'properties', label: 'Line properties', content: propertiesContent });
  // Calculated and Check lines have no structure (no line type, sub-lines or tranche properties).
  if (isChild || sourced) sections.push({ key: 'structure', label: 'Structure', content: structureContent });

  if (!isChild && role === 'calculated') {
    sections.push({ key: 'calculation', label: 'Calculation', content: formulaField });
  } else if (!isChild && role === 'check') {
    sections.push({
      key: 'calculation',
      label: 'Calculation',
      content: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
          {formulaField}
          {toleranceField}
        </div>
      ),
    });
  } else if (isChild || lineType !== 'debt') {
    // A top-level debt line's value comes from the Debt Schedule, so it has no projection here.
    sections.push({
      key: 'calculation',
      label: 'Projection',
      content: <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>{projectionControls}</div>,
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
