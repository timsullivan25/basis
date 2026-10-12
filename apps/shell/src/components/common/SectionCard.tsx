import type { ReactNode } from 'react';
import { Card, Icon } from '@basis/design-system';

interface SectionCardProps {
  title: string;
  /** Small text after the title, e.g. "12 lines · 2 need review". */
  meta?: ReactNode;
  collapsed: boolean;
  onToggle: () => void;
  actions?: ReactNode;
  children: ReactNode;
}

/** One statement section as its own card: the title toggles it open and closed, and the body is a table with no chrome of its own. */
export function SectionCard({ title, meta, collapsed, onToggle, actions, children }: SectionCardProps) {
  return (
    <Card
      padding="none"
      style={{ flex: '0 0 auto' }}
      title={
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', background: 'transparent', border: 'none', padding: 0, margin: 0, cursor: 'pointer', font: 'inherit', color: 'inherit' }}
        >
          <Icon name={collapsed ? 'chevron-right' : 'chevron-down'} size={12} color="var(--text-tertiary)" />
          <span>{title || 'Untitled section'}</span>
          {meta ? <span style={{ fontSize: 'var(--text-2xs)', fontWeight: 'var(--weight-regular)', color: 'var(--text-secondary)' }}>{meta}</span> : null}
        </button>
      }
      actions={actions}
    >
      {collapsed ? null : children}
    </Card>
  );
}
