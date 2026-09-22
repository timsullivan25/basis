import { useState } from 'react';
import { Button, Checkbox, Input } from '@basis/design-system';
import type { ParsedSourceLine, ParsedWorkbook } from '../../../data';
import { formatPeriodValue } from './mappingFormatting';
import { searchSourceLines } from '../../../lib/searchSourceLines';

interface SourceLineChecklistProps {
  /** e.g. "Map Revenue from" or "Map new line from" — mappingRowSections.tsx and the mapping
   *  screen's "+ Add sub-line" creator each supply their own. */
  title: string;
  sectionName: string;
  workbook: ParsedWorkbook;
  sourceLineIds: string[];
  onSetSourceLines: (sourceLineIds: string[]) => void;
}

type Row = { kind: 'header'; text: string } | { kind: 'group'; text: string } | { kind: 'line'; line: ParsedSourceLine; checked: boolean };

/** The section-scoped "pick one or more source lines, see the aggregated total" checklist —
 *  shared by mappingRowSections.tsx (the mapping section, in both the side panel and
 *  MappingReviewDialog) and the mapping screen's "+ Add sub-line/KPI" creator.
 *
 *  Picking a source line out of an entire imported file is the actual task here, so the layout is
 *  built around that: whatever's already picked floats to the top of the list (so a multi-line sum
 *  never scrolls out of view while you're still adding to it), and the unfiltered view defaults to
 *  just the target's own section — almost always where its match actually lives — rather than
 *  opening straight onto every line in the file. "All lines" is one click away for the rarer
 *  cross-section case, and switches on its own once there's nothing in-section to show. */
