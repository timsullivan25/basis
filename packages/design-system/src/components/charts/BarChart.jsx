import React from 'react';

/** Categorical bars, vertical or horizontal, signed-aware. */
export function BarChart({ data = [], height = 180, orientation = 'vertical', color = 'var(--chart-1)', signed = false, formatValue = (v) => v.toFixed(1), showValues = true, barSize = 18, gap = 6, style, ...rest }) {
  const vals = data.map((d) => d.value);
  const max = Math.max(0, ...vals), min = Math.min(0, ...vals);
  const span = max - min || 1;
  const colorFor = (d) => d.color || (signed ? (d.value >= 0 ? 'var(--chart-pos)' : 'var(--chart-neg)') : color);

  if (orientation === 'horizontal') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap, ...style }} {...rest}>
        {data.map((d, i) => {
          const zero = (-min / span) * 100;
          const wpc = (Math.abs(d.value) / span) * 100;
          return (
            <div key={d.label || i} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-6)' }}>
              <span style={{ width: 92, flex: '0 0 auto', fontSize: 'var(--text-2xs)', color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.label}</span>
              <div style={{ position: 'relative', flex: '1 1 auto', height: barSize, background: 'var(--chart-band)', borderRadius: 'var(--radius-xs)' }}>
                {signed ? <div style={{ position: 'absolute', left: zero + '%', top: 0, bottom: 0, width: 1, background: 'var(--chart-axis)' }} /> : null}
                <div style={{ position: 'absolute', top: 2, bottom: 2, left: signed ? (d.value >= 0 ? zero + '%' : (zero - wpc) + '%') : 0, width: wpc + '%', background: colorFor(d), borderRadius: 'var(--radius-xs)', transition: 'width var(--dur-slow) var(--ease-out)' }} />
              </div>
              {showValues ? <span style={{ width: 54, flex: '0 0 auto', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-2xs)', fontVariantNumeric: 'var(--numeric-tabular)', color: 'var(--text-primary)' }}>{formatValue(d.value)}</span> : null}
            </div>
          );
        })}
      </div>
    );
  }

  const zeroPc = (-min / span) * 100;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', ...style }} {...rest}>
      <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-end', gap, height }}>
        {signed ? <div style={{ position: 'absolute', left: 0, right: 0, bottom: zeroPc + '%', height: 1, background: 'var(--chart-axis)' }} /> : null}
        {data.map((d, i) => {
          const hpc = (Math.abs(d.value) / span) * 100;
          return (
            <div key={d.label || i} style={{ position: 'relative', flex: '1 1 0', height: '100%' }}>
              <div style={{ position: 'absolute', left: 0, right: 0, bottom: signed ? (d.value >= 0 ? zeroPc + '%' : 'auto') : 0, top: signed && d.value < 0 ? (100 - zeroPc) + '%' : 'auto', height: hpc + '%', background: colorFor(d), borderRadius: 'var(--radius-xs) var(--radius-xs) 0 0', transition: 'height var(--dur-slow) var(--ease-out)' }} />
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap }}>
        {data.map((d, i) => (
          <span key={i} style={{ flex: '1 1 0', textAlign: 'center', fontSize: 'var(--text-3xs)', color: 'var(--chart-label)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.label}</span>
        ))}
      </div>
    </div>
  );
}
