import React from 'react';
import { Icon } from './Icon.jsx';

/** Surface container: 1px hairline, 5px radius, flat by default. */
export function Card({ children, title, subtitle, icon, actions, footer, padding = 'md', elevation = 0, dense = false, style, bodyStyle, ...rest }) {
  const pad = { none: '0', sm: 'var(--space-6)', md: 'var(--space-8)', lg: 'var(--space-10)' }[padding] || 'var(--space-8)';
  const shadow = ['none', 'var(--shadow-1)', 'var(--shadow-2)', 'var(--shadow-3)'][elevation] || 'none';
  const hasHeader = title || actions;
  return (
    <section
      style={{
        display: 'flex', flexDirection: 'column', minWidth: 0,
        background: 'var(--surface-card)', border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-md)', boxShadow: shadow, overflow: 'hidden', ...style,
      }}
      {...rest}
    >
      {hasHeader ? (
        <header style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-6)', minHeight: dense ? 'var(--subbar-h)' : 40, padding: dense ? '0 var(--space-6)' : '0 var(--space-8)', borderBottom: '1px solid var(--border-subtle)', flex: '0 0 auto' }}>
          {icon ? <Icon name={icon} size={14} color="var(--text-secondary)" /> : null}
          <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
            <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', letterSpacing: 'var(--tracking-heading)', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</h3>
            {subtitle ? <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-secondary)' }}>{subtitle}</span> : null}
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>{actions}</div>
        </header>
      ) : null}
      <div style={{ padding: pad, minWidth: 0, flex: '1 1 auto', ...bodyStyle }}>{children}</div>
      {footer ? (
        <footer style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-6)', minHeight: 'var(--subbar-h)', padding: '0 var(--space-8)', borderTop: '1px solid var(--border-subtle)', background: 'var(--surface-table-head)', fontSize: 'var(--text-2xs)', color: 'var(--text-secondary)' }}>{footer}</footer>
      ) : null}
    </section>
  );
}
