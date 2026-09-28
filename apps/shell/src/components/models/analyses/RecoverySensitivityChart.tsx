import { formatPeriodValue } from '../mapping/mappingFormatting';

/** One priority/tranche row's recovery range across the multiple/direct-value sweep — always a
 *  RATE (0–1), since that's the one unit every claim (admin costs, every tranche) shares
 *  regardless of balance size, letting them all sit on one shared 0–100% scale (see the module
 *  doc comment below for why Equity is handled separately instead of forced onto this same
 *  scale). low/base/high come pre-sorted ascending by the caller. */
export interface RecoveryRangeRow {
  key: string;
  label: string;
  tierName: string;
  low: number | null;
  base: number | null;
  high: number | null;
}

const RANGE_COLOR = 'var(--chart-1)';
const BASE_MARKER_COLOR = 'var(--text-primary)';
const TRACK_HEIGHT = 16;

function RangeBar({ low, base, high }: { low: number; base: number; high: number }) {
  const lowPct = low * 100;
  const spanPct = (high - low) * 100;
  const basePct = base * 100;
  return (
    <div style={{ position: 'relative', flex: '1 1 auto', height: TRACK_HEIGHT, background: 'var(--chart-band)', borderRadius: 'var(--radius-xs)' }}>
      <div
        style={{
          position: 'absolute', top: 0, bottom: 0, left: lowPct + '%', width: spanPct + '%',
          background: RANGE_COLOR, borderRadius: 'var(--radius-xs)', transition: 'left var(--dur-slow) var(--ease-out), width var(--dur-slow) var(--ease-out)',
        }}
      />
      {/* The base-case marker — a 2px line with a surface ring so it stays legible sitting on
          top of the range fill, per this app's dataviz convention for overlapping marks. */}
      <div
        style={{
          position: 'absolute', top: -2, bottom: -2, left: `calc(${basePct}% - 1px)`, width: 2,
          background: BASE_MARKER_COLOR, boxShadow: '0 0 0 2px var(--surface-card)', borderRadius: 1,
        }}
      />
    </div>
  );
}

/**
 * Recovery-rate RANGE per priority claim/tranche across the valuation sweep — low↔high band with
 * the base case marked — grouped under the same tier headers as the table above it. This is
 * deliberately NOT a repeat of the table's own Balance/Recovery($)/Recovery(%) columns: a table
 * cell can only ever show one number, so it can't show a RANGE at all. The range is the one thing
 * this view adds that the table structurally can't.
 *
 * Equity has no bounded recovery rate (an unlevered residual can be $0 or $10,000 with no upper
 * bound), so mixing it onto this same 0–100% axis would violate the "one axis" rule — it gets its
 * own small $ range read-out instead (`equityRange` below), never plotted alongside these bars.
 */
export function RecoverySensitivityChart({ rows, equityRange }: { rows: RecoveryRangeRow[]; equityRange: { low: number; base: number; high: number } | null }) {
  const groups: { tierName: string; rows: RecoveryRangeRow[] }[] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (last && last.tierName === row.tierName) last.rows.push(row);
    else groups.push({ tierName: row.tierName, rows: [row] });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-7)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', fontSize: 'var(--text-2xs)', color: 'var(--text-tertiary)' }}>
          <span style={{ display: 'inline-flex', width: 10, height: 10, background: RANGE_COLOR, borderRadius: 2 }} />
          Low–high recovery range
          <span style={{ display: 'inline-flex', width: 2, height: 10, background: BASE_MARKER_COLOR, marginLeft: 'var(--space-3)' }} />
          Base case
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-7)' }}>
        {groups.map((group) => (
          <div key={group.tierName} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
            <span style={{ fontSize: 'var(--text-3xs)', fontWeight: 'var(--weight-semibold)', letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>
              {group.tierName}
            </span>
            {group.rows.map((row) => (
              <div key={row.key} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-medium)', color: 'var(--text-primary)' }}>{row.label}</span>
                {row.low !== null && row.base !== null && row.high !== null ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
                    <RangeBar low={row.low} base={row.base} high={row.high} />
                    <span
                      style={{
                        width: 148, flex: '0 0 auto', textAlign: 'right', fontFamily: 'var(--font-mono)',
                        fontSize: 'var(--text-2xs)', fontVariantNumeric: 'var(--numeric-tabular)', color: 'var(--text-secondary)',
                      }}
                    >
                      {formatPeriodValue(row.low, 'percentage')}
                      {' – '}
                      <span style={{ color: 'var(--text-primary)', fontWeight: 'var(--weight-medium)' }}>{formatPeriodValue(row.base, 'percentage')}</span>
                      {' – '}
                      {formatPeriodValue(row.high, 'percentage')}
                    </span>
                  </div>
                ) : (
                  <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-disabled)' }}>—</span>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>

      {equityRange ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', paddingTop: 'var(--space-5)', borderTop: '1px solid var(--border-subtle)' }}>
          <span style={{ fontSize: 'var(--text-3xs)', fontWeight: 'var(--weight-semibold)', letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>
            Equity residual (not on the % scale above — unbounded)
          </span>
          <span style={{ fontSize: 'var(--text-sm)', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'var(--numeric-tabular)', color: 'var(--text-primary)' }}>
            {formatPeriodValue(equityRange.low, 'number')}
            {' – '}
            <span style={{ fontWeight: 'var(--weight-semibold)' }}>{formatPeriodValue(equityRange.base, 'number')}</span>
            {' – '}
            {formatPeriodValue(equityRange.high, 'number')}
          </span>
        </div>
      ) : null}
    </div>
  );
}
