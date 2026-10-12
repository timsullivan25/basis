import { useState } from 'react';
import { Card } from '@basis/design-system';
import type { Company } from '../data';

interface CompanyCardProps {
  company: Company;
  onSelect: (company: Company) => void;
}

export function CompanyCard({ company, onSelect }: CompanyCardProps) {
  const [hover, setHover] = useState(false);

  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={() => onSelect(company)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(company);
        }
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        cursor: 'pointer',
        borderColor: hover ? 'var(--border-strong-c)' : undefined,
        boxShadow: hover ? 'var(--shadow-1)' : undefined,
        transition: 'var(--transition-control)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-6)' }}>
        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto',
            width: 32, height: 32, borderRadius: 'var(--radius-md)',
            background: 'var(--surface-selected)', color: 'var(--text-brand)',
            fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)',
          }}
        >
          {company.name.charAt(0).toUpperCase()}
        </div>
        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--text-primary)' }}>
          {company.name}
        </span>
      </div>
    </Card>
  );
}
