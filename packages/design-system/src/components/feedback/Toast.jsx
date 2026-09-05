import React from 'react';
import { Icon } from '../primitives/Icon.jsx';
import { IconButton } from '../primitives/IconButton.jsx';

const TOAST_FG = { info: 'var(--blue-300)', positive: 'var(--green-300)', negative: 'var(--red-300)', caution: 'var(--amber-300)' };
const TOAST_ICON = { info: 'info', positive: 'check-circle-2', negative: 'octagon-alert', caution: 'alert-triangle' };

/** Transient confirmation on the inverse surface. */
export function Toast({ tone = 'info', title, children, action, onDismiss, style, ...rest }) {
  return (
    <div
      role="status"
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 'var(--space-5)', width: 320,
        padding: 'var(--space-6) var(--space-7)', background: 'var(--ink-900)',
        border: '1px solid var(--alpha-white-12)', borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-4)', color: 'var(--ink-150)', fontSize: 'var(--text-xs)',
        animation: 'basis-pop-in var(--dur-base) var(--ease-snap)', ...style,
      }}
      {...rest}
    >
      <Icon name={TOAST_ICON[tone] || 'info'} size={14} color={TOAST_FG[tone] || TOAST_FG.info} style={{ marginTop: 1 }} />
      <div style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        {title ? <strong style={{ color: 'var(--white)', fontWeight: 'var(--weight-semibold)' }}>{title}</strong> : null}
        {children ? <span style={{ lineHeight: 'var(--leading-snug)', color: 'var(--ink-300)' }}>{children}</span> : null}
        {action ? <div style={{ marginTop: 'var(--space-2)' }}>{action}</div> : null}
      </div>
      {onDismiss ? <IconButton icon="x" label="Dismiss" size="xs" onClick={onDismiss} style={{ color: 'var(--ink-400)' }} /> : null}
    </div>
  );
}
