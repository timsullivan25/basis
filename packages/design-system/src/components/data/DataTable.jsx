import React from 'react';
import { Icon } from '../primitives/Icon.jsx';
import { Checkbox } from '../forms/Checkbox.jsx';

/** Sentinel `dragOverKey` value meaning "insert at the very end of the table" — distinct from
 *  `null` (no drag in progress), and safe as a literal since a real row key is a data value
 *  (typically a uuid), never this exact string. */
const DROP_AT_END = '__basis-datatable-drop-end__';

/** The grip icon itself (see Icon size below) plus equal breathing room on both sides of it —
 *  deliberately NOT layered on top of the column's own `var(--space-6)` padding (that would give
 *  the icon less room on its left than the text gets on its right of it, an off-center look).
 *  Column 0's left padding is widened to exactly this for the WHOLE table whenever draggableRows
 *  is on — a constant, not tied to any one row's hover state, so text never shifts left/right as
 *  the mouse moves down the column; only the icon's own opacity fades with hover (see
 *  dragHandleMode below). A table that isn't draggable at all keeps the ordinary `var(--space-6)`
 *  padding, untouched — this widened gutter is reserved only for a table that has one, not
 *  compared against or matched to some other, unrelated non-draggable table's own padding. */
const HANDLE_ICON_SIZE_PX = 14;
const HANDLE_GAP_PX = 6;
const HANDLE_COLUMN_PADDING_PX = HANDLE_GAP_PX * 2 + HANDLE_ICON_SIZE_PX;

/** Dense sortable table with optional group rows, expandable detail, click-to-edit cells, and
 *  optional drag-to-reorder rows. */
