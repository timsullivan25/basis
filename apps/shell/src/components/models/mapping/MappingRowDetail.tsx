import { useState } from 'react';
import { Button, Checkbox, Input } from '@basis/design-system';
import type { LineMapping, ParsedSourceLine, ParsedWorkbook, StatementLine } from '../../../data';
import { formatPeriodValue, isLowConfidence, MATCH_METHOD_META } from './mappingFormatting';

const METHOD_DESCRIPTIONS: Record<string, string> = {
  exact: 'Exact name match',
  alias: 'Alias dictionary',
  fuzzy: 'Fuzzy match',
  ai: 'AI proposal',
  manual: 'Manual override',
  none: 'No match',
};

function normalizeSection(value: string): string {
  return value.trim().toLowerCase();
}

interface MappingRowDetailProps {
  target: StatementLine;
  sectionName: string;
  mapping: LineMapping;
  workbook: ParsedWorkbook;
  onSetSourceLines: (sourceLineIds: string[]) => void;
  onApprove: () => void;
}

export function MappingRowDetail({ target, sectionName, mapping, workbook, onSetSourceLines, onApprove }: MappingRowDetailProps) {
  const [search, setSearch] = useState('');

  const sourceById = (id: string): ParsedSourceLine | undefined => workbook.lines.find((line) => line.id === id);
  const query = search.trim().toLowerCase();
  const sameSection = normalizeSection(sectionName);
  const pool = (query ? workbook.lines : workbook.lines.filter((line) => normalizeSection(line.section) === sameSection)).filter(
    (line) => !query || line.name.toLowerCase().includes(query),
  );

  function toggle(line: ParsedSourceLine) {
    const next = mapping.sourceLineIds.includes(line.id)
      ? mapping.sourceLineIds.filter((id) => id !== line.id)
      : [...mapping.sourceLineIds, line.id];
    onSetSourceLines(next);
  }

  const lastPeriodIndex = workbook.periods.length - 1;
  const aggregatedTotal =
    mapping.sourceLineIds.length > 1
      ? mapping.sourceLineIds.reduce((sum, id) => sum + (sourceById(id)?.values[lastPeriodIndex] ?? 0), 0)
      : null;

  const methodMeta = MATCH_METHOD_META[mapping.method];
  const showApprove = isLowConfidence(mapping);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 'var(--space-9)' }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 'var(--text-2xs)', fontWeight: 'var(--weight-semibold)', letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: 'var(--space-4)' }}>
          Map {target.name} from · {sectionName}
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
          {mapping.sourceLineIds.length > 0 ? (
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
                  checked={mapping.sourceLineIds.includes(line.id)}
                  label={line.name}
                  description={query && normalizeSection(line.section) !== sameSection ? line.section : undefined}
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
      </div>
    </div>
  );
}
