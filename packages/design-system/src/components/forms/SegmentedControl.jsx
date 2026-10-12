import React from 'react';
import { Icon } from '../primitives/Icon.jsx';

/** 2–5 short mutually exclusive options in one compact row. */
export function SegmentedControl({ options = [], value, onChange, size = 'md', fullWidth = false, style, ...rest }) {
  const h = size === 'sm' ? 'var(--control-sm)' : size === 'lg' ? 'var(--control-lg)' : 'var(--control-md)';
  const fs = size === 'sm' ? 'var(--text-2xs)' : 'var(--text-xs)';
  return (
    <div
      role="tablist"
      style={{
        display: fullWidth ? 'flex' : 'inline-flex', alignItems: 'center', gap: 1, height: h, padding: 2,
        background: 'var(--surface-sunken)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)',
        boxSizing: 'border-box', ...style,
      }}
      {...rest}
    >
      {options.map((o) => {
        const on = value === o.value;
        return (
          <button
            key={o.value} type="button" role="tab" aria-selected={on} onClick={() => onChange && onChange(o.value)}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-2)',
              flex: fullWidth ? '1 1 0' : '0 0 auto', height: '100%', padding: '0 var(--space-6)',
              fontFamily: 'var(--font-sans)', fontSize: fs, fontWeight: on ? 'var(--weight-semibold)' : 'var(--weight-medium)',
              color: on ? 'var(--text-primary)' : 'var(--text-secondary)',
              background: on ? 'var(--surface-card)' : 'transparent',
              border: 'none', borderRadius: 'var(--radius-sm)',
              boxShadow: on ? 'var(--shadow-1)' : 'none', cursor: 'pointer',
              transition: 'var(--transition-control)', whiteSpace: 'nowrap',
            }}
          >
            {o.icon ? <Icon name={o.icon} size={size === 'sm' ? 11 : 12} /> : null}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
