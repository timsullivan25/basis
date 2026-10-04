import type { LineNumberFormat } from '../../../data';
import type { TornadoRow } from '../../../lib/sensitivity';
import { formatPeriodValue } from '../mapping/mappingFormatting';

export interface TornadoChartRow extends TornadoRow {
  label: string;
  /** The input's range in words, e.g. "±2.0 pp" — shown under the label. */
  rangeLabel: string;
}

/** Categorical, not good/bad: whether a low input is good for the output depends on the output
 *  (lower capex raises cash flow), so the two ends get neutral series colors, not pos/neg. */
const LOW_COLOR = 'var(--chart-2)';
const HIGH_COLOR = 'var(--chart-1)';
const BASE_MARKER_COLOR = 'var(--text-primary)';
const BAR_HEIGHT = 16;
const LABEL_WIDTH = 220;
const VALUE_WIDTH = 168;

/**
 * Horizontal tornado: one row per input, largest swing at the top, every bar on one shared axis
 * centred on the starting-case value. Each row draws the input's low end and high end as two bars
 * out from that centre, so which side an input pushes the output to reads at a glance. Plain
 * positioned divs on a percentage scale, the same construction as RecoverySensitivityChart.
 */
export function TornadoChart({ rows, base, numberFormat }: { rows: TornadoChartRow[]; base: number | null; numberFormat: LineNumberFormat }) {
  const extents = rows.flatMap((r) => [r.min, r.max]).filter((v): v is number => v !== null);
  if (base !== null && rows.length === 0) {
    return <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>None of the selected inputs move this output at the chosen period.</span>;
  }
  if (base === null || extents.length === 0) {
    return <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>This output has no value at the chosen period, so there's nothing to rank.</span>;
  }
  // Symmetric around the base so the centre line sits in the middle of every track.
  const reach = Math.max(...extents.map((v) => Math.abs(v - base)));
  const pct = (v: number) => (reach === 0 ? 50 : 50 + ((v - base) / reach) * 50);

  function bar(value: number | null, color: string) {
    if (value === null) return null;
    const left = Math.min(pct(value), 50);
    const width = Math.abs(pct(value) - 50);
    return (
      <div
        style={{
          position: 'absolute', top: 0, bottom: 0, left: left + '%', width: width + '%', background: color,
          borderRadius: 'var(--radius-xs)', transition: 'left var(--dur-slow) var(--ease-out), width var(--dur-slow) var(--ease-out)',
        }}
      />
    );
  }

  const mono = { fontFamily: 'var(--font-mono)', fontSize: 'var(--text-2xs)', fontVariantNumeric: 'var(--numeric-tabular)' } as const;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', fontSize: 'var(--text-2xs)', color: 'var(--text-tertiary)' }}>
        <span style={{ display: 'inline-flex', width: 10, height: 10, background: LOW_COLOR, borderRadius: 2 }} />
        Input at low end
        <span style={{ display: 'inline-flex', width: 10, height: 10, background: HIGH_COLOR, borderRadius: 2, marginLeft: 'var(--space-3)' }} />
        Input at high end
        <span style={{ display: 'inline-flex', width: 2, height: 10, background: BASE_MARKER_COLOR, marginLeft: 'var(--space-3)' }} />
        Starting case {formatPeriodValue(base, numberFormat)}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        {rows.map((row) => (
          <div key={row.driverId} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
            <div style={{ width: LABEL_WIDTH, flex: '0 0 auto', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-medium)', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {row.label}
              </span>
              <span style={{ fontSize: 'var(--text-3xs)', color: 'var(--text-tertiary)' }}>{row.rangeLabel}</span>
            </div>
            <div style={{ position: 'relative', flex: '1 1 auto', height: BAR_HEIGHT, background: 'var(--chart-band)', borderRadius: 'var(--radius-xs)' }}>
              {/* The longer side draws first so a non-monotonic input (both ends on one side)
                  still shows both bars. */}
              {Math.abs((row.atLow ?? base) - base) >= Math.abs((row.atHigh ?? base) - base) ? (
                <>
                  {bar(row.atLow, LOW_COLOR)}
                  {bar(row.atHigh, HIGH_COLOR)}
                </>
              ) : (
                <>
                  {bar(row.atHigh, HIGH_COLOR)}
                  {bar(row.atLow, LOW_COLOR)}
                </>
              )}
              <div
                style={{
                  position: 'absolute', top: -2, bottom: -2, left: 'calc(50% - 1px)', width: 2,
                  background: BASE_MARKER_COLOR, boxShadow: '0 0 0 2px var(--surface-card)', borderRadius: 1,
                }}
              />
            </div>
            <span style={{ ...mono, width: VALUE_WIDTH, flex: '0 0 auto', textAlign: 'right', color: 'var(--text-secondary)' }}>
              {formatPeriodValue(row.atLow, numberFormat)}
              {' / '}
              {formatPeriodValue(row.atHigh, numberFormat)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
