import type { LineMapping, MatchMethod, StatementLine } from '../../../data';

type BadgeTone = 'neutral' | 'info' | 'positive' | 'negative' | 'caution' | 'brand';

export const MATCH_METHOD_META: Record<MatchMethod, { label: string; tone: BadgeTone; icon: string }> = {
  exact: { label: 'Exact', tone: 'positive', icon: 'check-circle-2' },
  alias: { label: 'Alias', tone: 'positive', icon: 'book-marked' },
  fuzzy: { label: 'Fuzzy', tone: 'neutral', icon: 'search' },
  ai: { label: 'AI', tone: 'info', icon: 'sparkles' },
  manual: { label: 'Manual', tone: 'brand', icon: 'pencil' },
  none: { label: 'Unmapped', tone: 'caution', icon: 'alert-triangle' },
};

export const REVIEW_THRESHOLD = 0.8;

export function formatPeriodValue(value: number | null): string {
  if (value === null) return '—';
  const abs = Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return (value < 0 ? '−' : '') + abs;
}

/** Low-confidence, not-yet-approved match — the purple dot / review filter condition. */
export function isLowConfidence(mapping: LineMapping | undefined): boolean {
  if (!mapping || mapping.approved) return false;
  if (mapping.method === 'manual' || mapping.method === 'none') return false;
  return mapping.confidence < REVIEW_THRESHOLD;
}

/** Required and still unmapped — the red dot / save-blocking condition. */
export function isMissingRequired(target: StatementLine, mapping: LineMapping | undefined): boolean {
  if (target.formula.trim()) return false; // calculated lines are never "missing"
  if (!target.required) return false;
  return !mapping || mapping.sourceLineIds.length === 0;
}

export function needsReview(target: StatementLine, mapping: LineMapping | undefined): boolean {
  return isMissingRequired(target, mapping) || isLowConfidence(mapping);
}
