import React from 'react';
import { Icon } from '../primitives/Icon.jsx';

/** 14px checkbox with indeterminate state for tree/table selection. */
export function Checkbox({ checked = false, indeterminate = false, onChange, label, description, disabled = false, style, ...rest }) {
  const on = checked || indeterminate;
  return (
    <label
      style={{ display: 'inline-flex', alignItems: description ? 'flex-start' : 'center', gap: 'var(--space-4)', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1, ...style }}
      {...rest}
    >
      <span
        onClick={(e) => { if (disabled) return; e.preventDefault(); onChange && onChange(!checked); }}
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 14, height: 14, flex: '0 0 auto', marginTop: description ? 2 : 0,
          background: on ? 'var(--action-primary-bg)' : 'var(--field-bg)',
          border: '1px solid ' + (on ? 'var(--action-primary-bg)' : 'var(--field-border)'),
          borderRadius: 'var(--radius-xs)', boxShadow: on ? 'none' : 'var(--shadow-inset-field)',
          transition: 'var(--transition-control)', color: 'var(--white)',
        }}
      >
        {indeterminate ? <Icon name="minus" size={10} /> : (checked ? <Icon name="check" size={10} /> : null)}
      </span>
      {label ? (
        <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-body)', lineHeight: 1.25 }}>{label}</span>
          {description ? <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-secondary)' }}>{description}</span> : null}
        </span>
      ) : null}
    </label>
  );
}
