import { Dialog } from '@basis/design-system';
import type { ParsedSourceLine, ParsedWorkbook } from '../../../data';

function formatValue(value: number | null): string {
  if (value === null) return '—';
  const abs = Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return (value < 0 ? '−' : '') + abs;
}

interface ImportedLinesDialogProps {
  open: boolean;
  workbook: ParsedWorkbook;
  onClose: () => void;
}

export function ImportedLinesDialog({ open, workbook, onClose }: ImportedLinesDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Lines imported"
      subtitle={`${workbook.lines.length} lines across ${workbook.periods.length} periods`}
      width={640}
    >
      <div style={{ display: 'flex', flexDirection: 'column', maxHeight: '50vh', overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-xs)' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: 'var(--space-3) var(--space-4)', color: 'var(--text-secondary)', fontWeight: 'var(--weight-semibold)', borderBottom: '1px solid var(--border-default)' }}>
                Section
              </th>
              <th style={{ textAlign: 'left', padding: 'var(--space-3) var(--space-4)', color: 'var(--text-secondary)', fontWeight: 'var(--weight-semibold)', borderBottom: '1px solid var(--border-default)' }}>
                Line
              </th>
              <th style={{ textAlign: 'right', padding: 'var(--space-3) var(--space-4)', color: 'var(--text-secondary)', fontWeight: 'var(--weight-semibold)', borderBottom: '1px solid var(--border-default)' }}>
                {workbook.periods[workbook.periods.length - 1]?.name ?? 'Latest'}
              </th>
            </tr>
          </thead>
          <tbody>
            {workbook.lines.map((line: ParsedSourceLine) => (
              <tr key={line.id}>
                <td style={{ padding: 'var(--space-3) var(--space-4)', color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-subtle)' }}>
                  {line.section}
                </td>
                <td style={{ padding: 'var(--space-3) var(--space-4)', color: 'var(--text-primary)', borderBottom: '1px solid var(--border-subtle)' }}>
                  {line.group ? <span style={{ color: 'var(--text-tertiary)' }}>{line.group} — </span> : null}
                  {line.name}
                </td>
                <td
                  style={{
                    padding: 'var(--space-3) var(--space-4)', textAlign: 'right', fontFamily: 'var(--font-mono)',
                    fontVariantNumeric: 'var(--numeric-tabular)', color: 'var(--text-body)', borderBottom: '1px solid var(--border-subtle)',
                  }}
                >
                  {formatValue(line.values[line.values.length - 1] ?? null)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Dialog>
  );
}
