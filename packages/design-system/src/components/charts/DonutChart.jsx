import React from 'react';

/** Composition ring with a centered total. Six slices maximum. */
export function DonutChart({ data = [], size = 132, thickness = 14, total, label, formatTotal = (v) => String(v), style, ...rest }) {
  const sum = data.reduce((a, d) => a + Math.abs(d.value), 0) || 1;
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div style={{ position: 'relative', width: size, height: size, flex: '0 0 auto', ...style }} {...rest}>
      <svg width={size} height={size} style={{ display: 'block', transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--chart-band)" strokeWidth={thickness} />
        {data.map((d, i) => {
          const len = (Math.abs(d.value) / sum) * c;
          const el = <circle key={d.label || i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={d.color || 'var(--chart-' + ((i % 12) + 1) + ')'} strokeWidth={thickness} strokeDasharray={len + ' ' + (c - len)} strokeDashoffset={-offset} style={{ transition: 'stroke-dasharray var(--dur-slow) var(--ease-out)' }} />;
          offset += len;
          return el;
        })}
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-medium)', fontVariantNumeric: 'var(--numeric-tabular)', color: 'var(--text-primary)', lineHeight: 1 }}>
          {formatTotal(total !== undefined ? total : sum)}
        </span>
        {label ? <span style={{ fontSize: 'var(--text-3xs)', fontWeight: 'var(--weight-semibold)', letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>{label}</span> : null}
      </div>
    </div>
  );
}
