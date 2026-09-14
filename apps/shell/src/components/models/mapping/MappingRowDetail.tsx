import { Button } from '@basis/design-system';
import type { DebtTrancheProperties, LineMapping, ParsedSourceLine, ParsedWorkbook, StatementLine } from '../../../data';
import { isLowConfidence, MATCH_METHOD_META } from './mappingFormatting';
import { SourceLineChecklist } from './SourceLineChecklist';
import { DebtTranchePropertiesEditor } from '../instances/DebtTranchePropertiesEditor';

const METHOD_DESCRIPTIONS: Record<string, string> = {
  exact: 'Exact name match',
  alias: 'Alias dictionary',
  fuzzy: 'Fuzzy match',
  ai: 'AI proposal',
  manual: 'Manual override',
  none: 'No match',
};

interface MappingRowDetailProps {
  target: StatementLine;
  sectionName: string;
  mapping: LineMapping;
  workbook: ParsedWorkbook;
  onSetSourceLines: (sourceLineIds: string[]) => void;
  onApprove: () => void;
  /** Set once this line has ≥1 real child line (parentLineId pointing here) summing into it —
   *  its value is superseded by that sum for every period (see StatementLine.allowsSubLines' own
   *  doc comment), so direct mapping here would silently be ignored. Disables the checklist
   *  below in favor of an explanation. */
  supersededByInstanceCount?: number;
  /** True when this line's effective kind is 'debt' (see lib/statementLineChildren.ts's
   *  effectiveLineKind) and it currently has no children — a standalone debt line, acting as its
   *  own single tranche until a real sub-line is added (at which point supersededByInstanceCount
   *  takes over and this panel moves to each child instead — see StatementLine.debtProperties'
   *  own doc comment). Shows the debt-properties panel (including Term/Revolver) alongside the
   *  normal mapping checklist, since this line still needs its own mapped/manual value too. */
  isDebtLine?: boolean;
  debtProperties?: DebtTrancheProperties;
  onChangeDebtProperties?: (patch: Partial<DebtTrancheProperties>) => void;
}

export function MappingRowDetail({
  target, sectionName, mapping, workbook, onSetSourceLines, onApprove, supersededByInstanceCount,
  isDebtLine, debtProperties, onChangeDebtProperties,
}: MappingRowDetailProps) {
  if (supersededByInstanceCount) {
    return (
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', maxWidth: 480 }}>
        {target.name} is broken into {supersededByInstanceCount} sub-line{supersededByInstanceCount > 1 ? 's' : ''} — its value
        is the sum of those for every period, so direct mapping here is disabled. Manage its sub-lines from the Segments,
        adjustments &amp; KPIs panel in the model workspace.
      </div>
    );
  }

  const sourceById = (id: string): ParsedSourceLine | undefined => workbook.lines.find((line) => line.id === id);
  const methodMeta = MATCH_METHOD_META[mapping.method];
  const showApprove = isLowConfidence(mapping);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 'var(--space-9)' }}>
      <SourceLineChecklist
        title={`Map ${target.name} from`}
        sectionName={sectionName}
        workbook={workbook}
        sourceLineIds={mapping.sourceLineIds}
        onSetSourceLines={onSetSourceLines}
      />

      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 'var(--text-2xs)', fontWeight: 'var(--weight-semibold)', letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: 'var(--space-4)' }}>
          How this was matched
        </div>
        {[
          ['Method', METHOD_DESCRIPTIONS[mapping.method]],
          ['Confidence', mapping.method === 'none' ? '—' : mapping.confidence.toFixed(2)],
          ['Source lines', mapping.sourceLineIds.length ? mapping.sourceLineIds.map((id) => sourceById(id)?.name).join(', ') : '—'],
          ['Aggregation', mapping.sourceLineIds.length > 1 ? `Sum of ${mapping.sourceLineIds.length} lines` : mapping.sourceLineIds.length ? 'One-to-one' : '—'],
        ].map(([label, value]) => (
          <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-6)', padding: 'var(--space-2) 0' }}>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>{label}</span>
            <span style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', color: 'var(--text-body)', textAlign: 'right' }}>{value}</span>
          </div>
        ))}
        <p style={{ margin: 'var(--space-5) 0 0', fontSize: 'var(--text-sm)', fontFamily: 'var(--font-serif)', color: 'var(--text-body)' }}>{mapping.note}</p>

        {showApprove ? (
          <div style={{ marginTop: 'var(--space-5)' }}>
            <Button size="sm" variant="secondary" iconLeft="check" onClick={onApprove}>
              Approve match
            </Button>
            <p style={{ margin: 'var(--space-3) 0 0', fontSize: 'var(--text-2xs)', color: 'var(--text-tertiary)' }}>
              Confirms {methodMeta.label.toLowerCase()} match {mapping.confidence.toFixed(2)} without changing the source lines.
            </p>
          </div>
        ) : null}

        {isDebtLine ? (
          <DebtTranchePropertiesEditor instance={debtProperties ?? {}} onChange={onChangeDebtProperties!} />
        ) : null}
      </div>
    </div>
  );
}
