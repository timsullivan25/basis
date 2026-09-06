import { useState } from 'react';
import { Card } from '@basis/design-system';

interface SettingCategory {
  value: string;
  title: string;
  description: string;
  icon: string;
}

const CATEGORIES: SettingCategory[] = [
  {
    value: 'settings-statements',
    title: 'Financial Statement Definitions',
    description: 'The sections and lines every import and model is mapped against.',
    icon: 'table-2',
  },
];

interface SettingsIndexScreenProps {
  onNavigate: (value: string) => void;
}

export function SettingsIndexScreen({ onNavigate }: SettingsIndexScreenProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gutter)' }}>
      <h1 style={{ fontSize: 'var(--text-xl)' }}>Settings</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 'var(--space-8)' }}>
        {CATEGORIES.map((category) => (
          <SettingCategoryCard key={category.value} category={category} onSelect={() => onNavigate(category.value)} />
        ))}
      </div>
    </div>
  );
}

function SettingCategoryCard({ category, onSelect }: { category: SettingCategory; onSelect: () => void }) {
  const [hover, setHover] = useState(false);

  return (
    <Card
      icon={category.icon}
      title={category.title}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
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
      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>{category.description}</span>
    </Card>
  );
}
