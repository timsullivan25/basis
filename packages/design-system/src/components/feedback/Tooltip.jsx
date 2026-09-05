import React from 'react';

/** Hover explanation for a glyph, abbreviation or derived figure. */
export function Tooltip({ content, children, placement = 'top', delay = 120, maxWidth = 240, style, ...rest }) {
  const [open, setOpen] = React.useState(false);
  const timer = React.useRef(null);
  const show = () => { timer.current = setTimeout(() => setOpen(true), delay); };
  const hide = () => { clearTimeout(timer.current); setOpen(false); };
  const pos = {
    top: { bottom: '100%', left: '50%', transform: 'translateX(-50%)', marginBottom: 6 },
    bottom: { top: '100%', left: '50%', transform: 'translateX(-50%)', marginTop: 6 },
    left: { right: '100%', top: '50%', transform: 'translateY(-50%)', marginRight: 6 },
    right: { left: '100%', top: '50%', transform: 'translateY(-50%)', marginLeft: 6 },
  }[placement];
  return (
    <span style={{ position: 'relative', display: 'inline-flex', ...style }} onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide} {...rest}>
      {children}
      {open ? (
        <span
          role="tooltip"
          style={{
            position: 'absolute', zIndex: 60, maxWidth, padding: 'var(--space-3) var(--space-5)',
            background: 'var(--surface-tooltip)', color: 'var(--white)',
            fontFamily: 'var(--font-sans)', fontSize: 'var(--text-2xs)', fontWeight: 'var(--weight-regular)',
            lineHeight: 'var(--leading-snug)', letterSpacing: 'var(--tracking-normal)',
            borderRadius: 'var(--radius-sm)', boxShadow: 'var(--shadow-3)',
            animation: 'basis-fade-in var(--dur-fast) var(--ease-out)', pointerEvents: 'none', ...pos,
          }}
        >
          {content}
        </span>
      ) : null}
    </span>
  );
}
