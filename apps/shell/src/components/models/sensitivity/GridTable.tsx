import type { LineNumberFormat } from '../../../data';
import type { CasePoint, GridRun } from '../../../lib/sensitivity';
import { formatPeriodValue } from '../mapping/mappingFormatting';

export interface GridAxis {
  label: string;
  /** Each step's input value and shift, preformatted, e.g. "8.0%" and "+2 pp". */
  steps: Array<{ value: string; shift: string }>;
}

const mono = { fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', fontVariantNumeric: 'var(--numeric-tabular)' } as const;
const cellPad = 'var(--space-3) var(--space-5)';

/**
 * The classic two-way data table: one input down the rows, the other across the columns, the
 * output in every cell. The starting-case cell (both shifts 0) is outlined. Cells are shaded by
 * how far they sit from the starting case, in one neutral hue, since whether higher is better
 * depends on the output.
 */
export function GridTable({
  grid,
  read,
  numberFormat,
  rowAxis,
  colAxis,
}: {
  grid: GridRun;
  read: (point: CasePoint) => number | null;
  numberFormat: LineNumberFormat;
  rowAxis: GridAxis;
  colAxis: GridAxis;
}) {
  const values = grid.cells.map((row) => row.map(read));
  const baseRow = grid.rowShifts.indexOf(0);
  const baseCol = grid.colShifts.indexOf(0);
  const base = baseRow >= 0 && baseCol >= 0 ? values[baseRow][baseCol] : null;
  const reach = Math.max(0, ...values.flat().filter((v): v is number => v !== null && base !== null).map((v) => Math.abs(v - base!)));

  function shade(value: number | null): string | undefined {
    if (value === null || base === null || reach === 0) return undefined;
    const pct = Math.round((Math.abs(value - base) / reach) * 28);
    return pct === 0 ? undefined : `color-mix(in srgb, var(--chart-1) ${pct}%, transparent)`;
  }

  const headStyle = {
    padding: cellPad, background: 'var(--surface-table-head)', borderBottom: '1px solid var(--border-default)',
    fontSize: 'var(--text-2xs)', color: 'var(--text-tertiary)', textAlign: 'right' as const, whiteSpace: 'nowrap' as const,
  };

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr>
            <th style={{ ...headStyle, textAlign: 'left' }}>
              <span style={{ color: 'var(--text-secondary)' }}>{rowAxis.label}</span> ↓ · <span style={{ color: 'var(--text-secondary)' }}>{colAxis.label}</span> →
            </th>
            {colAxis.steps.map((step, c) => (
              <th key={c} style={headStyle}>
                <div style={{ ...mono, color: 'var(--text-primary)', fontWeight: c === baseCol ? 'var(--weight-semibold)' : undefined }}>{step.value}</div>
                <div>{step.shift}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {values.map((row, r) => (
            <tr key={r}>
              <td style={{ padding: cellPad, borderBottom: '1px solid var(--border-subtle)', fontSize: 'var(--text-2xs)', color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>
                <span style={{ ...mono, color: 'var(--text-primary)', fontWeight: r === baseRow ? 'var(--weight-semibold)' : undefined, marginRight: 'var(--space-3)' }}>
                  {rowAxis.steps[r]?.value}
                </span>
                {rowAxis.steps[r]?.shift}
              </td>
              {row.map((value, c) => {
                const isBase = r === baseRow && c === baseCol;
                return (
                  <td
                    key={c}
                    style={{
                      ...mono, padding: cellPad, textAlign: 'right', borderBottom: '1px solid var(--border-subtle)',
                      background: shade(value), color: value === null ? 'var(--text-disabled)' : 'var(--text-body)',
                      fontWeight: isBase ? 'var(--weight-semibold)' : undefined,
                      outline: isBase ? '2px solid var(--text-primary)' : undefined, outlineOffset: -2,
                    }}
                  >
                    {formatPeriodValue(value, numberFormat)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
