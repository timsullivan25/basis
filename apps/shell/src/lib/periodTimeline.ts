import type { ParsedPeriod, PeriodType, Timeline, TimelinePeriod } from '../data';

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

const MONTHS_PER_PERIOD: Record<PeriodType, number> = {
  FY: 12,
  'Semi-Annual': 6,
  Quarter: 3,
};

function parseISODate(s: string): { y: number; m: number } {
  const [y, m] = s.split('-').map(Number);
  return { y, m };
}

/** Adds `months` to a period-end date, always landing back on a month-end — period end dates
 *  are always the last day of their month, so this recomputes "last day of the target month"
 *  from scratch rather than shifting the original day-of-month, which would overflow for a
 *  31st landing on a shorter month (e.g. naively adding a month to Jan 31 lands on Mar 2-3). */
function addPeriodEnd(endDate: string, months: number): string {
  const { y, m } = parseISODate(endDate);
  const totalMonths = y * 12 + (m - 1) + months;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth = totalMonths % 12; // 0-indexed
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
}

function synthesizeLabel(type: PeriodType, endDate: string): string {
  const { y, m } = parseISODate(endDate);
  if (type === 'FY') return `FY ${y}`;
  if (type === 'Semi-Annual') return `${m <= 6 ? 'H1' : 'H2'} ${y}`;
  return `Q${Math.ceil(m / 3)} ${y}`;
}

/**
 * Appends `count` more periods continuing from the timeline's last entry, at that entry's
 * native frequency (no separate frequency choice — a model has one native frequency, per the
 * architecture contract). Each new period is `kind: 'projected'`. Continues correctly from a
 * timeline that already ends on a projected period, so extending twice just keeps going.
 */
export function extendTimeline(timeline: Timeline, count: number): Timeline {
  if (timeline.length === 0 || count <= 0) return timeline;
  const last = timeline[timeline.length - 1];
  const months = MONTHS_PER_PERIOD[last.type];

  const extended: TimelinePeriod[] = [];
  let endDate = last.endDate;
  for (let i = 0; i < count; i++) {
    endDate = addPeriodEnd(endDate, months);
    extended.push({
      id: `${last.type}:${endDate}`,
      type: last.type,
      endDate,
      label: synthesizeLabel(last.type, endDate),
      kind: 'projected',
    });
  }
  return [...timeline, ...extended];
}
