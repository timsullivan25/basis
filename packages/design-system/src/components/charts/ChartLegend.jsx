import React from 'react';

/** Series key for any chart. Clickable entries toggle series visibility. */
export function ChartLegend({ series = [], hidden = [], onToggle, size = 'md', direction = 'row', style, ...rest }) {
  const fs = size === 'sm' ? 'var(--text-3xs)' : 'var(--text-2xs)';
  return (
    <div style={{ display: 'flex', flexDirection: direction, flexWrap: 'wrap', gap: direction === 'row' ? 'var(--space-7)' : 'var(--space-3)', alignItems: direction === 'row' ? 'center' : 'stretch', ...style }} {...rest}>
      {series.map((s) => {
        const off = hidden.includes(s.key);
        return (
          <button
            key={s.key} type="button" onClick={() => onToggle && onToggle(s.key)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 'var(--space-3)', padding: 0,
              background: 'transparent', border: 'none', cursor: onToggle ? 'pointer' : 'default',
              fontFamily: 'var(--font-sans)', fontSize: fs, fontWeight: 'var(--weight-medium)',
              color: off ? 'var(--text-disabled)' : 'var(--text-secondary)', whiteSpace: 'nowrap',
              transition: 'color var(--dur-fast) var(--ease-out)',
            }}
          >
            <span style={{ width: s.dashed ? 12 : 8, height: s.dashed ? 0 : 8, flex: '0 0 auto', background: off ? 'var(--ink-300)' : s.color, borderRadius: s.dashed ? 0 : 2, borderTop: s.dashed ? '1.5px dashed ' + (off ? 'var(--ink-300)' : s.color) : undefined }} />
            {s.label}
            {s.value !== undefined ? <span style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'var(--numeric-tabular)', color: off ? 'var(--text-disabled)' : 'var(--text-primary)' }}>{s.value}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
