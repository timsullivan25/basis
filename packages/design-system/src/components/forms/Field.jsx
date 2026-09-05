import React from 'react';
import { Icon } from '../primitives/Icon.jsx';

/** Label + help/error scaffold shared by every input. */
export function Field({ label, hint, error, required = false, htmlFor, children, inline = false, style, ...rest }) {
  return (
    <div style={{ display: 'flex', flexDirection: inline ? 'row' : 'column', alignItems: inline ? 'center' : 'stretch', gap: inline ? 'var(--space-6)' : 'var(--space-3)', minWidth: 0, ...style }} {...rest}>
      {label ? (
        <label htmlFor={htmlFor} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--text-2xs)', fontWeight: 'var(--weight-semibold)', letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase', color: 'var(--text-secondary)', width: inline ? 120 : undefined, flex: inline ? '0 0 auto' : undefined }}>
          {label}{required ? <span style={{ color: 'var(--text-negative)' }}>*</span> : null}
          {hint && !error ? <Icon name="info" size={11} color="var(--text-tertiary)" title={hint} /> : null}
        </label>
      ) : null}
      <div style={{ minWidth: 0, flex: '1 1 auto' }}>
        {children}
        {error ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginTop: 'var(--space-2)', fontSize: 'var(--text-2xs)', color: 'var(--text-negative)' }}>
            <Icon name="alert-circle" size={11} />{error}
          </div>
        ) : (hint && !label ? <div style={{ marginTop: 'var(--space-2)', fontSize: 'var(--text-2xs)', color: 'var(--text-tertiary)' }}>{hint}</div> : null)}
      </div>
    </div>
  );
}
