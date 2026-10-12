import React from 'react';

/** Radio group — one column or one row of mutually exclusive options. */
export function Radio({ options = [], value, onChange, name, direction = 'column', disabled = false, style, ...rest }) {
  return (
    <div role="radiogroup" style={{ display: 'flex', flexDirection: direction, gap: direction === 'row' ? 'var(--space-9)' : 'var(--space-5)', ...style }} {...rest}>
      {options.map((o) => {
        const on = value === o.value;
        const off = disabled || o.disabled;
        return (
          <label key={o.value} style={{ display: 'inline-flex', alignItems: o.description ? 'flex-start' : 'center', gap: 'var(--space-4)', cursor: off ? 'not-allowed' : 'pointer', opacity: off ? 0.6 : 1 }}>
            <input type="radio" name={name} checked={on} disabled={off} onChange={() => onChange && onChange(o.value)} style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }} />
            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 14, height: 14, flex: '0 0 auto', marginTop: o.description ? 2 : 0, background: 'var(--field-bg)', border: '1px solid ' + (on ? 'var(--action-primary-bg)' : 'var(--field-border)'), borderRadius: '50%', boxShadow: on ? 'none' : 'var(--shadow-inset-field)', transition: 'var(--transition-control)' }}>
              {on ? <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--action-primary-bg)' }} /> : null}
            </span>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-body)', lineHeight: 1.25 }}>{o.label}</span>
              {o.description ? <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-secondary)' }}>{o.description}</span> : null}
            </span>
          </label>
        );
      })}
    </div>
  );
}
