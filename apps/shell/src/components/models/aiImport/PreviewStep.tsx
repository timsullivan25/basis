import { useMemo } from 'react';
import { Alert, DataTable } from '@basis/design-system';
import type { ExtractionResult } from '../../../lib/aiImport/extractHistoricals';
import { mutedText, sectionTitle } from './styles';

function formatCell(value: number | null): string {
  return value === null ? '—' : value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

/** Step 3: exactly what will be handed to mapping — periods, lines grouped by section, and anything worth a second look. */
export function PreviewStep({ result, error }: { result: ExtractionResult | null; error: string | null }) {
  const rows = useMemo(() => {
    if (!result) return [];
    const out: Record<string, unknown>[] = [];
    let section = '';
    result.workbook.lines.forEach((line, i) => {
      if (line.section !== section) {
        section = line.section;
        out.push({ __group: section, id: `group-${section}` });
      }
      const row: Record<string, unknown> = { id: `line-${i}`, name: line.name };
      line.values.forEach((v, p) => {
        row[`p${p}`] = v;
      });
      out.push(row);
    });
    return out;
  }, [result]);

  const columns = useMemo(
    () => [
      { key: 'name', label: 'Line', emphasis: true, maxWidth: 360 },
      ...(result?.workbook.periods ?? []).map((p, i) => ({ key: `p${i}`, label: p.name, numeric: true, render: (v: number | null) => formatCell(v) })),
    ],
    [result],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <span style={sectionTitle}>
        Preview{result ? ` · ${result.workbook.lines.length} lines · ${result.workbook.periods.length} period${result.workbook.periods.length === 1 ? '' : 's'}` : ''}
      </span>
      <span style={mutedText}>This is what mapping will receive. Go back to change sheets, periods or ranges.</span>
      {error ? <Alert tone="negative" title="Nothing to extract">{error}</Alert> : null}
      {result?.warnings.length ? (
        <Alert tone="caution" title="Warnings">
          <ul style={{ margin: 0, paddingLeft: 'var(--space-6)' }}>
            {result.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Alert>
      ) : null}
      {rows.length > 0 ? <DataTable dense stickyHeader stickyFirstColumn rowKey="id" columns={columns} rows={rows} maxHeight="calc(100vh - 340px)" /> : null}
    </div>
  );
}
