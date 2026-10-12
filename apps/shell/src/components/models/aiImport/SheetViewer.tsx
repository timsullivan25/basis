import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { columnLetter, type GridCell, type SheetGrid } from '../../../lib/aiImport/workbookGrid';
import { dragBottomEdge, dragTopEdge, snapRange, type RowRange } from './sheetViewerMath';

export type { RowRange } from './sheetViewerMath';

const ROW_H = 24;
const GUTTER_W = 52;
const LABEL_W = 300;
const VALUE_W = 92;
const INDENT_PX = 12;
const EDGE_SCROLL_ZONE = 36;

interface SheetViewerProps {
  grid: SheetGrid;
  /** Absolute column index of the line-item labels. Cells from column A up to it are folded into one label column, indented by depth, so sub-headers keep their hierarchy. */
  labelColumn: number;
  /** Value columns to show, as absolute column indexes, in order. */
  valueColumns: number[];
  /** Rows kept visible under the column header while scrolling (period names / dates). */
  pinnedRows?: number[];
  /** The outlined region. When `onRangeChange` is given, its top and bottom edges can be dragged. */
  range?: RowRange;
  onRangeChange?: (range: RowRange) => void;
  /** Rows introducing a group inside the range — drawn emphasized. */
  groupHeaderRows?: ReadonlySet<number>;
  /** Scrolls this row into view (near the top) whenever it changes. */
  focusRow?: number | null;
  height?: CSSProperties['height'];
}

function formatValue(cell: GridCell): string {
  if (cell === null) return '';
  return typeof cell === 'number' ? cell.toLocaleString(undefined, { maximumFractionDigits: 2 }) : cell;
}

/**
 * A read-only window onto part of a worksheet, showing only the columns that matter — the label column and the
 * periods being imported. The section being imported is tinted and bracketed; drag its top or bottom handle to
 * change the range. Only non-empty rows exist in the grid, so the range snaps to real rows.
 */
