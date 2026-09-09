import { Dialog, Icon } from '@basis/design-system';
import type { LineMapping, StatementLine, StatementSchema } from '../../../data';
import { isCalculated } from '../../../lib/engine/resolve';
import { isMissingRequired } from './mappingFormatting';

const cellStyle = { padding: 'var(--space-3) var(--space-4)', borderBottom: '1px solid var(--border-subtle)' } as const;
const headStyle = {
  textAlign: 'left' as const,
  padding: 'var(--space-3) var(--space-4)',
  color: 'var(--text-secondary)',
  fontWeight: 'var(--weight-semibold)',
  borderBottom: '1px solid var(--border-default)',
};

function StatusCell({ line, mapping }: { line: StatementLine; mapping: LineMapping | undefined }) {
  // A real mapping (even on a calculated line — an issuer-reported subtotal) always wins the
  // check first; "Calculated" is only the fallback label for a structural formula with none.
  if ((mapping?.sourceLineIds.length ?? 0) > 0) {
    return <Icon name="check" size={14} color="var(--text-positive)" />;
  }
  if (isMissingRequired(line, mapping)) {
    return <Icon name="x" size={14} color="var(--text-negative)" />;
  }
  if (isCalculated(line) && !line.projection) {
    return <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-tertiary)' }}>Calculated</span>;
  }
  return <span style={{ color: 'var(--text-tertiary)' }}>—</span>;
}

interface MappedLinesDialogProps {
  open: boolean;
  statementSchema: StatementSchema;
  mapping: Record<string, LineMapping>;
  onClose: () => void;
}

export function MappedLinesDialog({ open, statementSchema, mapping, onClose }: MappedLinesDialogProps) {
  const rows = statementSchema.sections.flatMap((section) => section.lines.map((line) => ({ section, line })));

  return (
    <Dialog open={open} onClose={onClose} title="Mapped lines" subtitle={`${rows.length} target lines`} width={560}>
      <div style={{ display: 'flex', flexDirection: 'column', maxHeight: '50vh', overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-xs)' }}>
          <thead>
            <tr>
              <th style={headStyle}>Section</th>
              <th style={headStyle}>Line</th>
              <th style={{ ...headStyle, textAlign: 'center', width: 80 }}>Mapped</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ section, line }) => (
              <tr key={line.id}>
                <td style={{ ...cellStyle, color: 'var(--text-secondary)' }}>{section.name}</td>
                <td style={{ ...cellStyle, color: 'var(--text-primary)' }}>{line.name}</td>
                <td style={{ ...cellStyle, textAlign: 'center' }}>
                  <StatusCell line={line} mapping={mapping[line.id]} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Dialog>
  );
}
