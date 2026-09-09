import type { CSSProperties } from 'react';
import type { LineNumberFormat, LineRowFormat, LineSign, StatementLine } from '../../data';
import { isCalculated } from '../../lib/engine/resolve';

type BadgeTone = 'neutral' | 'info' | 'positive' | 'negative' | 'caution' | 'brand';

export const ROW_FORMAT_META: Record<LineRowFormat, { label: string; tone: BadgeTone }> = {
  normal: { label: 'Normal', tone: 'neutral' },
  total: { label: 'Total', tone: 'brand' },
  metric: { label: 'Metric', tone: 'info' },
};

export const NUMBER_FORMAT_META: Record<LineNumberFormat, { label: string; tone: BadgeTone }> = {
  number: { label: 'Number', tone: 'neutral' },
  percentage: { label: 'Percentage', tone: 'info' },
  multiple: { label: 'Multiple', tone: 'caution' },
};

export const SIGN_META: Record<LineSign, { label: string; tone: BadgeTone }> = {
  natural: { label: 'Natural', tone: 'neutral' },
  absolute: { label: 'Absolute', tone: 'caution' },
};

/** Required/Optional is a manual choice, overridden by "Calculated" only for a genuine
 *  structural formula (Gross Profit-style — never meant to be sourced). A line with a
 *  `projection` method is still normally-sourced (it needs a real mapped value for every actual
 *  period) even though it also carries a formula — that formula only ever governs its future
 *  periods, so it keeps showing Required/Optional rather than being folded into "Calculated". */
export function getRequiredMeta(line: StatementLine): { label: string; tone: BadgeTone } {
  if (isCalculated(line) && !line.projection) return { label: 'Calculated', tone: 'positive' };
  return line.required ? { label: 'Required', tone: 'caution' } : { label: 'Optional', tone: 'neutral' };
}

/** How a line renders in the actual statement preview, driven by its row format. */
export function getLineRowStyle(line: StatementLine): CSSProperties {
  if (line.rowFormat === 'total') {
    return {
      fontWeight: 'var(--weight-semibold)',
      background: 'var(--surface-sunken)',
      borderTop: '1px solid var(--border-default)',
    };
  }
  if (line.rowFormat === 'metric') {
    return {
      fontStyle: 'italic',
      color: 'var(--text-secondary)',
    };
  }
  return {};
}
