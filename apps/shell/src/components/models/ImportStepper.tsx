/** The numbered progress tracker shared by the import flows (AI extraction, then mapping). Steps before `current` show as done, later ones dimmed. `current` is 1-based. */
export function ImportStepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol style={{ listStyle: 'none', display: 'flex', alignItems: 'center', gap: 0, margin: 0, padding: 0 }}>
      {steps.map((label, i) => {
        const stepNum = i + 1;
        const state = stepNum < current ? 'done' : stepNum === current ? 'current' : 'upcoming';
        return (
          <li key={label} style={{ display: 'flex', alignItems: 'center' }}>
            {i > 0 ? <span style={{ width: 28, height: 1, background: 'var(--border-default)', margin: '0 var(--space-5)' }} /> : null}
            <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', opacity: state === 'upcoming' ? 0.55 : 1 }}>
              <span
                style={{
                  width: 18, height: 18, flex: '0 0 auto', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: 'var(--font-mono)', fontSize: 'var(--text-3xs)', fontWeight: 'var(--weight-semibold)',
                  background: state === 'done' ? 'var(--status-positive-bg)' : state === 'current' ? 'var(--action-primary-bg)' : 'var(--surface-sunken)',
                  color: state === 'done' ? 'var(--status-positive-fg)' : state === 'current' ? 'var(--action-primary-fg)' : 'var(--text-secondary)',
                }}
              >
                {stepNum}
              </span>
              <span style={{ fontSize: 'var(--text-xs)', fontWeight: state === 'current' ? 'var(--weight-semibold)' : 'var(--weight-medium)', color: state === 'current' ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                {label}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
