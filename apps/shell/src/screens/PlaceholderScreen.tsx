import { Card } from '@basis/design-system';

export function PlaceholderScreen({ title }: { title: string }) {
  return (
    <Card title={title}>
      <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>
        The {title.toLowerCase()} screen hasn't been built yet.
      </p>
    </Card>
  );
}
