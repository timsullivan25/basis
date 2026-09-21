import type { DriverDefinition, StatementLine } from '../data/types';
import { isFormulaOnly } from './lineRole';
import type { NameIndex } from './engine/resolve';

export interface ProjectionSummary {
  label: string;
  /** 'missing' is a sourced line with nothing to project it — the case this column exists to
   *  make visible. 'derived' is a projection that comes from elsewhere (sub-lines, the Debt
   *  Schedule) rather than a choice made on the line itself. */
  tone: 'normal' | 'derived' | 'missing';
}

/** A short, scannable description of how a line is projected, for the template table's read-only
 *  Projection column. `null` for a Calculated or Check line — one formula covers every period, so
 *  there's no projection to summarize. A basis line is named the way formulas name it (qualified
 *  only when another line shares its name — see NameIndex.describe). */
export function summarizeProjection(line: StatementLine, drivers: DriverDefinition[], nameIndex: NameIndex, isDebt = line.lineKind === 'debt'): ProjectionSummary | null {
  if (isFormulaOnly(line)) return null;

  const nameOf = (lineId: string | undefined): string => {
    const described = lineId ? nameIndex.describe(lineId) : undefined;
    return described ? (described.ambiguous ? described.qualifiedName : described.name) : '(missing line)';
  };

  const projection = line.projection;
  // A debt line (incl. a sub-line inheriting it from its parent) is fed by the Debt Schedule, so
  // any projection it still carries is unused.
  if (isDebt && projection !== null && !line.allowsSubLines) return { label: 'Debt schedule', tone: 'derived' };
  if (projection === null) {
    if (line.allowsSubLines) return { label: 'Sum of sub-lines', tone: 'derived' };
    if (line.lineKind === 'debt') return { label: 'Debt schedule', tone: 'derived' };
    return { label: 'Not set', tone: 'missing' };
  }

  switch (projection.method) {
    case 'flat':
      return { label: 'Flat', tone: 'normal' };
    case 'growth':
      return { label: 'Growth rate', tone: 'normal' };
    case 'percent-of':
    case 'days-of': {
      const basisLineId = drivers.find((d) => 'driverId' in projection && d.id === projection.driverId)?.basisLineId;
      return { label: `${projection.method === 'percent-of' ? '% of' : 'Days of'} ${nameOf(basisLineId)}`, tone: 'normal' };
    }
    case 'roll-off': {
      const basisLineId = drivers.find((d) => 'driverId' in projection && d.id === projection.driverId)?.basisLineId;
      return { label: `Rolls off to ${nameOf(basisLineId)}`, tone: 'normal' };
    }
    case 'hardcode':
      return { label: 'Hardcoded', tone: 'normal' };
    case 'link':
      return { label: `Linked to ${projection.flipSign ? '−' : ''}${nameOf(projection.basisLineId)}`, tone: 'normal' };
    case 'formula':
      return { label: 'Custom formula', tone: 'normal' };
  }
}
