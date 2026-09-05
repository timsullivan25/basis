import React from 'react';
import { Icon } from '../primitives/Icon.jsx';

const FIELD_SIZES = {
  sm: { h: 'var(--control-sm)', fs: 'var(--text-xs)', px: 'var(--space-4)', icon: 12 },
  md: { h: 'var(--control-md)', fs: 'var(--text-sm)', px: 'var(--space-5)', icon: 14 },
  lg: { h: 'var(--control-lg)', fs: 'var(--text-base)', px: 'var(--space-6)', icon: 15 },
};

/** Single-line text/number input with optional icons, prefix and unit suffix. */
export function Input({ size = 'md', iconLeft, iconRight, prefix, suffix, invalid = false, disabled = false, mono = false, fullWidth = true, style, onClear, value, ...rest }) {
  const [focus, setFocus] = React.useState(false);
  const [hover, setHover] = React.useState(false);
  const s = FIELD_SIZES[size] || FIELD_SIZES.md;
  const border = invalid ? 'var(--red-600)' : focus ? 'var(--border-focus)' : hover ? 'var(--field-border-hover)' : 'var(--field-border)';
  return (
    <div
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        display: fullWidth ? 'flex' : 'inline-flex', alignItems: 'center', gap: 'var(--space-3)',
        width: fullWidth ? '100%' : undefined, height: s.h, padding: '0 ' + s.px, boxSizing: 'border-box',
        background: disabled ? 'var(--field-bg-disabled)' : 'var(--field-bg)',
        border: '1px solid ' + border, borderRadius: 'var(--radius-md)',
        boxShadow: focus ? (invalid ? 'var(--focus-ring-danger)' : 'var(--focus-ring)') : 'var(--shadow-inset-field)',
        transition: 'var(--transition-control)', minWidth: 0, ...style,
      }}
    >
      {iconLeft ? <Icon name={iconLeft} size={s.icon} color="var(--text-tertiary)" /> : null}
      {prefix ? <span style={{ fontSize: s.fs, color: 'var(--text-tertiary)', flex: '0 0 auto' }}>{prefix}</span> : null}
      <input
        value={value} disabled={disabled}
        onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
        style={{
          flex: '1 1 auto', minWidth: 0, width: '100%', height: '100%', padding: 0,
          border: 'none', outline: 'none', background: 'transparent',
          fontFamily: mono ? 'var(--font-mono)' : 'var(--font-sans)', fontSize: s.fs,
          fontVariantNumeric: mono ? 'var(--numeric-tabular)' : undefined,
          color: disabled ? 'var(--text-disabled)' : 'var(--text-primary)',
        }}
        {...rest}
      />
      {suffix ? <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-2xs)', color: 'var(--text-tertiary)', flex: '0 0 auto' }}>{suffix}</span> : null}
      {onClear && value ? (
        <button type="button" aria-label="Clear" onClick={onClear} style={{ display: 'inline-flex', padding: 0, border: 'none', background: 'transparent', color: 'var(--text-tertiary)', cursor: 'pointer' }}><Icon name="x" size={s.icon} /></button>
      ) : null}
      {iconRight ? <Icon name={iconRight} size={s.icon} color="var(--text-tertiary)" /> : null}
    </div>
  );
}