export function SheetViewer({ grid, labelColumn, valueColumns, pinnedRows = [], range, onRangeChange, groupHeaderRows, focusRow, height = 480 }: SheetViewerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const lastPointerY = useRef(0);
  const [dragging, setDragging] = useState<'first' | 'last' | null>(null);

  const rows = grid.rows;
  const pinned = useMemo(() => pinnedRows.flatMap((n) => grid.rows.filter((r) => r.rowNumber === n)), [grid, pinnedRows]);
  const stickyTop = ROW_H * (1 + pinned.length);
  const totalWidth = GUTTER_W + LABEL_W + VALUE_W * valueColumns.length;

  // Index range of the outlined rows, snapped to rows that exist.
  const snapped = range ? snapRange(rows.map((r) => r.rowNumber), range) : null;
  const firstIdx = snapped?.firstIdx ?? -1;
  const lastIdx = snapped?.lastIdx ?? -1;
  const hasRange = snapped !== null;

  useEffect(() => {
    if (focusRow == null || !scrollRef.current) return;
    const idx = rows.findIndex((r) => r.rowNumber >= focusRow);
    if (idx >= 0) scrollRef.current.scrollTop = Math.max(0, idx * ROW_H - ROW_H * 3);
  }, [focusRow, rows]);

  /** Row index under a viewport Y coordinate, as a fractional boundary position (0 = above the first row). */
  function boundaryAt(clientY: number): number {
    const top = bodyRef.current?.getBoundingClientRect().top ?? 0;
    return (clientY - top) / ROW_H;
  }

  function moveHandle(which: 'first' | 'last', clientY: number) {
    if (!range || !onRangeChange || rows.length === 0) return;
    const boundary = boundaryAt(clientY);
    if (which === 'first') {
      const idx = dragTopEdge(boundary, lastIdx);
      if (idx !== firstIdx) onRangeChange({ first: rows[idx].rowNumber, last: range.last });
    } else {
      const idx = dragBottomEdge(boundary, firstIdx, rows.length);
      if (idx !== lastIdx) onRangeChange({ first: range.first, last: rows[idx].rowNumber });
    }
  }

  // While dragging near the top or bottom edge, keep scrolling so the range can be extended beyond what is visible.
  useEffect(() => {
    if (!dragging) return;
    const timer = window.setInterval(() => {
      const el = scrollRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (lastPointerY.current < rect.top + stickyTop + EDGE_SCROLL_ZONE) el.scrollTop -= 14;
      else if (lastPointerY.current > rect.bottom - EDGE_SCROLL_ZONE) el.scrollTop += 14;
      else return;
      moveHandle(dragging, lastPointerY.current);
    }, 30);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- moveHandle reads the latest range through closure on each tick
  });

  function handleProps(which: 'first' | 'last') {
    return {
      onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        lastPointerY.current = e.clientY;
        setDragging(which);
      },
      onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => {
        if (dragging !== which) return;
        lastPointerY.current = e.clientY;
        moveHandle(which, e.clientY);
      },
      onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => {
        e.currentTarget.releasePointerCapture(e.pointerId);
        setDragging(null);
      },
    };
  }

  const cellBase: CSSProperties = { height: ROW_H, lineHeight: `${ROW_H}px`, padding: '0 var(--space-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', boxSizing: 'border-box' };
  const gutterCell: CSSProperties = { ...cellBase, width: GUTTER_W, flex: '0 0 auto', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-3xs)', color: 'var(--text-tertiary)', background: 'var(--surface-table-head)', borderRight: '1px solid var(--border-hairline)' };
  const handleStyle = (top: number): CSSProperties => ({
    position: 'absolute', left: 0, right: 0, top, height: 8, cursor: 'ns-resize', zIndex: 3, touchAction: 'none',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  });

  const renderRow = (row: SheetGrid['rows'][number], idx: number, sticky?: number) => {
    const inRange = hasRange && idx >= firstIdx && idx <= lastIdx;
    const labelIdx = row.cells.slice(0, labelColumn + 1).findIndex((c) => typeof c === 'string');
    const label = labelIdx >= 0 ? (row.cells[labelIdx] as string) : '';
    const isGroupHeader = groupHeaderRows?.has(row.rowNumber) ?? false;
    return (
      <div
        key={row.rowNumber}
        style={{
          display: 'flex', width: totalWidth, height: ROW_H,
          background: sticky !== undefined ? 'var(--surface-table-head)' : inRange ? 'var(--alpha-blue-12)' : 'transparent',
          opacity: hasRange && !inRange && sticky === undefined ? 0.5 : 1,
          borderBottom: '1px solid var(--border-hairline)',
          ...(sticky !== undefined ? { position: 'sticky', top: sticky, zIndex: 2 } : {}),
        }}
      >
        <div style={gutterCell}>{row.rowNumber}</div>
        <div style={{ ...cellBase, width: LABEL_W, flex: '0 0 auto', paddingLeft: `calc(var(--space-3) + ${Math.max(labelIdx, 0) * INDENT_PX}px)`, fontSize: 'var(--text-xs)', fontWeight: isGroupHeader ? 'var(--weight-semibold)' : 'var(--weight-regular)', color: 'var(--text-primary)' }}>
          {label}
        </div>
        {valueColumns.map((col) => {
          const cell = row.cells[col] ?? null;
          return (
            <div key={col} style={{ ...cellBase, width: VALUE_W, flex: '0 0 auto', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-2xs)', color: typeof cell === 'number' && cell < 0 ? 'var(--text-negative)' : 'var(--text-body)' }}>
              {formatValue(cell)}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div ref={scrollRef} style={{ height, overflow: 'auto', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', background: 'var(--surface-card)', position: 'relative', userSelect: dragging ? 'none' : 'auto' }}>
      <div style={{ width: totalWidth, position: 'relative' }}>
        <div style={{ display: 'flex', position: 'sticky', top: 0, zIndex: 2, height: ROW_H, background: 'var(--surface-table-head)', borderBottom: '1px solid var(--border-default)' }}>
          <div style={gutterCell} />
          <div style={{ ...cellBase, width: LABEL_W, flex: '0 0 auto', fontSize: 'var(--text-3xs)', color: 'var(--text-tertiary)' }}>Line item · column {columnLetter(labelColumn)}</div>
          {valueColumns.map((col) => (
            <div key={col} style={{ ...cellBase, width: VALUE_W, flex: '0 0 auto', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-3xs)', color: 'var(--text-tertiary)' }}>
              {columnLetter(col)}
            </div>
          ))}
        </div>
        {pinned.map((row, i) => renderRow(row, -1, ROW_H * (i + 1)))}

        <div ref={bodyRef} style={{ position: 'relative' }}>
          {rows.map((row, idx) => renderRow(row, idx))}
          {hasRange ? (
            <>
              <div style={{ position: 'absolute', left: 0, top: firstIdx * ROW_H, width: totalWidth, height: (lastIdx - firstIdx + 1) * ROW_H, border: '2px solid var(--action-primary-bg)', boxSizing: 'border-box', pointerEvents: 'none', zIndex: 1 }} />
              {onRangeChange ? (
                <>
                  <div {...handleProps('first')} style={handleStyle(firstIdx * ROW_H - 4)} title="Drag to change where this section starts">
                    <span style={{ width: 44, height: 5, borderRadius: 3, background: 'var(--action-primary-bg)' }} />
                  </div>
                  <div {...handleProps('last')} style={handleStyle((lastIdx + 1) * ROW_H - 4)} title="Drag to change where this section ends">
                    <span style={{ width: 44, height: 5, borderRadius: 3, background: 'var(--action-primary-bg)' }} />
                  </div>
                </>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
