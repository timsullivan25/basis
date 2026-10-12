import { Input } from '@basis/design-system';
import type { ParsedWorkbook } from '../../../data';

interface ManualHistoricalsInputProps {
  workbook: ParsedWorkbook;
  /** Index-aligned with workbook.periods, same convention resolveActuals' output already uses. */
  values: (number | null)[];
  onChange: (values: (number | null)[]) => void;
}

/** Shown instead of SourceLineChecklist when an instance has no source-file line to map from — a
 *  one-time adjustment, or a capital-structure tranche the uploaded workbook has no matching row
 *  for. Lets its historical values be typed in directly, per actual period, instead. Fixes a real
 *  gap: LineInstance.sourceLineIds' own doc comment describes "manual" (empty sourceLineIds) as a
 *  supported case, but no UI ever actually let a user enter a value for it. */
export function ManualHistoricalsInput({ workbook, values, onChange }: ManualHistoricalsInputProps) {
  function setAt(index: number, raw: string) {
    const next = [...values];
    next[index] = raw.trim() === '' ? null : Number(raw);
    if (next[index] !== null && Number.isNaN(next[index])) return;
    onChange(next);
  }

  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 'var(--text-2xs)', fontWeight: 'var(--weight-semibold)', letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: 'var(--space-4)' }}>
        Enter values manually
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', maxHeight: 200, overflow: 'auto', paddingRight: 'var(--space-3)' }}>
        {workbook.periods.map((period, index) => (
          <div key={period.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-6)' }}>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>{period.name}</span>
            <Input
              size="sm"
              type="number"
              value={values[index] ?? ''}
              onChange={(e) => setAt(index, e.target.value)}
              style={{ width: 120, textAlign: 'right' }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