export function SourceLineChecklist({ title, sectionName, workbook, sourceLineIds, onSetSourceLines }: SourceLineChecklistProps) {
  const [search, setSearch] = useState('');
  const [scope, setScope] = useState<'section' | 'all'>('section');

  const sourceById = (id: string): ParsedSourceLine | undefined => workbook.lines.find((line) => line.id === id);
  const query = search.trim();
  const preferred = sectionName.trim().toLowerCase();
  const inPreferredSection = (l: ParsedSourceLine) => l.section.trim().toLowerCase() === preferred;
  const sectionCount = workbook.lines.filter(inPreferredSection).length;
  // A query always searches the whole file — the scope toggle only controls the unfiltered
  // default view, and doesn't apply once there's nothing to scope (every line already matches,
  // or none do, elsewhere in the file has to be considered too).
  const effectiveScope = query || sectionCount === 0 || sectionCount === workbook.lines.length ? 'all' : scope;

  const ranked = searchSourceLines(workbook.lines, search, sectionName);
  const pool = effectiveScope === 'all' ? ranked : ranked.filter(inPreferredSection);

  function toggle(line: ParsedSourceLine) {
    const next = sourceLineIds.includes(line.id) ? sourceLineIds.filter((id) => id !== line.id) : [...sourceLineIds, line.id];
    onSetSourceLines(next);
  }

  const lastPeriodIndex = workbook.periods.length - 1;
  const aggregatedTotal =
    sourceLineIds.length > 1 ? sourceLineIds.reduce((sum, id) => sum + (sourceById(id)?.values[lastPeriodIndex] ?? 0), 0) : null;

  // Selected lines are pulled out and pinned above the rest, in pick order — not filtered out of
  // `pool` and re-added, so a selection made under a search still shows once the search clears.
  const selected = sourceLineIds.map(sourceById).filter((l): l is ParsedSourceLine => !!l);
  const rest = pool.filter((l) => !sourceLineIds.includes(l.id));

  const rows: Row[] = [];
  if (selected.length > 0) {
    rows.push({ kind: 'header', text: `Selected · ${selected.length}` });
    for (const line of selected) rows.push({ kind: 'line', line, checked: true });
  }
  if (rest.length > 0) {
    rows.push({
      kind: 'header',
      text: query
        ? `${rest.length} match${rest.length === 1 ? '' : 'es'}`
        : effectiveScope === 'all'
          ? `All lines · ${rest.length}`
          : `This section · ${rest.length}`,
    });
    // Sub-grouped by the imported file's own section, so scrolling "All lines" reads as clusters
    // instead of one undifferentiated wall of rows — skipped for a search (already ranked by match
    // quality, not by section) and for the single-section scope (nothing to group by).
    let lastGroup: string | null = null;
    for (const line of rest) {
      if (effectiveScope === 'all' && !query && line.section !== lastGroup) {
        rows.push({ kind: 'group', text: line.section });
        lastGroup = line.section;
      }
      rows.push({ kind: 'line', line, checked: false });
    }
  }

  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 'var(--text-2xs)', fontWeight: 'var(--weight-semibold)', letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: 'var(--space-4)' }}>
        {title} · {sectionName}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', marginBottom: 'var(--space-4)' }}>
        <Input
          size="sm"
          iconLeft="search"
          placeholder={`Search all ${workbook.lines.length} parsed lines`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: '1 1 auto', minWidth: 0 }}
        />
        {sourceLineIds.length > 0 ? (
          <Button size="sm" variant="ghost" iconLeft="x" onClick={() => onSetSourceLines([])}>
            Clear
          </Button>
        ) : null}
      </div>

      {!query && sectionCount > 0 && sectionCount < workbook.lines.length ? (
        <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
          <Button size="sm" variant="ghost" selected={scope === 'section'} onClick={() => setScope('section')}>
            This section · {sectionCount}
          </Button>
          <Button size="sm" variant="ghost" selected={scope === 'all'} onClick={() => setScope('all')}>
            All lines · {workbook.lines.length}
          </Button>
        </div>
      ) : null}

      <div style={{ maxHeight: 320, overflow: 'auto', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)' }}>
        {rows.length === 0 ? (
          <p style={{ margin: 0, padding: 'var(--space-5)', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
            No parsed line matches “{search}”.
          </p>
        ) : (
          rows.map((row, i) => {
            if (row.kind === 'header') {
              return (
                <div
                  key={`h${i}`}
                  style={{
                    position: 'sticky', top: 0, zIndex: 1, padding: 'var(--space-3) var(--space-4)',
                    fontSize: 'var(--text-3xs)', fontWeight: 'var(--weight-semibold)', letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase',
                    color: 'var(--text-secondary)', background: 'var(--surface-table-head)', borderBottom: '1px solid var(--border-subtle)',
                  }}
                >
                  {row.text}
                </div>
              );
            }
            if (row.kind === 'group') {
              return (
                <div key={`g${i}`} style={{ padding: 'var(--space-2) var(--space-4)', fontSize: 'var(--text-3xs)', color: 'var(--text-tertiary)', background: 'var(--surface-app)' }}>
                  {row.text}
                </div>
              );
            }
            return <SourceLineRow key={row.line.id} line={row.line} checked={row.checked} onToggle={() => toggle(row.line)} lastPeriodIndex={lastPeriodIndex} />;
          })
        )}
      </div>

      {aggregatedTotal !== null ? (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-6)', paddingTop: 'var(--space-4)', fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-medium)', color: 'var(--text-primary)' }}>
          <span>Aggregated total · {workbook.periods[lastPeriodIndex]?.name}</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'var(--numeric-tabular)' }}>{formatPeriodValue(aggregatedTotal)}</span>
        </div>
      ) : null}
    </div>
  );
}

function SourceLineRow({ line, checked, onToggle, lastPeriodIndex }: { line: ParsedSourceLine; checked: boolean; onToggle: () => void; lastPeriodIndex: number }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onClick={onToggle}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-6)',
        padding: 'var(--space-4)', cursor: 'pointer', borderBottom: '1px solid var(--border-subtle)',
        background: checked ? 'var(--surface-selected)' : hovered ? 'var(--surface-hover)' : 'transparent',
      }}
    >
      <Checkbox checked={checked} label={line.name} description={[line.section, line.group].filter(Boolean).join(' · ')} onChange={onToggle} />
      <span style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'var(--numeric-tabular)', color: 'var(--text-secondary)', flex: '0 0 auto' }}>
        {formatPeriodValue(line.values[lastPeriodIndex] ?? null)}
      </span>
    </div>
  );
}
