import React from 'react';
import { Icon } from '../primitives/Icon.jsx';
import { DeltaValue } from './DeltaValue.jsx';
import { Sparkline } from './Sparkline.jsx';

/** Layer-1 summary tile: one number, its change, and an optional way in. */
export function MetricCard({ label, value, unit, delta, deltaUnit = '%', deltaLabel, spark, sparkColor, icon, footnote, onDrill, drillLabel = 'Detail', invertDelta = false, tone = 'default', style, ...rest }) {
  const [hover, setHover] = React.useState(false);
  const accent = { default: 'transparent', brand: 'var(--blue-700)', positive: 'var(--green-600)', negative: 'var(--red-600)', caution: 'var(--amber-600)' }[tone] || 'transparent';
  return (
    <div
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      onClick={onDrill}
      style={{
        position: 'relative', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', minWidth: 0,
        padding: 'var(--space-7) var(--space-8)',
        background: 'var(--surface-card)', border: '1px solid ' + (hover && onDrill ? 'var(--blue-300)' : 'var(--border-default)'),
        borderTop: tone === 'default' ? '1px solid var(--border-default)' : '2px solid ' + accent,
        borderRadius: 'var(--radius-md)', boxShadow: hover && onDrill ? 'var(--shadow-2)' : 'none',
        cursor: onDrill ? 'pointer' : 'default', transition: 'box-shadow var(--dur-base) var(--ease-out), border-color var(--dur-fast) var(--ease-out)',
        ...style,
      }}
      {...rest}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', minWidth: 0 }}>
        {icon ? <Icon name={icon} size={12} color="var(--text-tertiary)" /> : null}
        <span style={{ fontSize: 'var(--text-2xs)', fontWeight: 'var(--weight-semibold)', letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase', color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
        {onDrill ? (
          <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 'var(--text-3xs)', fontWeight: 'var(--weight-semibold)', letterSpacing: 'var(--tracking-wide)', textTransform: 'uppercase', color: hover ? 'var(--text-brand)' : 'var(--text-tertiary)', transition: 'color var(--dur-fast) var(--ease-out)' }}>
            {drillLabel}<Icon name="chevron-right" size={11} style={{ transform: hover ? 'translateX(1px)' : 'none', transition: 'transform var(--dur-fast) var(--ease-out)' }} />
          </span>
        ) : null}
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--space-5)', minWidth: 0 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-2xl)', fontWeight: 'var(--weight-medium)', fontVariantNumeric: 'var(--numeric-tabular)', letterSpacing: 'var(--tracking-heading)', color: 'var(--text-primary)', lineHeight: 1 }}>
          {value}{unit ? <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginLeft: 2 }}>{unit}</span> : null}
        </span>
        {spark ? <div style={{ marginLeft: 'auto', paddingBottom: 2 }}><Sparkline data={spark} color={sparkColor} width={84} height={22} /></div> : null}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', minHeight: 14 }}>
        {delta !== undefined && delta !== null ? <DeltaValue value={delta} unit={deltaUnit} size="sm" invert={invertDelta} /> : null}
        {deltaLabel ? <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-tertiary)' }}>{deltaLabel}</span> : null}
        {footnote ? <span style={{ marginLeft: 'auto', fontSize: 'var(--text-2xs)', color: 'var(--text-tertiary)' }}>{footnote}</span> : null}
      </div>
    </div>
  );
}
