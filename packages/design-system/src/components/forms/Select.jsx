import React from 'react';
import { Icon } from '../primitives/Icon.jsx';

const FIELD_SIZES = {
  sm: { h: 'var(--control-sm)', fs: 'var(--text-xs)', px: 'var(--space-4)', icon: 12 },
  md: { h: 'var(--control-md)', fs: 'var(--text-sm)', px: 'var(--space-5)', icon: 14 },
  lg: { h: 'var(--control-lg)', fs: 'var(--text-base)', px: 'var(--space-6)', icon: 15 },
};

/** Native select styled to match Input; chevron is ours. */
export function Select({ options = [], size = 'md', iconLeft, disabled = false, invalid = false, fullWidth = true, style, ...rest }) {
  const [focus, setFocus] = React.useState(false);
  const [hover, setHover] = React.useState(false);
  const s = FIELD_SIZES[size] || FIELD_SIZES.md;
  return (
    <div
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        position: 'relative', display: fullWidth ? 'flex' : 'inline-flex', alignItems: 'center', gap: 'var(--space-3)',
        width: fullWidth ? '100%' : undefined, height: s.h, padding: '0 ' + s.px, boxSizing: 'border-box',
        background: disabled ? 'var(--field-bg-disabled)' : 'var(--field-bg)',
        border: '1px solid ' + (invalid ? 'var(--red-600)' : focus ? 'var(--border-focus)' : hover ? 'var(--field-border-hover)' : 'var(--field-border)'),
        borderRadius: 'var(--radius-md)', boxShadow: focus ? 'var(--focus-ring)' : 'var(--shadow-inset-field)',
        transition: 'var(--transition-control)', minWidth: 0, ...style,
      }}
    >
      {iconLeft ? <Icon name={iconLeft} size={s.icon} color="var(--text-tertiary)" /> : null}
      <select
        disabled={disabled} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
        style={{
          appearance: 'none', WebkitAppearance: 'none', flex: '1 1 auto', minWidth: 0, width: '100%', height: '100%',
          padding: 0, paddingRight: 'var(--space-6)', border: 'none', outline: 'none', background: 'transparent',
          fontFamily: 'var(--font-sans)', fontSize: s.fs, color: disabled ? 'var(--text-disabled)' : 'var(--text-primary)',
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
        {...rest}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>
        ))}
      </select>
      <Icon name="chevron-down" size={s.icon} color="var(--text-tertiary)" style={{ position: 'absolute', right: s.px, pointerEvents: 'none' }} />
    </div>
  );
}
