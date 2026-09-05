import React from 'react';
import { Icon } from './Icon.jsx';

const IB_SIZES = { xs: { box: 'var(--control-xs)', icon: 11 }, sm: { box: 'var(--control-sm)', icon: 13 }, md: { box: 'var(--control-md)', icon: 14 }, lg: { box: 'var(--control-lg)', icon: 16 } };

/** Square icon-only control for toolbars, table rows and panel headers. */
export function IconButton({ icon = 'more-horizontal', label, size = 'md', variant = 'ghost', disabled = false, selected = false, style, onClick, ...rest }) {
  const [hover, setHover] = React.useState(false);
  const s = IB_SIZES[size] || IB_SIZES.md;
  const bordered = variant === 'outline';
  return (
    <button
      type="button" aria-label={label || icon} title={label} disabled={disabled} onClick={onClick}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: s.box, height: s.box, padding: 0, boxSizing: 'border-box',
        color: disabled ? 'var(--text-disabled)' : (selected ? 'var(--text-brand)' : 'var(--action-ghost-fg)'),
        background: selected ? 'var(--surface-selected)' : (hover && !disabled ? 'var(--action-ghost-bg-hover)' : (bordered ? 'var(--action-secondary-bg)' : 'transparent')),
        border: '1px solid ' + (bordered ? 'var(--action-secondary-border)' : 'transparent'),
        borderRadius: 'var(--radius-sm)', cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'var(--transition-control)', ...style,
      }}
      {...rest}
    >
      <Icon name={icon} size={s.icon} />
    </button>
  );
}
