import { useEffect, useRef, useState } from 'react';
import { formatDriverValue } from './DriverValueInput';

function clone(values: (number | null)[]): (number | null)[] {
  return [...values];
}

/** Computes a Y-domain from whatever's actually being plotted (same inline min/max-from-data
 *  approach the design system's own LineChart.jsx uses — there's no driver-level min/max/bound
 *  concept anywhere in the schema, so there's nothing else to derive a domain from), padded ~15%
 *  so a point never sits flush against the plot edge. Falls back to a plain [0,1] range on the
 *  (pathological) case of no numeric data at all, just so the math below never divides by zero. */
function computeDomain(values: (number | null)[]): { lo: number; hi: number } {
  const nums = values.filter((v): v is number => v !== null);
  if (nums.length === 0) return { lo: 0, hi: 1 };
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  if (min === max) {
    const pad = Math.abs(min) * 0.15 || 1;
    return { lo: min - pad, hi: max + pad };
  }
  const pad = (max - min) * 0.15;
  return { lo: min - pad, hi: max + pad };
}

/** Builds one or more polyline point-strings from a value series, breaking at any null so a gap
 *  in the data (e.g. a 'growth' driver's undefined first-period ratio) doesn't draw a line
 *  through it — same idea LineChart's own gap handling would want, just done inline here since
 *  this component owns its own point layout instead of reusing LineChart (see DriverChart's own
 *  doc comment for why: no per-point interaction surface exists on LineChart to build on). */
function polylineSegments(values: (number | null)[], x: (i: number) => number, y: (v: number) => number): string[] {
  const segments: string[] = [];
  let current: string[] = [];
  values.forEach((v, i) => {
    if (v === null) {
      if (current.length > 1) segments.push(current.join(' '));
      current = [];
      return;
    }
    current.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  });
  if (current.length > 1) segments.push(current.join(' '));
  return segments;
}

/** An interactive chart for one driver's historical + projected values — historical points are
 *  fixed/dimmed, projected points are draggable circles that write a new value on release. No
 *  design-system chart component (LineChart et al.) exposes a per-point interaction hook or an
 *  exposed x/y scale, so this is purpose-built rather than an extension of one — see the plan's
 *  exploration notes. Modeled closely on an earlier design mockup's own chartEl/dragStart, adapted
 *  to real driver data (its hardcoded per-driver min/max becomes a live domain computed from
 *  historicalValues/projectedValues instead, since no such bound exists anywhere in this schema).
 *
 *  `columnWidth` is a FIXED pixel width per period, supplied by the caller rather than measured
 *  from this component's own container — every point sits at the exact horizontal center of its
 *  column, `columnWidth * (i + 0.5)`, with no internal left/right gutter for axis labels (there are
 *  none — see below). This is deliberate, not a simplification: the caller renders a real editable
 *  cell for every period directly in the driver row, and this chart needs to line up with those
 *  exact same columns when it's shown underneath one. A responsive, independently-sized chart (the
 *  original design) can never guarantee that alignment against a sibling element laid out by
 *  different rules, so the chart gave up its own sizing autonomy in favor of the caller's grid.
 *
 *  No Y-axis tick value labels either, for the same reason: once a real cell above (or a value
 *  label directly over each point) already shows the precise number, a left-side axis gutter was
 *  just consuming space that broke the column alignment for no remaining benefit — gridlines alone
 *  still give the eye a sense of scale.
 *
 *  The Y-domain (and therefore the pixel↔value scale) is frozen for the duration of a single drag
 *  gesture, captured once on pointerdown — recomputing it every pointermove would make a fixed
 *  physical mouse movement correspond to a different data delta each frame (the scale it was
 *  measured against just changed), a feedback loop with no stable feel. Dragging is never value-
 *  clamped, though — past the frozen grid's edge, a point (and the live readout) simply keeps
 *  going; the next normal render (after release) recomputes the domain fresh from wherever the
 *  data ended up. */
