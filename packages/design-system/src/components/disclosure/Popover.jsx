import React from 'react';

/** Click-anchored panel for methodology notes, column pickers and mini-forms. */
export function Popover({ trigger, children, open, onOpenChange, placement = 'bottom-start', width = 260, title, style, ...rest }) {
  const [inner, setInner] = React.useState(false);
  const isOpen = open === undefined ? inner : open;
  const set = (v) => { setInner(v); onOpenChange && onOpenChange(v); };
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!isOpen) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) set(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [isOpen]);
  const pos = {
    'bottom-start': { top: '100%', left: 0, marginTop: 4 },
    'bottom-end': { top: '100%', right: 0, marginTop: 4 },
    'top-start': { bottom: '100%', left: 0, marginBottom: 4 },
    'right-start': { top: 0, left: '100%', marginLeft: 4 },
  }[placement];
  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-flex', ...style }} {...rest}>
      <span onClick={() => set(!isOpen)} style={{ display: 'inline-flex' }}>{trigger}</span>
      {isOpen ? (
        <div
          style={{
            position: 'absolute', zIndex: 80, width,
            background: 'var(--surface-raised)', border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-3)', overflow: 'hidden',
            animation: 'basis-pop-in var(--dur-fast) var(--ease-out)', textAlign: 'left', ...pos,
          }}
        >
          {title ? (
            <div style={{ padding: 'var(--space-5) var(--space-6)', borderBottom: '1px solid var(--border-subtle)', background: 'var(--surface-table-head)', fontSize: 'var(--text-3xs)', fontWeight: 'var(--weight-semibold)', letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>{title}</div>
          ) : null}
          <div style={{ padding: 'var(--space-6)', fontSize: 'var(--text-xs)', color: 'var(--text-body)', lineHeight: 'var(--leading-snug)' }}>{children}</div>
        </div>
      ) : null}
    </span>
  );
}
