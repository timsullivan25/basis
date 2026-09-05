import React from 'react';
import { Icon } from '../primitives/Icon.jsx';

/** Drill-path trail. Shows how deep the user is and lets them climb back out. */
export function Breadcrumb({ items = [], onNavigate, style, ...rest }) {
  return (
    <nav style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', minWidth: 0, fontSize: 'var(--text-xs)', ...style }} {...rest}>
      {items.map((it, i) => {
        const last = i === items.length - 1;
        return (
          <React.Fragment key={it.value || i}>
            {i > 0 ? <Icon name="chevron-right" size={11} color="var(--text-tertiary)" /> : null}
            <button
              type="button" disabled={last}
              onClick={() => !last && onNavigate && onNavigate(it.value, i)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', padding: 0,
                background: 'transparent', border: 'none', cursor: last ? 'default' : 'pointer',
                fontFamily: 'var(--font-sans)', fontSize: 'var(--text-xs)',
                fontWeight: last ? 'var(--weight-semibold)' : 'var(--weight-regular)',
                color: last ? 'var(--text-primary)' : 'var(--text-secondary)',
                whiteSpace: 'nowrap', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis',
              }}
            >
              {it.icon ? <Icon name={it.icon} size={12} /> : null}
              {it.label}
            </button>
          </React.Fragment>
        );
      })}
    </nav>
  );
}
