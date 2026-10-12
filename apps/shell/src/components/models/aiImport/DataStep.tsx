import { useMemo, useState } from 'react';
import { Alert, Button, Checkbox } from '@basis/design-system';
import type { ExtractionPlan } from '../../../lib/aiImport/extractionPlan';
import { isImportableKind, periodKey, periodName, type PeriodOption } from '../../../lib/aiImport/periodOptions';
import { columnIndex, type SheetGrid } from '../../../lib/aiImport/workbookGrid';
import { snapRange } from './sheetViewerMath';
import { SheetViewer, type RowRange } from './SheetViewer';
import { cardStyle, mutedText, sectionTitle } from './styles';

const KIND_LABELS: Record<string, string> = { FY: 'Annual', Quarter: 'Quarterly', 'Semi-Annual': 'Semi-annual' };
/** Value columns shown when no importable period is selected, so the viewer is never empty. */
const FALLBACK_COLUMNS = 6;

/** Stable identity for a section of the current plan, used to track which are switched off. */
export function sectionKey(sheetIdx: number, sectionIdx: number): string {
  return `${sheetIdx}:${sectionIdx}`;
}

interface DataStepProps {
  grids: SheetGrid[];
  plan: ExtractionPlan;
  options: PeriodOption[];
  selectedPeriods: ReadonlySet<string>;
  onPeriodsChange: (next: Set<string>) => void;
  disabledSections: ReadonlySet<string>;
  onToggleSection: (key: string, include: boolean) => void;
  onSetRange: (sheetIdx: number, sectionIdx: number, range: RowRange) => void;
  /** Lines each section currently yields, keyed by section name. */
  lineCounts: Record<string, number>;
  extractionError: string | null;
}

/** Step 2: which periods to import, and — section by section — where on the worksheet the data comes from. */
export function DataStep({ grids, plan, options, selectedPeriods, onPeriodsChange, disabledSections, onToggleSection, onSetRange, lineCounts, extractionError }: DataStepProps) {
  const importable = options.filter((o) => o.importable);
  const kinds = [...new Set(importable.map((o) => o.kind))];
  const skipped = options.length - importable.length;

  const flat = useMemo(
    () => plan.sheets.flatMap((sheet, si) => sheet.sections.map((section, ci) => ({ key: sectionKey(si, ci), sheetIdx: si, sectionIdx: ci, sheet, section }))),
    [plan],
  );
  const [requestedKey, setRequestedKey] = useState<string | null>(null);
  const active = flat.find((f) => f.key === requestedKey) ?? flat[0] ?? null;
  const activePos = active ? flat.indexOf(active) : -1;
  const activeGrid = active ? grids.find((g) => g.name === active.sheet.sheet) : undefined;

  // Scroll target: fixed when the section is selected, so dragging its top edge doesn't yank the view around.
  const focusRow = useMemo(() => active?.section.firstRow ?? null, [active?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const viewerColumns = useMemo(() => {
    if (!active || !activeGrid) return [];
    const chosen = active.sheet.periodColumns.filter((c) => c.actual && isImportableKind(c.kind) && selectedPeriods.has(periodKey(periodName(activeGrid, active.sheet, c))));
    const columns = chosen.length > 0 ? chosen : active.sheet.periodColumns.filter((c) => c.actual).slice(0, FALLBACK_COLUMNS);
    return columns.map((c) => columnIndex(c.column));
  }, [active, activeGrid, selectedPeriods]);

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
  const go = (delta: number) => {
    const target = flat[activePos + delta];
    if (target) setRequestedKey(target.key);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
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
          <span style={mutedText}>Not imported: {skipped} projected, LTM or NTM column{skipped === 1 ? '' : 's'} — projections aren't imported yet.</span>
        ) : null}
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: '300px minmax(0, 1fr)', gap: 'var(--space-5)', alignItems: 'start' }}>
        <section style={{ ...cardStyle, padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', maxHeight: 'calc(100vh - 300px)', overflow: 'auto' }}>
          <span style={{ ...sectionTitle, padding: 'var(--space-2) var(--space-3)' }}>Sections</span>
          {plan.sheets.map((sheet, si) => (
            <div key={sheet.sheet} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {plan.sheets.length > 1 ? <span style={{ ...mutedText, padding: 'var(--space-2) var(--space-3)' }}>{sheet.sheet}</span> : null}
              {sheet.sections.map((section, ci) => {
                const key = sectionKey(si, ci);
                const included = !disabledSections.has(key);
                const isActive = active?.key === key;
                return (
                  <div
                    key={key}
                    onClick={() => setRequestedKey(key)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-3)', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                      background: isActive ? 'var(--surface-selected)' : 'transparent', borderLeft: `3px solid ${isActive ? 'var(--action-primary-bg)' : 'transparent'}`,
                      opacity: included ? 1 : 0.5,
                    }}
                  >
                    <span onClick={(e) => e.stopPropagation()}>
                      <Checkbox checked={included} onChange={(on) => onToggleSection(key, on)} />
                    </span>
                    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                      <span style={{ fontSize: 'var(--text-sm)', fontWeight: isActive ? 'var(--weight-medium)' : 'var(--weight-regular)', color: 'var(--text-primary)' }}>{section.name}</span>
                      <span style={{ fontSize: 'var(--text-3xs)', color: 'var(--text-tertiary)' }}>
                        {included ? `${lineCounts[section.name] ?? 0} lines` : 'excluded'}
                        {section.groups.length > 0 ? ` · ${section.groups.length} group${section.groups.length === 1 ? '' : 's'}` : ''}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </section>

        {active && activeGrid ? (
          <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
              <Button size="sm" variant="secondary" iconLeft="chevron-left" onClick={() => go(-1)} disabled={activePos <= 0}>
                Previous
              </Button>
              <Button size="sm" variant="secondary" iconRight="chevron-right" onClick={() => go(1)} disabled={activePos >= flat.length - 1}>
                Next section
              </Button>
              <div style={{ display: 'flex', flexDirection: 'column', marginLeft: 'var(--space-3)' }}>
                <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', color: 'var(--text-primary)' }}>{active.section.name}</span>
                <span style={mutedText}>
                  {active.sheet.sheet} · rows {active.section.firstRow}–{active.section.lastRow} — drag the blue handles to change where it starts or ends
                </span>
              </div>
            </div>
            {snapRange(activeGrid.rows.map((r) => r.rowNumber), { first: active.section.firstRow, last: active.section.lastRow }) === null ? (
              <Alert tone="caution" compact>
                No rows with data fall inside rows {active.section.firstRow}–{active.section.lastRow}, so nothing will be imported from this section.
              </Alert>
            ) : null}
            <SheetViewer
              grid={activeGrid}
              labelColumn={columnIndex(active.sheet.labelColumn)}
              valueColumns={viewerColumns}
              pinnedRows={[active.sheet.nameRow, active.sheet.dateRow].filter((r): r is number => r !== null).sort((a, b) => a - b)}
              range={{ first: active.section.firstRow, last: active.section.lastRow }}
              onRangeChange={(range) => onSetRange(active.sheetIdx, active.sectionIdx, range)}
              groupHeaderRows={new Set(active.section.groups.map((g) => g.headerRow))}
              focusRow={focusRow}
              height="calc(100vh - 380px)"
            />
          </section>
        ) : null}
      </div>
    </div>
  );
}
