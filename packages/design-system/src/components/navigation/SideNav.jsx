import React from 'react';
import { Icon } from '../primitives/Icon.jsx';

/** Left rail: modules at the top level, workspaces nested under them. */
export function SideNav({ items = [], value, onChange, header, footer, collapsed = false, style, ...rest }) {
  const [hover, setHover] = React.useState(null);
  return (
    <nav
      style={{
        display: 'flex', flexDirection: 'column',
        width: collapsed ? 'var(--sidebar-w-collapsed)' : 'var(--sidebar-w)', flex: '0 0 auto',
        background: 'var(--surface-chrome)', borderRight: '1px solid var(--border-default)',
        transition: 'width var(--dur-base) var(--ease-out)', overflow: 'hidden', ...style,
      }}
      {...rest}
    >
      {header ? <div style={{ display: 'flex', alignItems: 'center', height: 'var(--topbar-h)', padding: '0 var(--space-6)', borderBottom: '1px solid var(--border-subtle)', flex: '0 0 auto' }}>{header}</div> : null}
      <div style={{ flex: '1 1 auto', overflow: 'auto', padding: 'var(--space-5) var(--space-4)' }}>
        {items.map((item, i) => {
          if (item.section) {
            return collapsed ? <div key={'s' + i} style={{ height: 1, margin: 'var(--space-5) var(--space-4)', background: 'var(--border-subtle)' }} /> : (
              <div key={'s' + i} style={{ padding: 'var(--space-6) var(--space-5) var(--space-3)', fontSize: 'var(--text-3xs)', fontWeight: 'var(--weight-semibold)', letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>{item.section}</div>
            );
          }
          const on = value === item.value;
          const hv = hover === item.value;
          return (
            <div key={item.value}>
              <button
                type="button" onClick={() => onChange && onChange(item.value)}
                onMouseEnter={() => setHover(item.value)} onMouseLeave={() => setHover(null)}
                title={collapsed ? item.label : undefined}
                style={{
                  display: 'flex', alignItems: 'center', gap: 'var(--space-5)', width: '100%',
                  height: 'var(--control-md)', padding: '0 var(--space-5)',
                  background: on ? 'var(--surface-selected)' : hv ? 'var(--surface-hover)' : 'transparent',
                  border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                  fontFamily: 'var(--font-sans)', fontSize: 'var(--text-sm)',
                  fontWeight: on ? 'var(--weight-semibold)' : 'var(--weight-regular)',
                  color: on ? 'var(--text-brand)' : 'var(--text-body)',
                  transition: 'var(--transition-control)', textAlign: 'left',
                }}
              >
                {item.icon ? <Icon name={item.icon} size={15} color={on ? 'var(--text-brand)' : 'var(--text-secondary)'} /> : null}
                {!collapsed ? <span style={{ flex: '1 1 auto', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label}</span> : null}
                {!collapsed && item.badge ? <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-3xs)', fontVariantNumeric: 'var(--numeric-tabular)', color: 'var(--text-tertiary)' }}>{item.badge}</span> : null}
              </button>
              {!collapsed && on && item.children ? (
                <div style={{ display: 'flex', flexDirection: 'column', margin: 'var(--space-1) 0 var(--space-3) calc(var(--space-5) + 15px + var(--space-5) / 2)', paddingLeft: 'var(--space-5)', borderLeft: '1px solid var(--border-default)' }}>
                  {item.children.map((c) => (
                    <button key={c.value} type="button" onClick={() => onChange && onChange(c.value)}
                      style={{ display: 'flex', alignItems: 'center', height: 'var(--control-sm)', padding: '0 var(--space-4)', background: 'transparent', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontFamily: 'var(--font-sans)', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', textAlign: 'left' }}>
                      {c.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      {footer ? <div style={{ padding: 'var(--space-5)', borderTop: '1px solid var(--border-subtle)', flex: '0 0 auto' }}>{footer}</div> : null}
    </nav>
  );
}
