import * as React from 'react';

export interface DataTableColumn {
  key: string;
  label?: React.ReactNode;
  /** Right-aligns and switches the cell to tabular mono. Use for every figure. */
  numeric?: boolean;
  align?: 'left' | 'center' | 'right';
  width?: number | string;
  maxWidth?: number | string;
  /** Medium weight — for the identity column. */
  emphasis?: boolean;
  /** Secondary text color. */
  muted?: boolean;
  sortable?: boolean;
  /** Tooltip on the header + info glyph; explain the methodology here. */
  description?: string;
  /** 3rd arg is whether this row is currently hovered — lets a column reveal its own content
   *  (e.g. row-action buttons) only on hover, the same way the built-in drag handle already does,
   *  without the column needing its own hover-tracking state. */
  render?: (value: any, row: any, isRowHovered: boolean) => React.ReactNode;
  /** If provided, clicking the cell swaps to this editor until the user clicks elsewhere or presses
   *  Escape. Clicking elsewhere (or losing the cell to a remount) behaves like a normal blur; Escape
   *  is meant to discard instead. The 3rd arg is `wasEditCancelled`, readable from an editor's own
   *  onBlur (which still fires on the DOM removal that follows either path) to skip committing when
   *  it was Escape — see DataTable.jsx for why blur alone can't tell the two apart. */
  renderEdit?: (value: any, row: any, wasEditCancelled: () => boolean) => React.ReactNode;
  /** Gate editability per row (e.g. a derived value shouldn't be clickable). Defaults to true whenever renderEdit is set. */
  canEdit?: (row: any) => boolean;
  /** 'click' (default) activates the editor on a single click, like every other editable column.
   *  'dblclick' leaves a single click alone — it just bubbles up to the row's own `onRowClick`
   *  (e.g. to open a details panel) — and only a double click activates the editor. Use this for
   *  an identity/name column where "click to see details" is the more useful single-click action
   *  and renaming is the secondary one. */
  editTrigger?: 'click' | 'dblclick';
  /** Static tint for the whole column (header + every cell) — e.g. marking every projected-period
   *  column in a period grid. The header uses it as a plain background; each body cell layers it
   *  on top of the row's own background (e.g. a "total" row's `rowStyle`) as an overlay instead of
   *  replacing it, so the two stay visually distinguishable — use a translucent color (e.g. an
   *  `--alpha-*` token) rather than an opaque one. */
  background?: string;
}

/**
 * The workhorse. 30px rows (26px dense), sticky micro-caps header, sortable columns,
 * group separator rows (`{ __group: 'Label', id }`) and an inline expanded detail row.
 *
 * @startingPoint section="Data" subtitle="Dense sortable table with drill-down rows" viewport="700x300"
 */
export interface DataTableProps extends React.HTMLAttributes<HTMLDivElement> {
  columns?: DataTableColumn[];
  rows?: any[];
  /** Field used as the React key and selection id. */
  rowKey?: string;
  /** 26px rows and 12px type. */
  dense?: boolean;
  striped?: boolean;
  sort?: { key: string; dir: 'asc' | 'desc' };
  onSortChange?: (sort: { key: string; dir: 'asc' | 'desc' }) => void;
  selectable?: boolean;
  selected?: string[];
  onSelectedChange?: (keys: string[]) => void;
  /** rowKey of the row whose detail panel is open. */
  expandedKey?: string | null;
  onRowClick?: (row: any) => void;
  /** Renders the inline detail panel for the expanded row. */
  renderDetail?: (row: any) => React.ReactNode;
  /** Per-row style override (e.g. background/border/font for a "total" or "metric" row), merged onto every cell. */
  rowStyle?: (row: any) => React.CSSProperties;
  stickyHeader?: boolean;
  /** Pins `columns[0]` while the rest scrolls horizontally — for a wide grid whose first column is the row identity (e.g. a period grid). Not combined with `selectable` anywhere in the app yet. */
  stickyFirstColumn?: boolean;
  maxHeight?: number | string;
  /** Enables drag-to-reorder: a grip handle inside column 0's own cell (inheriting its real
   *  background/border, rather than a separate leading column), native HTML5 drag events, and an
   *  insertion-line indicator. Off by default; requires `onReorder` to actually do anything. */
  draggableRows?: boolean;
  /** 'hover' (default) shows a row's handle only while that row (or its handle) is hovered;
   *  'always' keeps every handle visible. Only meaningful when `draggableRows` is set. Column 0's
   *  own gutter for the handle is reserved for the WHOLE table regardless of this — only the
   *  icon's opacity follows hover — so text never shifts as the mouse moves down the column; a
   *  table with `draggableRows` off entirely keeps the ordinary padding, unaffected either way. */
  dragHandleMode?: 'hover' | 'always';
  /** Gates which rows get an actual drag handle (are a drag SOURCE) — e.g. exclude a nested
   *  sub-row that has no independent order of its own. Defaults to every non-group row. Group
   *  rows (`__group`) never get a handle regardless. */
  canDragRow?: (row: any) => boolean;
  /** Gates which rows are valid drop boundaries (can have something dropped "before" them) —
   *  e.g. exclude a synthetic "+ Add line" affordance row that isn't real content. Defaults to
   *  every row, including group rows (a group header is a valid "become this group's first row"
   *  target) and non-draggable rows (dropping near a sub-line still resolves sensibly — see
   *  reorderLine's own doc comment on why raw-array adjacency to a nested row is harmless). */
  canDropBeforeRow?: (row: any) => boolean;
  /** Fires on a completed drop: `draggedKey` is the moved row's `rowKey` value (read from the
   *  native drag payload, so it may not even be one of this table's OWN current `rows` — that's
   *  what makes a drag FROM one DataTable TO another just work, no shared context needed).
   *  `beforeKey` is the row it should now sit immediately before, or `null` for "at the end of
   *  this table." DataTable stays fully controlled: it renders nothing differently until the
   *  next `rows` prop reflects the reorder the caller decided to make. */
  onReorder?: (draggedKey: string, beforeKey: string | null) => void;
}
export function DataTable(props: DataTableProps): JSX.Element;
