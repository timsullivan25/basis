/** The numbered progress tracker shared by the import flows (AI extraction, then mapping). Steps
 *  before `current` show as done, later ones muted. `current` is 1-based. Muted is a real lighter
 *  color (text-tertiary), not opacity — opacity on the small badge circle made its number nearly
 *  unreadable, since it fades toward whatever's behind it rather than staying legible. */
export function ImportStepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol style={{ listStyle: 'none', display: 'flex', alignItems: 'center', gap: 0, margin: 0, padding: 0 }}>
      {steps.map((label, i) => {
        const stepNum = i + 1;
        const state = stepNum < current ? 'done' : stepNum === current ? 'current' : 'upcoming';
        return (
          <li key={label} style={{ display: 'flex', alignItems: 'center' }}>
            {i > 0 ? <span style={{ width: 28, height: 1, background: 'var(--border-default)', margin: '0 var(--space-5)' }} /> : null}
            <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
              <span
                style={{
                  width: 18, height: 18, flex: '0 0 auto', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: 'var(--font-mono)', fontSize: 'var(--text-3xs)', fontWeight: 'var(--weight-semibold)',
                  // 'done' used the pastel --status-positive-bg/fg pairing (a pale mint fill with
                  // dark text) — the fill was nearly the same lightness as the page behind it, so
                  // the badge read as a bare number with no visible circle around it. A solid fill
                  // (matching how 'current' already works) actually reads as a colored badge.
                  background: state === 'done' ? 'var(--green-600)' : state === 'current' ? 'var(--action-primary-bg)' : 'var(--surface-sunken)',
                  color: state === 'done' ? 'var(--white)' : state === 'current' ? 'var(--action-primary-fg)' : 'var(--text-secondary)',
                }}
              >
                {stepNum}
              </span>
              <span style={{ fontSize: 'var(--text-xs)', fontWeight: state === 'current' ? 'var(--weight-semibold)' : 'var(--weight-medium)', color: state === 'current' ? 'var(--text-primary)' : state === 'done' ? 'var(--text-secondary)' : 'var(--text-tertiary)' }}>
                {label}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
