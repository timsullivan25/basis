import React from 'react';
import { Icon } from '../primitives/Icon.jsx';

/** Progressive disclosure row: summary always visible, detail on demand. */
export function Accordion({ items = [], openKeys = [], onToggle, dense = false, style, ...rest }) {
  const [hover, setHover] = React.useState(null);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', background: 'var(--surface-card)', overflow: 'hidden', ...style }} {...rest}>
      {items.map((it, i) => {
        const open = openKeys.includes(it.key);
        return (
          <div key={it.key} style={{ borderTop: i ? '1px solid var(--border-subtle)' : 'none' }}>
            <button
              type="button" onClick={() => onToggle && onToggle(it.key)}
              onMouseEnter={() => setHover(it.key)} onMouseLeave={() => setHover(null)}
              style={{
                display: 'flex', alignItems: 'center', gap: 'var(--space-5)', width: '100%',
                minHeight: dense ? 'var(--control-md)' : 40, padding: dense ? '0 var(--space-6)' : '0 var(--space-7)',
                background: open ? 'var(--surface-table-head)' : hover === it.key ? 'var(--surface-hover)' : 'transparent',
                border: 'none', cursor: 'pointer', textAlign: 'left', transition: 'var(--transition-control)',
              }}
            >
              <Icon name="chevron-right" size={12} color="var(--text-tertiary)" style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform var(--dur-fast) var(--ease-out)' }} />
              {it.icon ? <Icon name={it.icon} size={13} color="var(--text-secondary)" /> : null}
              <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>{it.label}</span>
              {it.summary ? <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 'var(--space-6)', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>{it.summary}</span> : null}
            </button>
            {open ? (
              <div style={{ padding: dense ? 'var(--space-6)' : 'var(--space-8)', borderTop: '1px solid var(--border-subtle)', background: 'var(--surface-app)', animation: 'basis-fade-in var(--dur-base) var(--ease-out)' }}>
                {it.content}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
