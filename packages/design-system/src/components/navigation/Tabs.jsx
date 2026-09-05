import React from 'react';
import { Icon } from '../primitives/Icon.jsx';

/** Underline tabs — the primary within-view layer switch. */
export function Tabs({ tabs = [], value, onChange, size = 'md', actions, style, ...rest }) {
  const [hover, setHover] = React.useState(null);
  const fs = size === 'sm' ? 'var(--text-xs)' : 'var(--text-sm)';
  const h = size === 'sm' ? 'var(--subbar-h)' : 'var(--topbar-h)';
  return (
    <div style={{ display: 'flex', alignItems: 'stretch', gap: 'var(--space-8)', height: h, borderBottom: '1px solid var(--border-default)', ...style }} {...rest}>
      <div role="tablist" style={{ display: 'flex', alignItems: 'stretch', gap: 'var(--space-8)', minWidth: 0, overflowX: 'auto', overflowY: 'hidden', scrollbarWidth: 'none' }}>
        {tabs.map((t) => {
          const on = value === t.value;
          return (
            <button
              key={t.value} type="button" role="tab" aria-selected={on}
              onMouseEnter={() => setHover(t.value)} onMouseLeave={() => setHover(null)}
              onClick={() => onChange && onChange(t.value)}
              style={{
                position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 'var(--space-3)',
                padding: 0, background: 'transparent', border: 'none', cursor: 'pointer',
                fontFamily: 'var(--font-sans)', fontSize: fs,
                fontWeight: on ? 'var(--weight-semibold)' : 'var(--weight-medium)',
                color: on ? 'var(--text-primary)' : (hover === t.value ? 'var(--text-body)' : 'var(--text-secondary)'),
                whiteSpace: 'nowrap', transition: 'color var(--dur-fast) var(--ease-out)',
              }}
            >
              {t.icon ? <Icon name={t.icon} size={13} /> : null}
              {t.label}
              {t.count !== undefined ? (
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-2xs)', fontVariantNumeric: 'var(--numeric-tabular)', color: 'var(--text-tertiary)' }}>{t.count}</span>
              ) : null}
              <span style={{ position: 'absolute', left: 0, right: 0, bottom: -1, height: 2, background: on ? 'var(--blue-700)' : 'transparent', borderRadius: '1px 1px 0 0', transition: 'background-color var(--dur-fast) var(--ease-out)' }} />
            </button>
          );
        })}
      </div>
      {actions ? <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>{actions}</div> : null}
    </div>
  );
}
