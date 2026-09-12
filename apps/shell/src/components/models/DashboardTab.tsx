import { Icon } from '@basis/design-system';

/** Deliberately minimal — the full financial summary now lives on the Financials tab (see
 *  FinancialsTab.tsx). Which smaller selection, if any, belongs here instead is still an open
 *  product question, so this stays a placeholder rather than guessing at one. */
export function DashboardTab() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 'var(--space-5)', padding: 'var(--space-11) 0' }}>
      <Icon name="layout-dashboard" size={22} color="var(--text-tertiary)" />
      <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
        Dashboard is being reworked — see the Financials tab for the full financial summary.
      </span>
    </div>
  );
}
