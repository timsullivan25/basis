import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Input } from '@basis/design-system';
import { companyRepository, type Company } from '../data';
import { AddCompanyDialog } from '../components/AddCompanyDialog';
import { CompanyCard } from '../components/CompanyCard';

export function PortfolioScreen() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [selected, setSelected] = useState<Company | null>(null);

  const refresh = useCallback(async () => {
    setCompanies(await companyRepository.list());
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const all = await companyRepository.list();
      if (!cancelled) {
        setCompanies(all);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return companies;
    return companies.filter((company) => company.name.toLowerCase().includes(q));
  }, [companies, query]);

  async function handleAddCompany(name: string) {
    await companyRepository.create({ name });
    await refresh();
  }

  if (selected) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
        <Button variant="ghost" size="sm" iconLeft="arrow-left" onClick={() => setSelected(null)}>
          Back to portfolio
        </Button>
        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
          <strong style={{ color: 'var(--text-primary)' }}>{selected.name}</strong> — dashboard, modeling,
          documents, and events workflows land here next.
        </span>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gutter)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-6)' }}>
        <Input
          iconLeft="search"
          placeholder="Search companies"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onClear={() => setQuery('')}
          fullWidth={false}
          style={{ width: 280 }}
        />
        <div style={{ flex: '1 1 auto' }} />
        <Button variant="primary" iconLeft="plus" onClick={() => setAddOpen(true)}>
          Add company
        </Button>
      </div>

      {loading ? (
        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>Loading…</span>
      ) : filtered.length === 0 ? (
        <EmptyState hasCompanies={companies.length > 0} onAdd={() => setAddOpen(true)} />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 'var(--space-8)' }}>
          {filtered.map((company) => (
            <CompanyCard key={company.id} company={company} onSelect={setSelected} />
          ))}
        </div>
      )}

      <AddCompanyDialog open={addOpen} onClose={() => setAddOpen(false)} onSubmit={handleAddCompany} />
    </div>
  );
}

function EmptyState({ hasCompanies, onAdd }: { hasCompanies: boolean; onAdd: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 'var(--space-5)', padding: 'var(--space-11) 0' }}>
      <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
        {hasCompanies ? 'No companies match your search.' : 'No companies yet.'}
      </span>
      {!hasCompanies ? (
        <Button variant="secondary" iconLeft="plus" onClick={onAdd}>
          Add your first company
        </Button>
      ) : null}
    </div>
  );
}
