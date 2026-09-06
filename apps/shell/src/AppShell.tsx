import { useState } from 'react';
import { Breadcrumb, SideNav, type SideNavItem } from '@basis/design-system';
import type { Company } from './data';
import { CompanyDetailScreen } from './screens/CompanyDetailScreen';
import { PlaceholderScreen } from './screens/PlaceholderScreen';
import { PortfolioScreen } from './screens/PortfolioScreen';
import { SettingsIndexScreen } from './screens/SettingsIndexScreen';
import { StatementDefinitionsScreen } from './screens/StatementDefinitionsScreen';

const NAV_ITEMS: SideNavItem[] = [
  { section: 'Workspace' },
  { value: 'overview', label: 'Overview', icon: 'layout-dashboard' },
  { value: 'portfolio', label: 'Portfolio', icon: 'briefcase' },
  { value: 'reports', label: 'Reports', icon: 'file-text' },
  { section: 'Configuration' },
  {
    value: 'settings',
    label: 'Settings',
    icon: 'settings',
    children: [{ value: 'settings-statements', label: 'Financial Statement Definitions' }],
  },
];

const SCREENS: Record<string, { section: string; title: string; parent?: string }> = {
  overview: { section: 'Workspace', title: 'Overview' },
  portfolio: { section: 'Workspace', title: 'Portfolio' },
  reports: { section: 'Workspace', title: 'Reports' },
  settings: { section: 'Configuration', title: 'Settings' },
  'settings-statements': { section: 'Configuration', title: 'Financial Statement Definitions', parent: 'settings' },
};

const PORTFOLIO_CRUMB = 'portfolio-root';

export function AppShell() {
  const [active, setActive] = useState('overview');
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  const screen = SCREENS[active] ?? SCREENS.overview;
  const parentScreen = screen.parent ? SCREENS[screen.parent] : null;

  function handleNavChange(value: string) {
    setActive(value);
    setSelectedCompany(null);
  }

  const breadcrumbItems = parentScreen
    ? [{ label: screen.section }, { value: screen.parent, label: parentScreen.title }, { label: screen.title }]
    : [
        { label: screen.section },
        { value: PORTFOLIO_CRUMB, label: screen.title },
        ...(active === 'portfolio' && selectedCompany ? [{ label: selectedCompany.name }] : []),
      ];

  function handleBreadcrumbNavigate(value: string | undefined) {
    if (value === PORTFOLIO_CRUMB && selectedCompany) {
      setSelectedCompany(null);
    } else if (value && value === screen.parent) {
      setActive(value);
    }
  }

  const breadcrumbNavigable = Boolean(parentScreen) || (active === 'portfolio' && Boolean(selectedCompany));

  function renderScreen() {
    if (active === 'portfolio') {
      return selectedCompany ? (
        <CompanyDetailScreen company={selectedCompany} />
      ) : (
        <PortfolioScreen onSelectCompany={setSelectedCompany} />
      );
    }
    if (active === 'settings') {
      return <SettingsIndexScreen onNavigate={setActive} />;
    }
    if (active === 'settings-statements') {
      return <StatementDefinitionsScreen />;
    }
    return <PlaceholderScreen title={screen.title} />;
  }

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <SideNav items={NAV_ITEMS} value={active} onChange={handleNavChange} />
      <div style={{ display: 'flex', flexDirection: 'column', flex: '1 1 auto', minWidth: 0 }}>
        <header
          style={{
            display: 'flex', alignItems: 'center', gap: 'var(--space-8)', flex: '0 0 auto',
            height: 'var(--topbar-h)', padding: '0 var(--space-8)',
            borderBottom: '1px solid var(--border-default)', background: 'var(--surface-chrome)',
          }}
        >
          <span style={{ font: '700 13px/1 var(--font-sans)', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text-primary)' }}>
            Basis
          </span>
          <div style={{ width: 1, height: 18, background: 'var(--border-default)' }} />
          <Breadcrumb items={breadcrumbItems} onNavigate={breadcrumbNavigable ? handleBreadcrumbNavigate : undefined} />
          <div style={{ flex: '1 1 auto' }} />
        </header>
        <main style={{ flex: '1 1 auto', overflow: 'auto', padding: 'var(--gutter)' }}>
          {renderScreen()}
        </main>
      </div>
    </div>
  );
}
