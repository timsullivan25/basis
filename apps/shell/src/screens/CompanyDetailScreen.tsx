import { useState } from 'react';
import { Tabs } from '@basis/design-system';
import type { Company } from '../data';
import { DashboardTab } from '../components/models/DashboardTab';
import { FinancialsTab } from '../components/models/FinancialsTab';
import type { ModelMappingScreenProps } from '../components/models/mapping/ModelMappingScreen';
import { PlaceholderScreen } from './PlaceholderScreen';

const TABS = [
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
}

export function CompanyDetailScreen({ company, onOpenMapping, onOpenWorkspace }: CompanyDetailScreenProps) {
  const [tab, setTab] = useState(TABS[0].value);
  const activeTab = TABS.find((t) => t.value === tab) ?? TABS[0];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-8)' }}>
      <h1 style={{ fontSize: 'var(--text-2xl)' }}>{company.name}</h1>
      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      {tab === 'dashboard' ? (
        <DashboardTab company={company} onOpenWorkspace={onOpenWorkspace} onGoToFinancials={() => setTab('financials')} />
      ) : tab === 'financials' ? (
        <FinancialsTab company={company} onOpenMapping={onOpenMapping} onOpenWorkspace={onOpenWorkspace} />
      ) : (
        <PlaceholderScreen title={activeTab.label} />
      )}
    </div>
  );
}
