import { Alert, Badge, Checkbox } from '@basis/design-system';
import type { WorkbookAnalysis } from '../../../lib/aiImport/analyzeWorkbook';
import { cardStyle, mutedText, sectionTitle } from './styles';

interface SheetsStepProps {
  analysis: WorkbookAnalysis;
  selectedSheets: string[];
  onToggleSheet: (name: string, next: boolean) => void;
  /** Why the model's choice deserves a second look, if it does. */
  reasons: string[];
  replanError: string | null;
}

/** Step 1: which sheets hold the financials. The model's pick is preselected; the rest are one click away. */
export function SheetsStep({ analysis, selectedSheets, onToggleSheet, reasons, replanError }: SheetsStepProps) {
  const candidates = analysis.evidence.filter((e) => e.rowCount > 0);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)', maxWidth: 820 }}>
      {reasons.length > 0 ? (
        <Alert tone="caution" title="Please check this before continuing">
          <ul style={{ margin: 0, paddingLeft: 'var(--space-6)' }}>
            {reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </Alert>
      ) : (
        <Alert tone="info" title="The model was confident about where the financials are">
          Confirm the sheets below, then continue.
        </Alert>
      )}
      <span style={mutedText}>{analysis.triage.reasoning}</span>

      <section style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
        <span style={sectionTitle}>Sheets to import</span>
        {candidates.map((sheet) => {
          const alternative = analysis.triage.alternatives.find((a) => a.sheet === sheet.name);
          return (
            <div key={sheet.name} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
              <Checkbox
                checked={selectedSheets.includes(sheet.name)}
                onChange={(next) => onToggleSheet(sheet.name, next)}
                label={sheet.name}
                description={`${sheet.rowCount} rows · ${sheet.schemaMatches.distinctLines} Basis lines matched${alternative ? ` · ${alternative.note}` : ''}`}
              />
              {alternative ? <Badge tone="neutral" size="sm">Also considered</Badge> : null}
            </div>
          );
        })}
        {replanError ? <span style={{ ...mutedText, color: 'var(--text-negative)' }}>{replanError}</span> : null}
      </section>
    </div>
  );
}