export function DataTable({
  columns = [], rows = [], rowKey = 'id', dense = false, striped = false,
  sort, onSortChange, selectable = false, selected = [], onSelectedChange,
  expandedKey, onRowClick, renderDetail, rowStyle, stickyHeader = true, stickyFirstColumn = false, maxHeight, style,
  draggableRows = false, dragHandleMode = 'hover', canDragRow, canDropBeforeRow, onReorder,
  ...rest
}) {
  const h = dense ? 'var(--row-h-dense)' : 'var(--row-h)';
  const [hoverRow, setHoverRow] = React.useState(null);
  const [activeCell, setActiveCell] = React.useState(null);
  // The row (or DROP_AT_END) currently under the drag, purely for the insertion-line indicator —
  // the actual dragged row's identity is read from the native DataTransfer payload only at drop
  // (browsers don't expose it during dragover, for security), so this never needs to track it.
  const [dragOverKey, setDragOverKey] = React.useState(null);
  const dragActive = draggableRows && Boolean(onReorder);
  // Escape should discard an in-flight edit rather than commit it, but deactivating the cell
  // unmounts its renderEdit'd Input — and a browser fires a native blur on an element removed
  // from the DOM while focused, which would otherwise run the input's own onBlur-commit handler
  // with whatever partial text is in its buffer. This ref, read via the 3rd (wasEditCancelled)
  // arg to renderEdit, lets a buffered/commit-on-blur editor (unlike SectionEditor's commit-on-
  // change ones, which have nothing to lose) skip that commit specifically for Escape — clicking
  // away still commits, same as blurring any other field.
  const cancelledEditRef = React.useRef(false);
  const allSel = selectable && rows.length > 0 && selected.length === rows.length;
  const toggleAll = () => onSelectedChange && onSelectedChange(allSel ? [] : rows.map((r) => r[rowKey]));
  const toggleRow = (k) => onSelectedChange && onSelectedChange(selected.includes(k) ? selected.filter((x) => x !== k) : [...selected, k]);
  const align = (c) => c.align || (c.numeric ? 'right' : 'left');

  // Dropping in a row's top half targets "before this row"; the bottom half targets "before the
  // NEXT row" (or DROP_AT_END, past the last one) — this is what lets the very last row's bottom
  // half mean "append to the end" with no separate always-there drop zone required. Any row is a
  // valid boundary (group header, sub-line, whatever) unless canDropBeforeRow says otherwise —
  // the caller alone knows which rows are real content vs. an "add line" affordance and the like.
  function dragOverRow(e, index) {
    if (!dragActive) return;
    const row = rows[index];
    if (canDropBeforeRow && !canDropBeforeRow(row)) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const topHalf = e.clientY - rect.top < rect.height / 2;
    const next = rows[index + 1];
    setDragOverKey(topHalf ? row[rowKey] : next ? next[rowKey] : DROP_AT_END);
  }

  function dropOnRow(e) {
    if (!dragActive) return;
    e.preventDefault();
    const draggedKey = e.dataTransfer.getData('text/plain');
    const target = dragOverKey === DROP_AT_END ? null : dragOverKey;
    if (draggedKey && draggedKey !== target) onReorder(draggedKey, target);
    setDragOverKey(null);
  }

  // A row's own top/bottom border would shift its height by the indicator's width as you drag
  // over different rows — an inset box-shadow reads the same visually with no layout reflow, and
  // composes with a column's own background tint (see the `c.background` shadow below) rather
  // than clobbering it.
  function dropIndicatorShadow(key, isLastRow) {
    if (!dragActive) return null;
    if (dragOverKey === key) return 'inset 0 2px 0 0 var(--border-focus)';
    if (isLastRow && dragOverKey === DROP_AT_END) return 'inset 0 -2px 0 0 var(--border-focus)';
    return null;
  }

  // Every editable cell in reading order, across every non-group row — Tab walks this list
  // exactly like a spreadsheet, wrapping from a row's last editable column to the next row's
  // first. Recomputed each render rather than memoized: rows/columns are already fresh props,
  // and this is only ever walked once per keypress.
  const editableCells = React.useMemo(() => {
    const editableColumns = columns.filter((c) => c.renderEdit);
    const list = [];
    for (const r of rows) {
      if (r.__group) continue;
      for (const c of editableColumns) {
        if (c.canEdit ? c.canEdit(r) : true) list.push(r[rowKey] + ':' + c.key);
      }
    }
    return list;
  }, [rows, columns, rowKey]);

  React.useEffect(() => {
    if (!activeCell) return undefined;
    const clear = () => setActiveCell(null);
    const onKeyDown = (e) => {
      if (e.key === 'Tab') {
        // Deactivating the current cell (same as Enter/click-away below) lets its removal's
        // native blur commit it; setting activeCell straight to the next cell's id — rather than
        // null — both commits the one being left and activates the next in the same update.
        e.preventDefault();
        const i = editableCells.indexOf(activeCell);
        if (i === -1) {
          clear();
          return;
        }
        const next = i + (e.shiftKey ? -1 : 1);
        setActiveCell(next >= 0 && next < editableCells.length ? editableCells[next] : null);
        return;
      }
      // Enter completes the edit the same way clicking away does (deactivate, let the removal's
      // blur commit it) — Escape is the only path that discards instead, via cancelledEditRef.
      if (e.key !== 'Escape' && e.key !== 'Enter') return;
      if (e.key === 'Escape') cancelledEditRef.current = true;
      clear();
    };
    document.addEventListener('click', clear);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('click', clear);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [activeCell, editableCells]);

  // Fixed layout only when every column has actually opted into an exact width — 'fixed' has no
  // concept of "size to content", so a column left at its content-driven default (no `width`
  // given) would otherwise just get an arbitrary equal share of whatever space is left, which is
  // wrong for that column, not just different. A caller that DOES give every column a width (the
  // common case, and how a caller lines this table up pixel-for-pixel against a sibling grid — see
  // the Drivers card's chart view, aligned against its own CSS-grid period columns) gets it
  // honored exactly instead of silently re-compressed/stretched by content, same as it already
  // asks for; a caller that doesn't keeps today's plain content-sized columns, unchanged.
  const allColumnsSized = columns.every((c) => c.width != null);
  return (
    <div style={{ overflow: 'auto', maxHeight, ...style }} {...rest}>
      <table style={{ width: '100%', tableLayout: allColumnsSized ? 'fixed' : 'auto', borderCollapse: 'separate', borderSpacing: 0, fontFamily: 'var(--font-sans)', fontSize: dense ? 'var(--text-xs)' : 'var(--text-sm)' }}>
        <thead>
          <tr>
            {selectable ? (
              <th style={{ position: stickyHeader ? 'sticky' : 'static', top: 0, zIndex: 2, width: 30, height: 'var(--subbar-h)', padding: '0 var(--space-5)', background: 'var(--surface-table-head)', borderBottom: '1px solid var(--border-default)' }}>
                <Checkbox checked={allSel} indeterminate={!allSel && selected.length > 0} onChange={toggleAll} />
              </th>
            ) : null}
            {columns.map((c, ci) => {
              const active = sort && sort.key === c.key;
              const stickyLeft = stickyFirstColumn && ci === 0;
              return (
                <th
                  key={c.key}
                  onClick={() => c.sortable !== false && onSortChange && onSortChange({ key: c.key, dir: active && sort.dir === 'desc' ? 'asc' : 'desc' })}
                  style={{
                    position: stickyHeader || stickyLeft ? 'sticky' : 'static',
                    top: stickyHeader ? 0 : undefined, left: stickyLeft ? 0 : undefined,
                    zIndex: stickyLeft ? (stickyHeader ? 3 : 2) : (stickyHeader ? 2 : undefined),
                    // No `padding` shorthand — see the body cell's own comment on why it mixes
                    // badly with a `paddingLeft` that needs to vary (here, by column).
                    height: 'var(--subbar-h)', paddingTop: 0, paddingBottom: 0, paddingRight: 'var(--space-6)',
                    paddingLeft: dragActive && ci === 0 ? `${HANDLE_COLUMN_PADDING_PX}px` : 'var(--space-6)',
                    width: c.width,
                    textAlign: align(c), whiteSpace: 'nowrap',
                    fontSize: 'var(--text-2xs)', fontWeight: 'var(--weight-semibold)',
                    letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase',
                    color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                    background: c.background || 'var(--surface-table-head)', borderBottom: '1px solid var(--border-default)',
                    borderRight: stickyLeft ? '1px solid var(--border-default)' : undefined,
                    cursor: c.sortable === false ? 'default' : 'pointer', userSelect: 'none',
                  }}
                  title={c.description}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', flexDirection: align(c) === 'right' ? 'row-reverse' : 'row' }}>
                    {c.label}
                    {active ? <Icon name={sort.dir === 'asc' ? 'arrow-up' : 'arrow-down'} size={10} color="var(--text-brand)" /> : null}
                    {c.description ? <Icon name="info" size={10} color="var(--text-tertiary)" /> : null}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const k = r[rowKey];
            const isGroup = r.__group;
            const expanded = expandedKey === k;
            if (isGroup) {
              const groupCellStyle = { height: h, padding: '0 var(--space-6)', background: 'var(--surface-strong)', borderBottom: '1px solid var(--border-default)', fontSize: 'var(--text-2xs)', fontWeight: 'var(--weight-semibold)', letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase', color: 'var(--text-primary)', boxShadow: dropIndicatorShadow(k, i === rows.length - 1) || undefined };
              const groupRowEvents = dragActive ? { onDragOver: (e) => dragOverRow(e, i), onDrop: dropOnRow } : null;
              if (stickyFirstColumn) {
                // Split into a sticky label cell plus a plain continuation cell, so the group
                // label stays pinned with the rest of the first column instead of scrolling
                // away as one wide colSpan cell would.
                return (
                  <tr key={k} {...groupRowEvents}>
                    <td style={{ ...groupCellStyle, position: 'sticky', left: 0, zIndex: 1, width: columns[0]?.width, whiteSpace: 'nowrap', borderRight: '1px solid var(--border-default)' }}>
                      {r.__group}
                    </td>
                    <td colSpan={columns.length - 1 + (selectable ? 1 : 0)} style={groupCellStyle} />
                  </tr>
                );
              }
              return (
                <tr key={k} {...groupRowEvents}>
                  <td colSpan={columns.length + (selectable ? 1 : 0)} style={groupCellStyle}>
                    {r.__group}
                  </td>
                </tr>
              );
            }
            const hovered = hoverRow === k;
            const rowOverrides = rowStyle ? rowStyle(r) : null;
            const dropShadow = dropIndicatorShadow(k, i === rows.length - 1);
            const draggable = dragActive && (!canDragRow || canDragRow(r));
            // Sticky cells need an opaque background of their own — otherwise cells scrolling
            // past underneath a `position: sticky` cell show through it. Only computed (and only
            // applied to the first data column) when stickyFirstColumn is on; every other row
            // keeps the plain 'transparent' default, unchanged.
            const rowBg = expanded ? 'var(--surface-selected)' : hovered ? 'var(--surface-hover)' : (striped && i % 2 ? 'var(--surface-table-stripe)' : 'var(--surface-card)');
            return (
              <React.Fragment key={k}>
                <tr
                  onMouseEnter={() => setHoverRow(k)} onMouseLeave={() => setHoverRow(null)}
                  onClick={() => onRowClick && onRowClick(r)}
                  onDragOver={dragActive ? (e) => dragOverRow(e, i) : undefined}
                  onDrop={dragActive ? dropOnRow : undefined}
                  style={{
                    background: expanded ? 'var(--surface-selected)' : hovered ? 'var(--surface-hover)' : (striped && i % 2 ? 'var(--surface-table-stripe)' : 'transparent'),
                    cursor: onRowClick ? 'pointer' : 'default', transition: 'background-color var(--dur-instant) var(--ease-out)',
                  }}
                >
                  {selectable ? (
                    <td style={{ padding: '0 var(--space-5)', borderBottom: '1px solid var(--border-subtle)' }} onClick={(e) => e.stopPropagation()}>
                      <Checkbox checked={selected.includes(k)} onChange={() => toggleRow(k)} />
                    </td>
                  ) : null}
                  {columns.map((c, ci) => {
                    const cellId = k + ':' + c.key;
                    const editable = Boolean(c.renderEdit) && (c.canEdit ? c.canEdit(r) : true);
                    const editing = editable && activeCell === cellId;
                    const stickyLeft = stickyFirstColumn && ci === 0;
                    // Constant for the whole draggable table, not tied to this one row's hover
                    // state — text must not shift left/right as the mouse moves down the column.
                    // Only the icon's own opacity (below) fades with hover; the gutter it fades
                    // into is always there.
                    const isHandleCol = dragActive && ci === 0;
                    const bgShadow = c.background ? `inset 0 0 0 999px ${c.background}` : null;
                    const cellShadow = [bgShadow, dropShadow].filter(Boolean).join(', ') || undefined;
                    // 'dblclick' (opt in per column) leaves a plain single click alone — it just
                    // bubbles to the row's own onClick, e.g. to open a details panel — and only a
                    // double click activates the editor. Everything else keeps today's behavior:
                    // a single click activates it directly.
                    const editOnDblClick = c.editTrigger === 'dblclick';
                    const activateEdit = (e) => { e.stopPropagation(); cancelledEditRef.current = false; setActiveCell(cellId); };
                    return (
                      <td
                        key={c.key}
                        onClick={editable && !editOnDblClick ? activateEdit : undefined}
                        onDoubleClick={editable && editOnDblClick ? activateEdit : undefined}
                        style={{
                          // No `padding` shorthand here — React warns against mixing it with the
                          // `paddingLeft` longhand this column needs to vary per row (the
                          // shorthand always wins that argument, so a plain `undefined` on the
                          // longhand doesn't fall back to the shorthand's value, it just clears
                          // that side to 0). Every side gets its own explicit longhand instead.
                          height: h, paddingTop: 0, paddingBottom: 0, paddingRight: 'var(--space-6)',
                          paddingLeft: isHandleCol ? `${HANDLE_COLUMN_PADDING_PX}px` : 'var(--space-6)',
                          textAlign: align(c),
                          position: isHandleCol ? 'relative' : undefined,
                          borderBottom: '1px solid var(--border-subtle)',
                          fontFamily: c.numeric ? 'var(--font-mono)' : 'var(--font-sans)',
                          fontVariantNumeric: c.numeric ? 'var(--numeric-tabular)' : undefined,
                          fontWeight: c.emphasis ? 'var(--weight-medium)' : 'var(--weight-regular)',
                          color: c.muted ? 'var(--text-secondary)' : 'var(--text-body)',
                          whiteSpace: 'nowrap', maxWidth: c.maxWidth, overflow: 'hidden', textOverflow: 'ellipsis',
                          cursor: editable && !editing ? (editOnDblClick ? 'pointer' : 'text') : undefined,
                          ...(stickyLeft ? { position: 'sticky', left: 0, zIndex: 1, background: rowBg, borderRight: '1px solid var(--border-default)' } : null),
                          ...rowOverrides,
                          // Painted last, as a shadow rather than a background, so a column tint
                          // (e.g. marking every projected-period column) stays visible as an overlay
                          // on top of a row-level background (e.g. a total row) instead of being
                          // replaced by it — the two would otherwise be indistinguishable whenever
                          // both apply to the same cell. A drag insertion indicator is just another
                          // shadow layer, combined rather than clobbering either of the above.
                          boxShadow: cellShadow,
                        }}
                      >
                        {isHandleCol && draggable ? (
                          <span
                            draggable
                            onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(k)); }}
                            onDragEnd={() => setDragOverKey(null)}
                            onClick={(e) => e.stopPropagation()}
                            style={{
                              position: 'absolute', left: HANDLE_GAP_PX, top: '50%', transform: 'translateY(-50%)',
                              display: 'inline-flex', cursor: 'grab',
                              opacity: dragHandleMode === 'always' || hovered ? 1 : 0,
                              transition: 'opacity var(--dur-instant) var(--ease-out)',
                            }}
                          >
                            <Icon name="grip-vertical" size={HANDLE_ICON_SIZE_PX} color="var(--text-tertiary)" />
                          </span>
                        ) : null}
                        {editing
                          ? c.renderEdit(r[c.key], r, () => cancelledEditRef.current)
                          : (c.render ? c.render(r[c.key], r, hovered) : r[c.key])}
                      </td>
                    );
                  })}
                </tr>
                {expanded && renderDetail ? (
                  <tr>
                    <td colSpan={columns.length + (selectable ? 1 : 0)} style={{ padding: 0, background: 'var(--surface-app)', borderBottom: '1px solid var(--border-default)' }}>
                      <div style={{ padding: 'var(--space-8)', animation: 'basis-fade-in var(--dur-base) var(--ease-out)' }}>{renderDetail(r)}</div>
                    </td>
                  </tr>
                ) : null}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
