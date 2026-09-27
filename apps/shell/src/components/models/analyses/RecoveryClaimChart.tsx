import { ChartLegend } from '@basis/design-system';
import { formatPeriodValue } from '../mapping/mappingFormatting';

/** One row: a debt tranche's Claim vs Recovery pair, or the Equity row (claim omitted — equity
 *  never holds a "claim" the way a tranche's balance is one, only whatever's left). */
export interface ClaimRecoveryDatum {
  key: string;
  label: string;
  sublabel?: string;
  claim: number | null;
  recovery: number | null;
}

const CLAIM_COLOR = 'var(--chart-1)';
const RECOVERY_COLOR = 'var(--chart-2)';
const EQUITY_COLOR = 'var(--chart-3)';
const BAR_HEIGHT = 16;
const BAR_GAP = 2; // the surface gap between the two touching bars in a row

function Bar({ value, max, color, label }: { value: number; max: number; color: string; label: string }) {
  const widthPct = max > 0 ? (Math.max(0, value) / max) * 100 : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
      <div style={{ position: 'relative', flex: '1 1 auto', height: BAR_HEIGHT, background: 'var(--chart-band)', borderRadius: 'var(--radius-xs)' }}>
        <div
          style={{
            position: 'absolute', top: 0, bottom: 0, left: 0, width: widthPct + '%',
            background: color, borderRadius: 'var(--radius-xs)', transition: 'width var(--dur-slow) var(--ease-out)',
          }}
        />
      </div>
      <span
        style={{
          width: 84, flex: '0 0 auto', textAlign: 'right', fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-2xs)', fontVariantNumeric: 'var(--numeric-tabular)', color: 'var(--text-primary)',
        }}
      >
        {label}
      </span>
    </div>
  );
}

/**
 * Claim vs Recovery, one pair of bars per debt tranche, sharing one linear scale across every
 * row (including Equity) so lengths stay comparable — never a second axis. Equity is deliberately
 * NOT a third measure of the same pair: it gets its own color (chart-3, not a shade of Claim or
 * Recovery) and only ever draws its single Residual bar, because a residual isn't a claim being
 * partially satisfied the way a tranche's balance is — see RecoveryWaterfallPanel's own Equity row
 * for the same reasoning applied to the table.
 *
 * Direct value labels ride every bar rather than a hover tooltip (this app's own BarChart does
 * the same via its `showValues` option) — with at most a handful of tranches, every value is
 * already legible at a glance, and the exact figures live in the table right below regardless.
 */
export function RecoveryClaimChart({ data }: { data: ClaimRecoveryDatum[] }) {
  const max = Math.max(1, ...data.flatMap((d) => [d.claim ?? 0, d.recovery ?? 0]));
  const hasEquityRow = data.some((d) => d.claim === null);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      <ChartLegend
        size="sm"
        series={[
          { key: 'claim', label: 'Claim', color: CLAIM_COLOR },
          { key: 'recovery', label: 'Recovery', color: RECOVERY_COLOR },
          ...(hasEquityRow ? [{ key: 'equity', label: 'Residual to equity', color: EQUITY_COLOR }] : []),
        ]}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
        {data.map((d) => (
          <div key={d.key} style={{ display: 'flex', flexDirection: 'column', gap: BAR_GAP }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-3)' }}>
              <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-medium)', color: 'var(--text-primary)' }}>{d.label}</span>
              {d.sublabel ? <span style={{ fontSize: 'var(--text-3xs)', color: 'var(--text-tertiary)' }}>{d.sublabel}</span> : null}
            </div>
            {d.claim !== null ? (
              <Bar value={d.claim} max={max} color={CLAIM_COLOR} label={formatPeriodValue(d.claim, 'number')} />
            ) : null}
            {d.recovery !== null ? (
              <Bar value={d.recovery} max={max} color={d.claim === null ? EQUITY_COLOR : RECOVERY_COLOR} label={formatPeriodValue(d.recovery, 'number')} />
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
