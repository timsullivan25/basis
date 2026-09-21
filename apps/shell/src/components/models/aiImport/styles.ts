import type { CSSProperties } from 'react';

export const sectionTitle: CSSProperties = {
  fontSize: 'var(--text-2xs)', fontWeight: 'var(--weight-medium)', color: 'var(--text-tertiary)',
  textTransform: 'uppercase', letterSpacing: '0.04em',
};
export const mutedText: CSSProperties = { fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' };
export const cardStyle: CSSProperties = {
  background: 'var(--surface-card)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)',
  padding: 'var(--space-6)',
};
