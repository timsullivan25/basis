import React from 'react';
import { Icon } from './Icon.jsx';

/** User-applied label: filters, taxonomies, saved-screen criteria. Removable. */
export function Tag({ children, icon, onRemove, color, interactive = false, style, ...rest }) {
  const [hover, setHover] = React.useState(false);
  return (
    <span
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 'var(--space-3)',
        height: 'var(--control-sm)', padding: '0 var(--space-3) 0 var(--space-4)',
        fontFamily: 'var(--font-sans)', fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-medium)',
        lineHeight: 1, color: 'var(--text-body)',
        background: interactive && hover ? 'var(--surface-active)' : 'var(--surface-sunken)',
        border: '1px solid var(--border-default)', borderRadius: 'var(--radius-pill)',
        cursor: interactive ? 'pointer' : 'default', transition: 'var(--transition-control)',
        whiteSpace: 'nowrap', ...style,
      }}
      {...rest}
    >
      {color ? <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flex: '0 0 auto' }} /> : null}
      {icon ? <Icon name={icon} size={11} color="var(--text-secondary)" /> : null}
      <span style={{ paddingRight: onRemove ? 0 : 'var(--space-2)' }}>{children}</span>
      {onRemove ? (
        <button type="button" aria-label="Remove" onClick={onRemove}
          style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 15, height: 15, padding: 0, marginRight: 1, color: 'var(--text-tertiary)', background: 'transparent', border: 'none', borderRadius: '50%', cursor: 'pointer' }}>
          <Icon name="x" size={10} />
        </button>
      ) : null}
    </span>
  );
}
