import { useMemo, useState, type ReactNode } from 'react';
import { SideNav, type SideNavItem } from '@basis/design-system';
import { PlaceholderScreen } from './screens/PlaceholderScreen';

const NAV_ITEMS: SideNavItem[] = [
  { section: 'Workspace' },
  { value: 'overview', label: 'Overview', icon: 'layout-dashboard' },
  { value: 'portfolio', label: 'Portfolio', icon: 'briefcase' },
  { value: 'reports', label: 'Reports', icon: 'file-text' },
  { section: 'Configuration' },
  { value: 'settings', label: 'Settings', icon: 'settings' },
];

const SCREENS: Record<string, { title: string; render: () => ReactNode }> = {
  overview: { title: 'Overview', render: () => <PlaceholderScreen title="Overview" /> },
  portfolio: { title: 'Portfolio', render: () => <PlaceholderScreen title="Portfolio" /> },
  reports: { title: 'Reports', render: () => <PlaceholderScreen title="Reports" /> },
  settings: { title: 'Settings', render: () => <PlaceholderScreen title="Settings" /> },
};

export function AppShell() {
  const [active, setActive] = useState('overview');
  const screen = useMemo(() => SCREENS[active] ?? SCREENS.overview, [active]);

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <SideNav
        items={NAV_ITEMS}
        value={active}
        onChange={setActive}
        header={<span style={{ fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-base)', color: 'var(--text-primary)' }}>Basis</span>}
      />
      <div style={{ display: 'flex', flexDirection: 'column', flex: '1 1 auto', minWidth: 0 }}>
        <header
          style={{
            display: 'flex', alignItems: 'center', flex: '0 0 auto',
            height: 'var(--topbar-h)', padding: '0 var(--space-8)',
            borderBottom: '1px solid var(--border-subtle)', background: 'var(--surface-chrome)',
          }}
        >
          <h1 style={{ fontSize: 'var(--text-lg)' }}>{screen.title}</h1>
        </header>
        <main style={{ flex: '1 1 auto', overflow: 'auto', padding: 'var(--gutter)' }}>
          {screen.render()}
        </main>
      </div>
    </div>
  );
}
