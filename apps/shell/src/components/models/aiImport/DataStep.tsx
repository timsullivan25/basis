import { Alert, Checkbox, Input } from '@basis/design-system';
import type { ExtractionPlan } from '../../../lib/aiImport/extractionPlan';
import type { PeriodOption } from '../../../lib/aiImport/periodOptions';
import { cardStyle, mutedText, sectionTitle } from './styles';

const KIND_LABELS: Record<string, string> = { FY: 'Annual', Quarter: 'Quarterly', 'Semi-Annual': 'Semi-annual' };

/** Stable identity for a section of the current plan, used to track which are switched off. */
export function sectionKey(sheetIdx: number, sectionIdx: number): string {
  return `${sheetIdx}:${sectionIdx}`;
}

interface DataStepProps {
  plan: ExtractionPlan;
  options: PeriodOption[];
  selectedPeriods: ReadonlySet<string>;
  onPeriodsChange: (next: Set<string>) => void;
  disabledSections: ReadonlySet<string>;
  onToggleSection: (key: string, include: boolean) => void;
  onRange: (sheetIdx: number, sectionIdx: number, key: 'firstRow' | 'lastRow', raw: string) => void;
  /** Lines each section currently yields, keyed by section name. */
  lineCounts: Record<string, number>;
  extractionError: string | null;
}

/** Step 2: which periods to import and where each section's data comes from. */
export function DataStep({ plan, options, selectedPeriods, onPeriodsChange, disabledSections, onToggleSection, onRange, lineCounts, extractionError }: DataStepProps) {
  const importable = options.filter((o) => o.importable);
  const kinds = [...new Set(importable.map((o) => o.kind))];
  const skipped = options.length - importable.length;

  function toggleKind(kind: string, on: boolean) {
    const next = new Set(selectedPeriods);
    for (const o of importable) if (o.kind === kind) (on ? next.add(o.key) : next.delete(o.key));
    onPeriodsChange(next);
  }
  function togglePeriod(key: string, on: boolean) {
    const next = new Set(selectedPeriods);
    if (on) next.add(key);
    else next.delete(key);
    onPeriodsChange(next);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      {extractionError ? <Alert tone="negative" title="Nothing to import yet">{extractionError}</Alert> : null}

      <section style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <span style={sectionTitle}>Periods</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-6)' }}>
          {kinds.map((kind) => {
            const ofKind = importable.filter((o) => o.kind === kind);
            const selectedCount = ofKind.filter((o) => selectedPeriods.has(o.key)).length;
            return (
              <Checkbox
                key={kind}
                checked={selectedCount === ofKind.length}
                indeterminate={selectedCount > 0 && selectedCount < ofKind.length}
                onChange={(on) => toggleKind(kind, on)}
                label={`${KIND_LABELS[kind] ?? kind} (${ofKind.length})`}
              />
            );
          })}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3) var(--space-6)' }}>
          {importable.map((o) => (
            <Checkbox key={o.key} checked={selectedPeriods.has(o.key)} onChange={(on) => togglePeriod(o.key, on)} label={o.name} />
          ))}
        </div>
        {skipped > 0 ? (
          <span style={mutedText}>
            Not imported: {skipped} projected, LTM or NTM column{skipped === 1 ? '' : 's'} — projections aren't imported yet.
          </span>
        ) : null}
      </section>

      <section style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <span style={sectionTitle}>Sections</span>
        {plan.sheets.map((sheet, sheetIdx) => (
          <div key={sheet.sheet} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', color: 'var(--text-primary)' }}>
              {sheet.sheet} <span style={mutedText}>· labels in column {sheet.labelColumn}</span>
            </span>
            {sheet.sections.map((section, sectionIdx) => {
              const key = sectionKey(sheetIdx, sectionIdx);
              const included = !disabledSections.has(key);
              return (
                <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', opacity: included ? 1 : 0.5 }}>
                    <Checkbox checked={included} onChange={(on) => onToggleSection(key, on)} label={section.name} style={{ width: 220 }} />
                    <span style={mutedText}>rows</span>
                    <Input size="sm" mono type="number" style={{ width: 84 }} selectOnFocus value={section.firstRow} onChange={(e) => onRange(sheetIdx, sectionIdx, 'firstRow', e.target.value)} />
                    <span style={mutedText}>to</span>
                    <Input size="sm" mono type="number" style={{ width: 84 }} selectOnFocus value={section.lastRow} onChange={(e) => onRange(sheetIdx, sectionIdx, 'lastRow', e.target.value)} />
                    <span style={mutedText}>{included ? `${lineCounts[section.name] ?? 0} lines` : 'excluded'}</span>
                  </div>
                  {section.groups.length > 0 ? (
                    <details style={{ marginLeft: 220 + 16 }}>
                      <summary style={{ ...mutedText, cursor: 'pointer' }}>
                        {section.groups.length} group{section.groups.length === 1 ? '' : 's'} — lines are named "group — label"
                      </summary>
                      <ul style={{ ...mutedText, margin: 'var(--space-2) 0 0', paddingLeft: 'var(--space-6)' }}>
                        {section.groups.map((group) => (
                          <li key={`${group.headerRow}-${group.title}`}>
                            {group.title} <span style={{ fontFamily: 'var(--font-mono)' }}>· rows {group.firstRow}–{group.lastRow}</span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </div>
              );
            })}
          </div>
        ))}
      </section>
    </div>
  );
}
