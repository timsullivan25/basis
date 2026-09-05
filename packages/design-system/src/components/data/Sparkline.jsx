import React from 'react';

/** Inline trend line, no axes. Signals shape only — pair with a number. */
export function Sparkline({ data = [], width = 72, height = 20, color, area = true, baseline = false, strokeWidth = 1.25, style, ...rest }) {
  if (!data.length) return <svg width={width} height={height} style={style} />;
  const min = Math.min(...data), max = Math.max(...data);
  const span = max - min || 1;
  const dx = data.length > 1 ? (width - 2) / (data.length - 1) : 0;
  const y = (v) => height - 1.5 - ((v - min) / span) * (height - 3);
  const pts = data.map((v, i) => [1 + i * dx, y(v)]);
  const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(2) + ' ' + p[1].toFixed(2)).join(' ');
  const up = data[data.length - 1] >= data[0];
  const c = color || (up ? 'var(--value-up)' : 'var(--value-down)');
  const id = React.useMemo(() => 'spark' + Math.random().toString(36).slice(2, 8), []);
  return (
    <svg width={width} height={height} viewBox={'0 0 ' + width + ' ' + height} style={{ display: 'block', overflow: 'visible', ...style }} {...rest}>
      {area ? (
        <>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={c} stopOpacity="0.18" />
              <stop offset="100%" stopColor={c} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={line + ' L ' + (1 + (data.length - 1) * dx).toFixed(2) + ' ' + height + ' L 1 ' + height + ' Z'} fill={'url(#' + id + ')'} stroke="none" />
        </>
      ) : null}
      {baseline ? <line x1="0" y1={y(data[0])} x2={width} y2={y(data[0])} stroke="var(--chart-grid)" strokeWidth="1" strokeDasharray="2 2" /> : null}
      <path d={line} fill="none" stroke={c} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="1.75" fill={c} />
    </svg>
  );
}