export function DriverChart({
  historicalValues, projectedLabels, projectedValues, unit, columnWidth, dragMode, onDragChange, onDragEnd,
}: {
  historicalValues: (number | null)[];
  projectedLabels: string[];
  projectedValues: (number | null)[];
  unit: string;
  columnWidth: number;
  dragMode: 'point' | 'all';
  onDragChange?: (readout: string | null) => void;
  onDragEnd: (nextProjectedValues: (number | null)[]) => void;
}) {
  const [dragValues, setDragValues] = useState<(number | null)[] | null>(null);
  const cleanupDragRef = useRef<(() => void) | null>(null);

  // If this chart unmounts mid-drag (the active scenario changed, remounting the whole accordion
  // via key={activeScenarioId} in ModelWorkspaceScreen) the drag must not keep running against a
  // component that no longer exists — its pointermove/pointerup listeners live on `window`, outside
  // React's own DOM-node-scoped cleanup, so nothing removes them on unmount without this. Without
  // it, a stale drag can complete later and commit to whatever scenario was active when the drag
  // STARTED, not the one on screen when the mouse is released. This makes a mid-drag scenario
  // switch simply abandon the drag — the same "mid-edit discard on scenario switch" the table's
  // own DriverValueInput already gets for free from React unmounting a focused input.
  useEffect(() => () => cleanupDragRef.current?.(), []);

  const h = 180;
  const pt = 16, pb = 8;
  const ih = h - pt - pb;
  const displayed = dragValues ?? projectedValues;
  const allValues = historicalValues.concat(displayed);
  const n = allValues.length;
  const w = columnWidth * n;
  const { lo, hi } = computeDomain(allValues);

  const x = (i: number) => columnWidth * (i + 0.5);
  const y = (v: number) => pt + ih - ((v - lo) / (hi - lo || 1)) * ih;

  const yTicks = 3;
  const ticks = Array.from({ length: yTicks + 1 }, (_, i) => lo + ((hi - lo) * i) / yTicks);

  const histCount = historicalValues.length;
  const dividerX = histCount > 0 && n > histCount ? histCount * columnWidth : 0;
  // The literal last historical slot, not just any non-null historical value — it has to line up
  // with the x-position the connecting line below is drawn from (histCount - 1).
  const lastHistoricalValue = histCount > 0 ? historicalValues[histCount - 1] : null;

  function startDrag(projIndex: number) {
    return (e: React.PointerEvent<SVGCircleElement>) => {
      e.preventDefault();
      const startY = e.clientY;
      const start = clone(projectedValues);
      const startValue = start[projIndex];
      if (startValue === null) return;
      const all = dragMode === 'all';
      // Frozen for the whole gesture — see the component doc comment above.
      const domainSpan = hi - lo || 1;

      const move = (ev: PointerEvent) => {
        const delta = ((startY - ev.clientY) * domainSpan) / ih;
        const next = clone(start);
        if (all) {
          start.forEach((v, i) => {
            if (v !== null) next[i] = v + delta;
          });
        } else {
          next[projIndex] = startValue + delta;
        }
        setDragValues(next);
        const label = all ? 'All periods' : projectedLabels[projIndex];
        const sign = delta >= 0 ? '+' : '−';
        onDragChange?.(`${label} ${sign}${formatDriverValue(Math.abs(delta), unit)}`);
      };
      const detach = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      const up = () => {
        cleanupDragRef.current = null;
        detach();
        setDragValues((current) => {
          if (current) onDragEnd(current);
          return null;
        });
        onDragChange?.(null);
      };
      cleanupDragRef.current = detach;
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    };
  }

  return (
    <svg width={w} height={h} style={{ display: 'block', touchAction: 'none', flex: 'none' }}>
      {ticks.map((t, i) => (
        <line key={i} x1={0} x2={w} y1={y(t)} y2={y(t)} stroke="var(--chart-grid)" strokeWidth={1} />
      ))}

      <rect x={dividerX} y={pt} width={Math.max(0, w - dividerX)} height={ih} fill="var(--alpha-blue-06)" />
      {histCount > 0 && n > histCount ? (
        <line x1={dividerX} x2={dividerX} y1={pt} y2={pt + ih} stroke="var(--border-strong-c)" strokeDasharray="3 3" strokeWidth={1} />
      ) : null}

      {polylineSegments(historicalValues, x, y).map((points, i) => (
        <polyline key={`h${i}`} points={points} fill="none" stroke="var(--ink-400)" strokeWidth={1.75} />
      ))}
      {/* Prepending the last historical value (not a new point, just a line origin) draws a
          continuous line across the actual/projected divider instead of a visible gap — the last
          historical circle still belongs to the historical polyline above, this just makes the
          projected line visually pick up from where it left off rather than floating separately. */}
      {polylineSegments(
        lastHistoricalValue === null ? displayed : [lastHistoricalValue, ...displayed],
        (i) => x(lastHistoricalValue === null ? i + histCount : i + histCount - 1),
        y,
      ).map((points, i) => (
        <polyline key={`p${i}`} points={points} fill="none" stroke="var(--blue-700)" strokeWidth={2} />
      ))}

      {historicalValues.map((v, i) =>
        v === null ? null : (
          <g key={`h${i}`}>
            <circle cx={x(i)} cy={y(v)} r={3} fill="var(--ink-400)" stroke="var(--ink-400)" strokeWidth={2} />
            <text x={x(i)} y={y(v) - 8} textAnchor="middle" style={{ fill: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', fontSize: 9 }}>
              {formatDriverValue(v, unit)}
            </text>
          </g>
        ),
      )}
      {displayed.map((v, i) =>
        v === null ? null : (
          <g key={`p${i}`}>
            <circle
              cx={x(i + histCount)}
              cy={y(v)}
              r={5}
              fill="var(--surface-card)"
              stroke="var(--blue-700)"
              strokeWidth={2}
              style={{ cursor: 'ns-resize' }}
              onPointerDown={startDrag(i)}
            />
            <text x={x(i + histCount)} y={y(v) - 11} textAnchor="middle" style={{ fill: 'var(--blue-800)', fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600 }}>
              {formatDriverValue(v, unit)}
            </text>
          </g>
        ),
      )}
    </svg>
  );
}

/** A tiny, non-interactive preview of a driver's historical+projected shape — sits next to a
 *  driver's name so its trend reads at a glance without scanning every period cell. One uniform
 *  color rather than the main chart's dimmed-historical/blue-projected split: at this size (a few
 *  dozen px) that distinction reads as noise, not signal — the big chart already shows it precisely
 *  once expanded, this is just "what shape is this line," matching the mockup's own per-row
 *  sparkline treatment (a single color, no actual/projected split). */
export function DriverSparkline({ values, width = 56, height = 18 }: { values: (number | null)[]; width?: number; height?: number }) {
  const nums = values.filter((v): v is number => v !== null);
  if (nums.length < 2) return null;
  const lo = Math.min(...nums), hi = Math.max(...nums);
  const span = hi - lo || 1;
  const x = (i: number) => (width * i) / (values.length - 1);
  const y = (v: number) => height - 2 - ((v - lo) / span) * (height - 4);
  return (
    <svg width={width} height={height} style={{ display: 'block', flex: 'none' }}>
      {polylineSegments(values, x, y).map((points, i) => (
        <polyline key={i} points={points} fill="none" stroke="var(--sky-600)" strokeWidth={1.5} />
      ))}
    </svg>
  );
}
