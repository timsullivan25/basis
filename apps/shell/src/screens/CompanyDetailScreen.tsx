import { Tabs } from '@basis/design-system';
import type { Company } from '../data';
import { DashboardTab } from '../components/models/DashboardTab';
import { FinancialsTab } from '../components/models/FinancialsTab';
import type { ModelMappingScreenProps } from '../components/models/mapping/ModelMappingScreen';
import { PlaceholderScreen } from './PlaceholderScreen';

export const COMPANY_DETAIL_TABS = [
  { value: 'dashboard', label: 'Dashboard' },
  { value: 'financials', label: 'Financials' },
  { value: 'documents', label: 'Documents' },
  { value: 'events', label: 'Events' },
];

interface CompanyDetailScreenProps {
  company: Company;
  /** Opens the mapping screen as a dedicated app-level overlay — see AppShell. */
  onOpenMapping: (props: ModelMappingScreenProps) => void;
  /** Navigates to the model workspace — a sibling screen, not nested here — see AppShell. */
  onOpenWorkspace: () => void;
  /** Lifted up to AppShell so it survives this screen unmounting while the model workspace is
   *  open (see AppShell's viewingModelWorkspace) — otherwise returning from the workspace always
   *  landed back on Dashboard regardless of which tab was active before. */
  tab: string;
  onTabChange: (tab: string) => void;
}

export function CompanyDetailScreen({ company, onOpenMapping, onOpenWorkspace, tab, onTabChange }: CompanyDetailScreenProps) {
  const activeTab = COMPANY_DETAIL_TABS.find((t) => t.value === tab) ?? COMPANY_DETAIL_TABS[0];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-8)' }}>
      <h1 style={{ fontSize: 'var(--text-2xl)' }}>{company.name}</h1>
      <Tabs tabs={COMPANY_DETAIL_TABS} value={tab} onChange={onTabChange} />
      {tab === 'dashboard' ? (
        <DashboardTab />
      ) : tab === 'financials' ? (
        <FinancialsTab company={company} onOpenMapping={onOpenMapping} onOpenWorkspace={onOpenWorkspace} />
      ) : (
        <PlaceholderScreen title={activeTab.label} />
      )}
    </div>
  );
}
