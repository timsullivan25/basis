import React from 'react';
import { Icon } from '../primitives/Icon.jsx';

function fmtDelta(v, { unit = '%', decimals = 2, signed = true }) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  const n = Math.abs(v).toFixed(decimals);
  const sign = !signed ? '' : v > 0 ? '+' : v < 0 ? '−' : '';
  return sign + n + (unit === 'bps' ? '' : unit) + (unit === 'bps' ? ' bps' : '');
}

/** Signed change with directional color and glyph. The atom of every P&L surface. */
export function DeltaValue({ value, unit = '%', decimals = 2, size = 'md', glyph = 'arrow', chip = false, signed = true, invert = false, style, ...rest }) {
  const dir = value > 0 ? 1 : value < 0 ? -1 : 0;
  const good = invert ? -dir : dir;
  const color = good > 0 ? 'var(--value-up)' : good < 0 ? 'var(--value-down)' : 'var(--value-flat)';
  const bg = good > 0 ? 'var(--value-up-bg)' : good < 0 ? 'var(--value-down-bg)' : 'var(--status-neutral-bg)';
  const fs = { xs: 'var(--text-2xs)', sm: 'var(--text-xs)', md: 'var(--text-sm)', lg: 'var(--text-lg)', xl: 'var(--text-2xl)' }[size] || 'var(--text-sm)';
  const isz = { xs: 9, sm: 10, md: 11, lg: 13, xl: 16 }[size] || 11;
  const name = glyph === 'triangle' ? (dir >= 0 ? 'triangle' : 'triangle') : dir > 0 ? 'arrow-up-right' : dir < 0 ? 'arrow-down-right' : 'minus';
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)',
        padding: chip ? '2px var(--space-3)' : 0, background: chip ? bg : 'transparent',
        borderRadius: chip ? 'var(--radius-sm)' : 0,
        fontFamily: 'var(--font-mono)', fontSize: fs, fontWeight: 'var(--weight-medium)',
        fontVariantNumeric: 'var(--numeric-tabular)', color, lineHeight: 1.1, whiteSpace: 'nowrap', ...style,
      }}
      {...rest}
    >
      {glyph !== 'none' && dir !== 0 ? <Icon name={name} size={isz} style={glyph === 'triangle' ? { transform: dir < 0 ? 'rotate(180deg)' : 'none' } : undefined} /> : null}
      {fmtDelta(value, { unit, decimals, signed })}
    </span>
  );
}
