import type { LineNumberFormat } from '../../../data';
import type { DistributionSummary } from '../../../lib/sensitivity';
import { formatPeriodValue } from '../mapping/mappingFormatting';

const BAR_COLOR = 'var(--chart-1)';
const BAND_COLOR = 'color-mix(in srgb, var(--chart-1) 35%, transparent)';
const PLOT_HEIGHT = 160;

/**
 * Histogram of one output across a Monte Carlo run. Bars inside the 5th–95th percentile band are
 * solid, the tails lighter; the starting case and an optional threshold are vertical markers.
 * Positioned divs on a percentage scale, the same construction as the tornado.
 */
export function DistributionChart({
  summary,
  base,
  threshold,
  numberFormat,
}: {
  summary: DistributionSummary;
  base: number | null;
  threshold: number | null;
  numberFormat: LineNumberFormat;
}) {
  const lo = Math.min(summary.min, base ?? summary.min, threshold ?? summary.min);
  const hi = Math.max(summary.max, base ?? summary.max, threshold ?? summary.max);
  const span = hi - lo || 1;
  const x = (v: number) => ((v - lo) / span) * 100;
  const tallest = Math.max(...summary.bins.map((b) => b.count));

  function marker(value: number, color: string, label: string) {
    return (
      <div style={{ position: 'absolute', top: -14, bottom: 0, left: `calc(${x(value)}% - 1px)`, width: 2, background: color, boxShadow: '0 0 0 1px var(--surface-card)' }}>
        <span style={{ position: 'absolute', top: -2, left: 6, whiteSpace: 'nowrap', fontSize: 'var(--text-3xs)', color }}>{label}</span>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div style={{ position: 'relative', height: PLOT_HEIGHT, marginTop: 'var(--space-6)', borderBottom: '1px solid var(--chart-axis)' }}>
        {summary.bins.map((bin, i) => {
          const inBand = bin.to >= summary.p5 && bin.from <= summary.p95;
          return (
            <div
              key={i}
              title={`${formatPeriodValue(bin.from, numberFormat)} – ${formatPeriodValue(bin.to, numberFormat)}: ${bin.count}`}
              style={{
                position: 'absolute', bottom: 0, left: `calc(${x(bin.from)}% + 1px)`, width: `calc(${x(bin.to) - x(bin.from)}% - 2px)`,
                height: `${(bin.count / tallest) * 100}%`, background: inBand ? BAR_COLOR : BAND_COLOR, borderRadius: '2px 2px 0 0',
              }}
            />
          );
        })}
        {base !== null ? marker(base, 'var(--text-primary)', `Starting case ${formatPeriodValue(base, numberFormat)}`) : null}
        {threshold !== null ? marker(threshold, 'var(--status-caution-fg)', `Threshold ${formatPeriodValue(threshold, numberFormat)}`) : null}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-3xs)', color: 'var(--text-tertiary)' }}>
        <span>{formatPeriodValue(lo, numberFormat)}</span>
        <span>{formatPeriodValue(hi, numberFormat)}</span>
      </div>
    </div>
  );
}
