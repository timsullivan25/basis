import { useMemo, useState, type ReactNode } from 'react';
import { Breadcrumb, SideNav, type SideNavItem } from '@basis/design-system';
import { PlaceholderScreen } from './screens/PlaceholderScreen';

const NAV_ITEMS: SideNavItem[] = [
  { section: 'Workspace' },
  { value: 'overview', label: 'Overview', icon: 'layout-dashboard' },
  { value: 'portfolio', label: 'Portfolio', icon: 'briefcase' },
  { value: 'reports', label: 'Reports', icon: 'file-text' },
  { section: 'Configuration' },
  { value: 'settings', label: 'Settings', icon: 'settings' },
];

const SCREENS: Record<string, { section: string; title: string; render: () => ReactNode }> = {
  overview: { section: 'Workspace', title: 'Overview', render: () => <PlaceholderScreen title="Overview" /> },
  portfolio: { section: 'Workspace', title: 'Portfolio', render: () => <PlaceholderScreen title="Portfolio" /> },
  reports: { section: 'Workspace', title: 'Reports', render: () => <PlaceholderScreen title="Reports" /> },
  settings: { section: 'Configuration', title: 'Settings', render: () => <PlaceholderScreen title="Settings" /> },
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
            display: 'flex', alignItems: 'center', gap: 'var(--space-6)', flex: '0 0 auto',
            height: 'var(--topbar-h)', padding: '0 var(--space-8)',
            borderBottom: '1px solid var(--border-default)', background: 'var(--surface-chrome)',
          }}
        >
          <Breadcrumb items={[{ label: screen.section }, { label: screen.title }]} />
          <div style={{ flex: '1 1 auto' }} />
        </header>
        <main style={{ flex: '1 1 auto', overflow: 'auto', padding: 'var(--gutter)' }}>
          {screen.render()}
        </main>
      </div>
    </div>
  );
}
