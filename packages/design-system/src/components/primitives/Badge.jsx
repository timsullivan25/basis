import React from 'react';
import { Icon } from './Icon.jsx';

const BADGE_TONES = {
  neutral: ['var(--status-neutral-bg)', 'var(--status-neutral-fg)', 'var(--status-neutral-border)'],
  info: ['var(--status-info-bg)', 'var(--status-info-fg)', 'var(--status-info-border)'],
  positive: ['var(--status-positive-bg)', 'var(--status-positive-fg)', 'var(--status-positive-border)'],
  negative: ['var(--status-negative-bg)', 'var(--status-negative-fg)', 'var(--status-negative-border)'],
  caution: ['var(--status-caution-bg)', 'var(--status-caution-fg)', 'var(--status-caution-border)'],
  brand: ['var(--blue-700)', 'var(--white)', 'transparent'],
};

/** Status pill. Reads state, not identity — use Tag for user-applied labels. */
export function Badge({ children, tone = 'neutral', size = 'md', icon, dot = false, subtle = true, style, ...rest }) {
  const [bg, fg, bd] = BADGE_TONES[tone] || BADGE_TONES.neutral;
  const small = size === 'sm';
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: small ? 'var(--space-2)' : 'var(--space-3)',
        height: small ? 'var(--control-xs)' : 'var(--control-sm)',
        padding: '0 ' + (small ? 'var(--space-3)' : 'var(--space-4)'),
        fontFamily: 'var(--font-sans)', fontSize: small ? 'var(--text-3xs)' : 'var(--text-2xs)',
        fontWeight: 'var(--weight-semibold)', letterSpacing: 'var(--tracking-wide)', lineHeight: 1,
        color: subtle ? fg : 'var(--white)', background: subtle ? bg : fg,
        border: '1px solid ' + (subtle ? bd : 'transparent'),
        borderRadius: 'var(--radius-sm)', whiteSpace: 'nowrap', ...style,
      }}
      {...rest}
    >
      {dot ? <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'currentColor', flex: '0 0 auto' }} /> : null}
      {icon ? <Icon name={icon} size={small ? 10 : 11} /> : null}
      {children}
    </span>
  );
}
