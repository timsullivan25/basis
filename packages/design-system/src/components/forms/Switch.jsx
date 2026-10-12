import React from 'react';

/** Toggle for immediate-effect settings (live updates, dark mode, overlays). */
export function Switch({ checked = false, onChange, label, size = 'md', disabled = false, style, ...rest }) {
  const w = size === 'sm' ? 24 : 30, h = size === 'sm' ? 14 : 17, k = h - 4;
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-5)', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1, ...style }} {...rest}>
      <span
        onClick={(e) => { if (disabled) return; e.preventDefault(); onChange && onChange(!checked); }}
        style={{
          position: 'relative', display: 'inline-flex', alignItems: 'center', width: w, height: h, flex: '0 0 auto',
          background: checked ? 'var(--action-primary-bg)' : 'var(--ink-200)',
          border: '1px solid ' + (checked ? 'var(--action-primary-bg)' : 'var(--ink-200)'),
          borderRadius: 'var(--radius-pill)', transition: 'background-color var(--dur-base) var(--ease-out)',
        }}
      >
        <span style={{ position: 'absolute', left: checked ? w - k - 3 : 1, width: k, height: k, background: 'var(--white)', borderRadius: '50%', boxShadow: 'var(--shadow-1)', transition: 'left var(--dur-base) var(--ease-snap)' }} />
      </span>
      {label ? <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-body)' }}>{label}</span> : null}
    </label>
  );
}
