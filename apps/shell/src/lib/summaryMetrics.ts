import type { Model } from '../data';
import type { LineValues } from './computedCache';

/** Percent change vs. the prior period, for MetricCard's `delta` prop — null (no delta shown)
 *  when there's no prior period, or the prior value is null/zero (division would be meaningless).
 *  Generic over which period is "latest": SummaryPanel anchors this on the model's last ACTUAL
 *  period, while the workspace's Live output rail anchors it on the timeline's last period
 *  (actual or projected), since that's the one that actually moves as drivers are edited. */
export function periodOverPeriodDelta(result: LineValues, lineId: string, index: number): number | null {
  if (index <= 0) return null;
  const latest = result.getValue(lineId, index);
  const prior = result.getValue(lineId, index - 1);
  if (latest === null || prior === null || prior === 0) return null;
  return ((latest - prior) / Math.abs(prior)) * 100;
}

/** Full-timeline trend for a sparkline/chart series. LineChart and Sparkline both have no gap-
 *  rendering for a missing value, so a null is shown as 0 here — an accepted simplification, not
 *  a claim that 0 was actually mapped for that period. */
export function trend(result: LineValues, lineId: string, model: Pick<Model, 'timeline'>): number[] {
  return model.timeline.map((_, i) => result.getValue(lineId, i) ?? 0);
}
