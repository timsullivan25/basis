import type { LineMapping, MatchMethod, StatementLine } from '../../../data';
import { isCalculated } from '../../../lib/engine/resolve';

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

/** Required and still unmapped — the red dot / save-blocking condition. A purely structural
 *  formula (no `projection`) is never "missing", same reasoning as getRequiredMeta — but a
 *  projection-carrying line still needs a real mapped value for its actual periods, the
 *  projection formula only ever covering periods without one. */
export function isMissingRequired(target: StatementLine, mapping: LineMapping | undefined): boolean {
  if (isCalculated(target) && !target.projection) return false;
  if (!target.required) return false;
  return !mapping || mapping.sourceLineIds.length === 0;
}

export function needsReview(target: StatementLine, mapping: LineMapping | undefined): boolean {
  return isMissingRequired(target, mapping) || isLowConfidence(mapping);
}
