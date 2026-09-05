import React from 'react';
import { Icon } from '../primitives/Icon.jsx';
import { IconButton } from '../primitives/IconButton.jsx';

/** Centered modal for focused tasks and confirmations. */
export function Dialog({ open = false, title, subtitle, icon, children, footer, onClose, width = 480, style, ...rest }) {
  if (!open) return null;
  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '10vh var(--space-9)', background: 'var(--surface-overlay)', backdropFilter: 'blur(2px)', animation: 'basis-fade-in var(--dur-fast) var(--ease-out)' }}
    >
      <div
        role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}
        style={{
          display: 'flex', flexDirection: 'column', width, maxWidth: '100%', maxHeight: '80vh',
          background: 'var(--surface-card)', border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-4)', overflow: 'hidden',
          animation: 'basis-pop-in var(--dur-base) var(--ease-snap)', ...style,
        }}
        {...rest}
      >
        <header style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-5)', padding: 'var(--space-7) var(--space-8)', borderBottom: '1px solid var(--border-subtle)', flex: '0 0 auto' }}>
          {icon ? <Icon name={icon} size={15} color="var(--text-brand)" /> : null}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
            <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-semibold)', letterSpacing: 'var(--tracking-heading)', color: 'var(--text-primary)' }}>{title}</h2>
            {subtitle ? <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-secondary)' }}>{subtitle}</span> : null}
          </div>
          <IconButton icon="x" label="Close" size="sm" onClick={onClose} style={{ marginLeft: 'auto' }} />
        </header>
        <div style={{ padding: 'var(--space-8)', overflow: 'auto', flex: '1 1 auto' }}>{children}</div>
        {footer ? (
          <footer style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 'var(--space-5)', padding: 'var(--space-6) var(--space-8)', borderTop: '1px solid var(--border-subtle)', background: 'var(--surface-table-head)', flex: '0 0 auto' }}>{footer}</footer>
        ) : null}
      </div>
    </div>
  );
}
