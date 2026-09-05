import React from 'react';
import { Icon } from '../primitives/Icon.jsx';
import { IconButton } from '../primitives/IconButton.jsx';

const ALERT_TONES = {
  info: ['var(--status-info-bg)', 'var(--status-info-border)', 'var(--status-info-fg)', 'info'],
  positive: ['var(--status-positive-bg)', 'var(--status-positive-border)', 'var(--status-positive-fg)', 'check-circle-2'],
  caution: ['var(--status-caution-bg)', 'var(--status-caution-border)', 'var(--status-caution-fg)', 'alert-triangle'],
  negative: ['var(--status-negative-bg)', 'var(--status-negative-border)', 'var(--status-negative-fg)', 'octagon-alert'],
  neutral: ['var(--status-neutral-bg)', 'var(--status-neutral-border)', 'var(--status-neutral-fg)', 'info'],
};

/** Inline message bound to the view it appears in. */
export function Alert({ tone = 'info', title, children, icon, actions, onDismiss, compact = false, style, ...rest }) {
  const [bg, bd, fg, defIcon] = ALERT_TONES[tone] || ALERT_TONES.info;
  return (
    <div
      role="status"
      style={{
        display: 'flex', alignItems: compact ? 'center' : 'flex-start', gap: 'var(--space-5)',
        padding: compact ? 'var(--space-4) var(--space-6)' : 'var(--space-6) var(--space-7)',
        background: bg, border: '1px solid ' + bd, borderRadius: 'var(--radius-md)',
        fontSize: 'var(--text-xs)', color: fg, ...style,
      }}
      {...rest}
    >
      <Icon name={icon || defIcon} size={14} style={{ marginTop: compact ? 0 : 1 }} />
      <div style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: compact ? 'row' : 'column', gap: compact ? 'var(--space-4)' : 'var(--space-2)', alignItems: compact ? 'center' : 'stretch' }}>
        {title ? <strong style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)' }}>{title}</strong> : null}
        {children ? <div style={{ lineHeight: 'var(--leading-snug)', opacity: 0.92 }}>{children}</div> : null}
      </div>
      {actions ? <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flex: '0 0 auto' }}>{actions}</div> : null}
      {onDismiss ? <IconButton icon="x" label="Dismiss" size="xs" onClick={onDismiss} style={{ color: fg, flex: '0 0 auto' }} /> : null}
    </div>
  );
}
