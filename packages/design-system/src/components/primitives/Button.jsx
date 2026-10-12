import React from 'react';
import { Icon } from './Icon.jsx';

const BTN_SIZES = {
  xs: { h: 'var(--control-xs)', px: 'var(--space-3)', fs: 'var(--text-2xs)', icon: 11, gap: 'var(--space-2)' },
  sm: { h: 'var(--control-sm)', px: 'var(--space-4)', fs: 'var(--text-xs)', icon: 12, gap: 'var(--space-2)' },
  md: { h: 'var(--control-md)', px: 'var(--space-6)', fs: 'var(--text-sm)', icon: 14, gap: 'var(--space-3)' },
  lg: { h: 'var(--control-lg)', px: 'var(--space-8)', fs: 'var(--text-base)', icon: 15, gap: 'var(--space-3)' },
};

const BTN_VARIANTS = {
  primary: { bg: 'var(--action-primary-bg)', bgH: 'var(--action-primary-bg-hover)', fg: 'var(--action-primary-fg)', bd: 'transparent', sh: 'var(--shadow-1)' },
  secondary: { bg: 'var(--action-secondary-bg)', bgH: 'var(--action-secondary-bg-hover)', fg: 'var(--action-secondary-fg)', bd: 'var(--action-secondary-border)', sh: 'var(--shadow-1)' },
  ghost: { bg: 'transparent', bgH: 'var(--action-ghost-bg-hover)', fg: 'var(--action-ghost-fg)', bd: 'transparent', sh: 'none' },
  danger: { bg: 'var(--action-danger-bg)', bgH: 'var(--action-danger-bg-hover)', fg: 'var(--white)', bd: 'transparent', sh: 'var(--shadow-1)' },
  link: { bg: 'transparent', bgH: 'transparent', fg: 'var(--text-link)', bd: 'transparent', sh: 'none' },
};

/** Compact action button. */
export function Button({
  children, variant = 'secondary', size = 'md', iconLeft, iconRight,
  disabled = false, loading = false, fullWidth = false, selected = false,
  type = 'button', style, onClick, ...rest
}) {
  const [hover, setHover] = React.useState(false);
  const [down, setDown] = React.useState(false);
  const s = BTN_SIZES[size] || BTN_SIZES.md;
  const v = BTN_VARIANTS[variant] || BTN_VARIANTS.secondary;
  const idle = selected ? 'var(--surface-selected)' : v.bg;
  return (
    <button
      type={type}
      disabled={disabled || loading}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setDown(false); }}
      onMouseDown={() => setDown(true)}
      onMouseUp={() => setDown(false)}
      style={{
        display: fullWidth ? 'flex' : 'inline-flex', width: fullWidth ? '100%' : undefined,
        alignItems: 'center', justifyContent: 'center', gap: s.gap,
        height: s.h, padding: '0 ' + s.px, boxSizing: 'border-box',
        font: 'inherit', fontFamily: 'var(--font-sans)', fontSize: s.fs,
        fontWeight: 'var(--weight-medium)', letterSpacing: 'var(--tracking-normal)',
        lineHeight: 1, whiteSpace: 'nowrap',
        color: disabled ? 'var(--text-disabled)' : v.fg,
        background: disabled ? 'var(--field-bg-disabled)' : (hover && !loading ? v.bgH : idle),
        border: '1px solid ' + (disabled ? 'var(--border-default)' : (selected ? 'var(--blue-300)' : v.bd)),
        borderRadius: 'var(--radius-md)',
        boxShadow: disabled ? 'none' : v.sh,
        textDecoration: variant === 'link' && hover ? 'underline' : 'none',
        transform: down && !disabled ? 'translateY(0.5px)' : 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'var(--transition-control), transform var(--dur-instant) var(--ease-out)',
        opacity: loading ? 0.75 : 1,
        ...style,
      }}
      {...rest}
    >
      {loading ? <Icon name="loader-circle" size={s.icon} style={{ animation: 'basis-spin 700ms linear infinite' }} /> : (iconLeft ? <Icon name={iconLeft} size={s.icon} /> : null)}
      {children}
      {iconRight ? <Icon name={iconRight} size={s.icon} /> : null}
    </button>
  );
}
