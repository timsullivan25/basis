import React from 'react';
import { Icon } from '../primitives/Icon.jsx';
import { useContrastVariant } from '../../dev/contrastLab.js';

/** Progressive disclosure row: summary always visible, detail on demand. */
export function Accordion({ items = [], openKeys = [], onToggle, dense = false, style, ...rest }) {
  const [hover, setHover] = React.useState(null);
  // TEMPORARY — readability experiment, see dev/contrastLab.js. Variant A's hypothesis (kept in
  // the combo variant too) is that a collapsed header should still read as "chrome" rather than
  // blending into plain body background.
  const contrastVariant = useContrastVariant();
  const persistentHeaderTint = contrastVariant === 'a' || contrastVariant === 'combo';
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
                background: open
                  ? 'var(--surface-table-head)'
                  : hover === it.key
                    ? 'var(--surface-hover)'
                    : persistentHeaderTint
                      ? 'var(--surface-app)'
                      : 'transparent',
                border: 'none', cursor: 'pointer', textAlign: 'left', transition: 'var(--transition-control)',
              }}
            >
              <Icon name="chevron-right" size={12} color="var(--text-tertiary)" style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform var(--dur-fast) var(--ease-out)' }} />
              {it.icon ? <Icon name={it.icon} size={13} color="var(--text-secondary)" /> : null}
              <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>{it.label}</span>
              {it.summary ? <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 'var(--space-6)', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>{it.summary}</span> : null}
            </button>
            {open ? (
              // Back to --surface-app (the page canvas gray), now that it's safe again: it used to
              // be identical to --surface-table-head (both ink-50), so an open header and its own
              // body were one indistinguishable wash — that's fixed at the token level now (see
              // contrastLab.css), not by making the body plain white. A faint gray here actually
              // helps the controls inside (inputs, chips) more than white would: a white field
              // reads clearly against a tinted body, whereas on an all-white body it has only its
              // own 1px border to stand on.
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
