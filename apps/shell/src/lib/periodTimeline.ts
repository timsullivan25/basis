import type { ParsedPeriod, Timeline } from '../data';

/**
 * Turns parsed workbook periods into a stable timeline. The id is derived from type + date
 * (not array position) so it survives re-parses of the same workbook — a prerequisite for
 * historicals resolved at one point in time to still line up if the file is re-parsed later.
 */
export function buildTimeline(periods: ParsedPeriod[]): Timeline {
  return periods.map((period) => ({
    id: `${period.type}:${period.date}`,
    type: period.type,
    endDate: period.date,
    label: period.name,
    kind: 'actual',
  }));
}
