import { useState } from 'react';
import { Breadcrumb, SideNav, type SideNavItem } from '@basis/design-system';
import type { Company } from './data';
import { ModelMappingScreen, type ModelMappingScreenProps } from './components/models/mapping/ModelMappingScreen';
import { CompanyDetailScreen } from './screens/CompanyDetailScreen';
import { ModelWorkspaceScreen } from './screens/ModelWorkspaceScreen';
import { PlaceholderScreen } from './screens/PlaceholderScreen';
import { PortfolioScreen } from './screens/PortfolioScreen';
import { SettingsIndexScreen } from './screens/SettingsIndexScreen';
import { SnapshotViewScreen } from './screens/SnapshotViewScreen';
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
const COMPANY_CRUMB = 'company-root';
const WORKSPACE_CRUMB = 'workspace-root';

export function AppShell() {
  const [active, setActive] = useState('overview');
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  const [viewingModelWorkspace, setViewingModelWorkspace] = useState(false);
  const [viewingSnapshotId, setViewingSnapshotId] = useState<string | null>(null);
  const [mappingSession, setMappingSession] = useState<ModelMappingScreenProps | null>(null);
  const screen = SCREENS[active] ?? SCREENS.overview;
  const parentScreen = screen.parent ? SCREENS[screen.parent] : null;

  // Renders as a full-viewport overlay (see below) covering the sidebar too, so there is
  // nothing else to click while a mapping session is open — the only way out is its own
  // Cancel (which already confirms discarding) or Save, never a background nav click.
  function openMapping(props: ModelMappingScreenProps) {
    setMappingSession({
      ...props,
      onCancel: () => {
        props.onCancel();
        setMappingSession(null);
      },
      onSaved: (updated) => {
        props.onSaved(updated);
        setMappingSession(null);
      },
    });
  }

  function handleNavChange(value: string) {
    setActive(value);
    setSelectedCompany(null);
    setViewingModelWorkspace(false);
    setViewingSnapshotId(null);
  }

  const breadcrumbItems = parentScreen
    ? [{ label: screen.section }, { value: screen.parent, label: parentScreen.title }, { label: screen.title }]
    : [
        { label: screen.section },
        { value: PORTFOLIO_CRUMB, label: screen.title },
        ...(active === 'portfolio' && selectedCompany
          ? [
              { value: viewingModelWorkspace || viewingSnapshotId ? COMPANY_CRUMB : undefined, label: selectedCompany.name },
              ...(viewingModelWorkspace && !viewingSnapshotId ? [{ label: 'Model' }] : []),
              ...(viewingSnapshotId ? [{ value: WORKSPACE_CRUMB, label: 'Model' }, { label: 'Snapshot' }] : []),
            ]
          : []),
      ];

  function handleBreadcrumbNavigate(value: string | undefined) {
    if (value === PORTFOLIO_CRUMB && selectedCompany) {
      setSelectedCompany(null);
      setViewingModelWorkspace(false);
      setViewingSnapshotId(null);
    } else if (value === COMPANY_CRUMB) {
      setViewingModelWorkspace(false);
      setViewingSnapshotId(null);
    } else if (value === WORKSPACE_CRUMB) {
      setViewingSnapshotId(null);
    } else if (value && value === screen.parent) {
      setActive(value);
    }
  }

  const breadcrumbNavigable = Boolean(parentScreen) || (active === 'portfolio' && Boolean(selectedCompany));

  const fullBleed = active === 'portfolio' && Boolean(selectedCompany) && (viewingModelWorkspace || Boolean(viewingSnapshotId));

  function renderScreen() {
    if (active === 'portfolio') {
      if (!selectedCompany) return <PortfolioScreen onSelectCompany={setSelectedCompany} />;
      if (viewingSnapshotId) {
        return (
          <SnapshotViewScreen
            key={viewingSnapshotId}
            company={selectedCompany}
            snapshotId={viewingSnapshotId}
            onReturnToLive={() => setViewingSnapshotId(null)}
          />
        );
      }
      return viewingModelWorkspace ? (
        <ModelWorkspaceScreen company={selectedCompany} onViewSnapshot={setViewingSnapshotId} />
      ) : (
        <CompanyDetailScreen
          company={selectedCompany}
          onOpenMapping={openMapping}
          onOpenWorkspace={() => setViewingModelWorkspace(true)}
        />
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
        <main style={{ flex: '1 1 auto', overflow: 'auto', padding: fullBleed ? 0 : 'var(--gutter)' }}>
          {renderScreen()}
        </main>
      </div>

      {mappingSession ? (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 1000, overflow: 'auto',
            background: 'var(--surface-app)', padding: 'var(--gutter)',
          }}
        >
          <ModelMappingScreen {...mappingSession} />
        </div>
      ) : null}
    </div>
  );
}
