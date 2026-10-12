import { CONTRAST_VARIANTS, setContrastVariant, useContrastVariant } from '@basis/design-system';

/** TEMPORARY — readability experiment (branch: feature/readability-contrast). Dev-only floating
 *  switcher so table/section chrome contrast variants can be A/B'd live instead of edited and
 *  reloaded one at a time. Delete this file (and its mount in App.tsx) once a variant is picked. */
export function ContrastLabSwitcher() {
  const active = useContrastVariant();
  return (
    <div
      style={{
        position: 'fixed', bottom: 'var(--space-6)', right: 'var(--space-6)', zIndex: 9999,
        display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', padding: 'var(--space-4)',
        background: 'var(--surface-card)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-3)', fontFamily: 'var(--font-sans)', width: 220,
      }}
    >
      <span style={{ fontSize: 'var(--text-2xs)', fontWeight: 'var(--weight-semibold)', letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>
        Contrast lab (dev only)
      </span>
      {CONTRAST_VARIANTS.map((v) => (
        <button
          key={v.key}
          type="button"
          onClick={() => setContrastVariant(v.key)}
          title={v.description}
          style={{
            display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, textAlign: 'left',
            padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
            border: active === v.key ? '1px solid var(--border-focus)' : '1px solid transparent',
            background: active === v.key ? 'var(--surface-selected)' : 'transparent',
          }}
        >
          <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-medium)', color: 'var(--text-primary)' }}>{v.label}</span>
          <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-secondary)' }}>{v.description}</span>
        </button>
      ))}
    </div>
  );
}
