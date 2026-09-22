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

/** The section-scoped "pick one or more source lines, see the aggregated total" checklist —
 *  extracted out of what's now mappingRowSections.tsx so the mapping screen's "+ Add sub-line/KPI"
 *  creator can reuse the identical control rather than duplicating it (see Phase 9 plan's Slice 4). */
export function SourceLineChecklist({ title, sectionName, workbook, sourceLineIds, onSetSourceLines }: SourceLineChecklistProps) {
  const [search, setSearch] = useState('');

  const sourceById = (id: string): ParsedSourceLine | undefined => workbook.lines.find((line) => line.id === id);
  const pool = searchSourceLines(workbook.lines, search, sectionName);
  function toggle(line: ParsedSourceLine) {
    const next = sourceLineIds.includes(line.id) ? sourceLineIds.filter((id) => id !== line.id) : [...sourceLineIds, line.id];
    onSetSourceLines(next);
  }

  const lastPeriodIndex = workbook.periods.length - 1;
  const aggregatedTotal =
    sourceLineIds.length > 1 ? sourceLineIds.reduce((sum, id) => sum + (sourceById(id)?.values[lastPeriodIndex] ?? 0), 0) : null;

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
          style={{ width: 260 }}
        />
        {sourceLineIds.length > 0 ? (
          <Button size="sm" variant="ghost" iconLeft="x" onClick={() => onSetSourceLines([])}>
            Clear
          </Button>
        ) : null}
      </div>

      <div style={{ maxHeight: 200, overflow: 'auto', paddingRight: 'var(--space-3)' }}>
        {pool.length === 0 ? (
          <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
            No parsed line matches “{search}”.
          </p>
        ) : (
          pool.map((line) => (
            <div
              key={line.id}
              onClick={() => toggle(line)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-6)',
                padding: 'var(--space-3) 0', cursor: 'pointer', borderBottom: '1px solid var(--border-subtle)',
              }}
            >
              <Checkbox
                checked={sourceLineIds.includes(line.id)}
                label={line.name}
                description={[line.section, line.group].filter(Boolean).join(' - ')}
                onChange={() => toggle(line)}
              />
              <span style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'var(--numeric-tabular)', color: 'var(--text-secondary)' }}>
                {formatPeriodValue(line.values[lastPeriodIndex] ?? null)}
              </span>
            </div>
          ))
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
