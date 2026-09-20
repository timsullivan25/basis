import type { CSSProperties } from 'react';
import type { LineNumberFormat, LineRowFormat, LineSign, StatementLine } from '../../data';
import { lineRole } from '../../lib/lineRole';

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

/** The "Required" column's badge: the line's role (see lib/lineRole.ts). */
export function getRequiredMeta(line: StatementLine): { label: string; tone: BadgeTone } {
  switch (lineRole(line)) {
    case 'calculated':
      return { label: 'Calculated', tone: 'positive' };
    case 'check':
      return { label: 'Check', tone: 'info' };
    case 'required':
      return { label: 'Required', tone: 'caution' };
    case 'optional':
      return { label: 'Optional', tone: 'neutral' };
  }
}

/** Applied when a Check line sets no checkTolerance of its own. */
export const DEFAULT_CHECK_TOLERANCE = 0.001;

/** 'unknown' means "not yet computable" (e.g. the first period, with no prior period to diff
 *  against, or a divide-by-zero guard upstream returning null) — never a failure. Only
 *  meaningful for a Check line; every other line is always 'unknown'. */
export type CheckStatus = 'pass' | 'fail' | 'unknown';
export function getCheckStatus(line: StatementLine, value: number | null): CheckStatus {
  if (lineRole(line) !== 'check' || value === null) return 'unknown';
  return Math.abs(value) > (line.checkTolerance ?? DEFAULT_CHECK_TOLERANCE) ? 'fail' : 'pass';
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
