import React from 'react';

/** Inline utilization/limit bar for table cells and risk rows. */
export function BarMeter({ value = 0, max = 100, limit, color = 'var(--chart-1)', height = 6, width = '100%', showValue = false, formatValue = (v) => v.toFixed(1) + '%', style, ...rest }) {
  const pc = Math.max(0, Math.min(100, (value / (max || 1)) * 100));
  const over = limit !== undefined && value > limit;
  const fill = over ? 'var(--value-down)' : color;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', width, ...style }} {...rest}>
      <div style={{ position: 'relative', flex: '1 1 auto', height, background: 'var(--chart-band)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-pill)', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, width: pc + '%', background: fill, borderRadius: 'var(--radius-pill)', transition: 'width var(--dur-slow) var(--ease-out)' }} />
        {limit !== undefined ? <div style={{ position: 'absolute', top: -2, bottom: -2, left: Math.min(100, (limit / (max || 1)) * 100) + '%', width: 1.5, background: 'var(--ink-700)' }} /> : null}
      </div>
      {showValue ? <span style={{ flex: '0 0 auto', minWidth: 44, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-2xs)', fontVariantNumeric: 'var(--numeric-tabular)', color: over ? 'var(--text-negative)' : 'var(--text-body)' }}>{formatValue(value)}</span> : null}
    </div>
  );
}
