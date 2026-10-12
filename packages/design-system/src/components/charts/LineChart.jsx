import React from 'react';

/** Multi-series time-series plot: horizontal gridlines, optional zero rule, hover crosshair. */
export function LineChart({
  series = [], labels = [], height = 200, width, padding = { top: 8, right: 8, bottom: 18, left: 38 },
  yTicks = 4, zeroLine = false, formatY = (v) => v.toFixed(0), area = false, hidden = [], style, ...rest
}) {
  const [box, setBox] = React.useState({ w: width || 640 });
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (width || !ref.current) return;
    const ro = new ResizeObserver((es) => setBox({ w: es[0].contentRect.width }));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [width]);
  const [hoverI, setHoverI] = React.useState(null);
  const vis = series.filter((s) => !hidden.includes(s.key));
  const w = width || box.w, h = height;
  const pl = padding.left, pr = padding.right, pt = padding.top, pb = padding.bottom;
  const iw = Math.max(10, w - pl - pr), ih = Math.max(10, h - pt - pb);
  const all = vis.flatMap((s) => s.data || []);
  const min = all.length ? Math.min(...all) : 0, max = all.length ? Math.max(...all) : 1;
  const lo = zeroLine ? Math.min(0, min) : min, hi = max;
  const span = hi - lo || 1;
  const n = Math.max(...vis.map((s) => (s.data || []).length), 1);
  const x = (i) => pl + (n > 1 ? (i * iw) / (n - 1) : iw / 2);
  const y = (v) => pt + ih - ((v - lo) / span) * ih;
  const ticks = Array.from({ length: yTicks + 1 }, (_, i) => lo + (span * i) / yTicks);

  return (
    <div ref={ref} style={{ width: '100%', ...style }} {...rest}>
      <svg width={w} height={h} viewBox={'0 0 ' + w + ' ' + h} style={{ display: 'block', overflow: 'visible' }}
        onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); const i = Math.round(((e.clientX - r.left - pl) / iw) * (n - 1)); setHoverI(Math.max(0, Math.min(n - 1, i))); }}
        onMouseLeave={() => setHoverI(null)}
      >
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={pl} x2={w - pr} y1={y(t)} y2={y(t)} stroke="var(--chart-grid)" strokeWidth="1" />
            <text x={pl - 6} y={y(t) + 3} textAnchor="end" style={{ fill: 'var(--chart-label)', fontFamily: 'var(--font-mono)', fontSize: 9 }}>{formatY(t)}</text>
          </g>
        ))}
        {zeroLine ? <line x1={pl} x2={w - pr} y1={y(0)} y2={y(0)} stroke="var(--chart-axis)" strokeWidth="1" /> : null}
        {vis.map((s) => {
          const d = (s.data || []).map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1)).join(' ');
          return (
            <g key={s.key}>
              {area ? <path d={d + ' L ' + x(n - 1) + ' ' + y(lo) + ' L ' + x(0) + ' ' + y(lo) + ' Z'} fill={s.color} opacity="0.10" /> : null}
              <path d={d} fill="none" stroke={s.color} strokeWidth={s.dashed ? 1.25 : 1.75} strokeDasharray={s.dashed ? '3 3' : undefined} strokeLinejoin="round" strokeLinecap="round" />
            </g>
          );
        })}
        {hoverI !== null ? (
          <g>
            <line x1={x(hoverI)} x2={x(hoverI)} y1={pt} y2={pt + ih} stroke="var(--chart-crosshair)" strokeWidth="1" strokeDasharray="2 2" />
            {vis.map((s) => (s.data && s.data[hoverI] !== undefined ? <circle key={s.key} cx={x(hoverI)} cy={y(s.data[hoverI])} r="2.75" fill="var(--surface-card)" stroke={s.color} strokeWidth="1.5" /> : null))}
          </g>
        ) : null}
        {labels.map((l, i) => {
          const step = Math.ceil(labels.length / 7);
          if (i % step) return null;
          return <text key={i} x={x(i)} y={h - 4} textAnchor="middle" style={{ fill: 'var(--chart-label)', fontFamily: 'var(--font-sans)', fontSize: 9 }}>{l}</text>;
        })}
      </svg>
    </div>
  );
}
