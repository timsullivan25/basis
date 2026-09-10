import { describe, expect, it } from 'vitest';
import { extendTimeline } from './periodTimeline';
import type { Timeline, TimelinePeriod } from '../data';

function period(type: TimelinePeriod['type'], endDate: string, kind: TimelinePeriod['kind'] = 'actual'): TimelinePeriod {
  return { id: `${type}:${endDate}`, type, endDate, label: endDate, kind };
}

describe('extendTimeline', () => {
  it('extends an FY timeline, one year per period, all projected', () => {
    const timeline: Timeline = [period('FY', '2024-12-31'), period('FY', '2025-12-31')];
    const extended = extendTimeline(timeline, 2);
    expect(extended).toHaveLength(4);
    expect(extended[2]).toEqual({ id: 'FY:2026-12-31', type: 'FY', endDate: '2026-12-31', label: 'FY 2026', kind: 'projected' });
    expect(extended[3]).toEqual({ id: 'FY:2027-12-31', type: 'FY', endDate: '2027-12-31', label: 'FY 2027', kind: 'projected' });
  });

  it('extends a Quarter timeline, three months per period, wrapping into the next year', () => {
    const timeline: Timeline = [period('Quarter', '2026-09-30')];
    const extended = extendTimeline(timeline, 3);
    expect(extended.slice(1)).toEqual([
      { id: 'Quarter:2026-12-31', type: 'Quarter', endDate: '2026-12-31', label: 'Q4 2026', kind: 'projected' },
      { id: 'Quarter:2027-03-31', type: 'Quarter', endDate: '2027-03-31', label: 'Q1 2027', kind: 'projected' },
      { id: 'Quarter:2027-06-30', type: 'Quarter', endDate: '2027-06-30', label: 'Q2 2027', kind: 'projected' },
    ]);
  });

  it('extends a Semi-Annual timeline, six months per period', () => {
    const timeline: Timeline = [period('Semi-Annual', '2026-06-30')];
    const extended = extendTimeline(timeline, 2);
    expect(extended.slice(1)).toEqual([
      { id: 'Semi-Annual:2026-12-31', type: 'Semi-Annual', endDate: '2026-12-31', label: 'H2 2026', kind: 'projected' },
      { id: 'Semi-Annual:2027-06-30', type: 'Semi-Annual', endDate: '2027-06-30', label: 'H1 2027', kind: 'projected' },
    ]);
  });

  it('lands back on a month-end even when the target month is shorter', () => {
    // Jan 31 + one quarter (3 months) -> April, which only has 30 days.
    const timeline: Timeline = [period('Quarter', '2026-01-31')];
    const extended = extendTimeline(timeline, 1);
    expect(extended[1].endDate).toBe('2026-04-30');
  });

  it('continues correctly from a timeline that already ends on a projected period', () => {
    const timeline: Timeline = [period('FY', '2024-12-31')];
    const oncePastActuals = extendTimeline(timeline, 1);
    const twiceExtended = extendTimeline(oncePastActuals, 1);
    expect(twiceExtended.map((p) => p.endDate)).toEqual(['2024-12-31', '2025-12-31', '2026-12-31']);
    expect(twiceExtended.every((p, i) => (i === 0 ? p.kind === 'actual' : p.kind === 'projected'))).toBe(true);
  });

  it('is a no-op for count <= 0 or an empty timeline', () => {
    const timeline: Timeline = [period('FY', '2024-12-31')];
    expect(extendTimeline(timeline, 0)).toEqual(timeline);
    expect(extendTimeline(timeline, -1)).toEqual(timeline);
    expect(extendTimeline([], 3)).toEqual([]);
  });
});
