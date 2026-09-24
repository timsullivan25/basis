import type { LineMapping, LineNumberFormat, MatchMethod, StatementLine } from '../../../data';

type BadgeTone = 'neutral' | 'info' | 'positive' | 'negative' | 'caution' | 'brand';

export const MATCH_METHOD_META: Record<MatchMethod, { label: string; tone: BadgeTone; icon: string }> = {
  exact: { label: 'Exact', tone: 'positive', icon: 'check-circle-2' },
  alias: { label: 'Alias', tone: 'positive', icon: 'book-marked' },
  prior: { label: 'Prior', tone: 'info', icon: 'history' },
  fuzzy: { label: 'Fuzzy', tone: 'neutral', icon: 'search' },
  ai: { label: 'AI', tone: 'info', icon: 'sparkles' },
  manual: { label: 'Manual', tone: 'brand', icon: 'pencil' },
  none: { label: 'Unmapped', tone: 'caution', icon: 'alert-triangle' },
};

export const REVIEW_THRESHOLD = 0.8;

/** Renders per the line's numberFormat — 'percentage' scales by 100 and appends "%", 'multiple'
 *  appends "x"; plain 'number' (the default) is unchanged from before this had a format at all. */
export function formatPeriodValue(value: number | null, numberFormat: LineNumberFormat = 'number'): string {
  if (value === null) return '—';
  const scaled = numberFormat === 'percentage' ? value * 100 : value;
  const abs = Math.abs(scaled).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const suffix = numberFormat === 'percentage' ? '%' : numberFormat === 'multiple' ? 'x' : '';
  return (scaled < 0 ? '−' : '') + abs + suffix;
}

/** Low-confidence, not-yet-approved match — the purple dot / review filter condition. */
export function isLowConfidence(mapping: LineMapping | undefined): boolean {
  if (!mapping || mapping.approved) return false;
  if (mapping.method === 'manual' || mapping.method === 'none') return false;
  return mapping.confidence < REVIEW_THRESHOLD;
}

/** Several source lines matched equally well and the user hasn't chosen or approved one — the "pick the right one" flag. */
export function isAmbiguous(mapping: LineMapping | undefined): boolean {
  if (!mapping || mapping.approved) return false;
  if (mapping.method === 'manual' || mapping.method === 'none') return false;
  return (mapping.alternativeSourceLineIds?.length ?? 0) > 0;
}

/** Required and still unmapped — the red dot / save-blocking condition. Only a line whose role is
 *  Required can be missing: Optional, Calculated and Check lines never are. A parent that sums
 *  real sub-lines (`hasChildren`) isn't either — its own mapping is inactive while they exist. */
export function isMissingRequired(target: StatementLine, mapping: LineMapping | undefined, hasChildren = false): boolean {
  if (hasChildren || target.role !== 'required') return false;
  return !mapping || mapping.sourceLineIds.length === 0;
}

export function needsReview(target: StatementLine, mapping: LineMapping | undefined, hasChildren = false): boolean {
  return isMissingRequired(target, mapping, hasChildren) || isLowConfidence(mapping) || isAmbiguous(mapping);
}
