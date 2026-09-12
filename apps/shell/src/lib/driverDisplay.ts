import type { ProjectionMethod } from '../data';
import type { LineValues } from './computedCache';

/** A read-only, derived "what would this driver have read as" number for a historical period.
 *  Historical periods never carry an explicit driverValues entry — only projected periods are
 *  ever written to (see ModelWorkspaceScreen's updateDriverValue) — so without this the Drivers
 *  table's historical columns would just be blank, giving no continuity into the projected
 *  assumptions that follow them.
 *
 *  Purely a display computation: it never writes to driverValues and changes nothing about what
 *  any period actually evaluates to — evaluateModel's own driverValue()/defaultDriverValue()
 *  logic (lib/engine/evaluate.ts) is untouched.
 *
 *  'actual' and 'roll-off' have no defined single-period ratio — an 'actual' driver IS a
 *  hardcoded absolute number with nothing to imply, and 'roll-off' anchors once to the last
 *  actual period rather than varying per period — so both simply return null, same as any other
 *  uncomputable cell. */
export function impliedHistoricalDriverValue(
  evaluation: LineValues,
  targetLineId: string,
  method: ProjectionMethod,
  basisLineId: string | undefined,
  periodIndex: number,
): number | null {
  if (method === 'growth') {
    if (periodIndex <= 0) return null;
    const curr = evaluation.getValue(targetLineId, periodIndex);
    const prev = evaluation.getValue(targetLineId, periodIndex - 1);
    if (curr === null || prev === null || prev === 0) return null;
    return (curr - prev) / Math.abs(prev);
  }
  if (method === 'percent-of' || method === 'days-of') {
    if (!basisLineId) return null;
    const target = evaluation.getValue(targetLineId, periodIndex);
    const basis = evaluation.getValue(basisLineId, periodIndex);
    if (target === null || basis === null || basis === 0) return null;
    const ratio = target / basis;
    return method === 'days-of' ? ratio * 365 : ratio;
  }
  return null;
}
