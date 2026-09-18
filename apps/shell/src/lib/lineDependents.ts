import type { StatementSchema } from '../data';
import { collectRefIds } from './engine/resolve';

/** What deleting one or more schema lines (by id) would break — another line's formula
 *  referencing it, or a driver using it as a basis. Used both by StatementDefinitionsScreen (a
 *  shared template's own lines) and by ModelMappingScreen (a model's own private schema copy,
 *  including its dynamic child lines — segments, EBITDA adjustments, KPIs, debt tranches —
 *  which are now ordinary schema lines/drivers like any other, so this one check covers them
 *  too; there's no separate instance-basis concept anymore). `deletedLineIds` should hold every
 *  id being removed at once (e.g. a parent line and all its children together) so references
 *  between two lines both being deleted together are correctly excluded. */
export interface SchemaLineDependents {
  /** Other schema lines whose formula contains a `ref` to a deleted id. */
  formulaLines: { id: string; name: string }[];
  /** Drivers whose basisLineId is a deleted id. */
  driverBases: { id: string; name: string }[];
}

export function hasSchemaDependents(d: SchemaLineDependents): boolean {
  return d.formulaLines.length > 0 || d.driverBases.length > 0;
}

/** `deletedLineIds` should hold every id being removed at once (a whole section's lines, for a
 *  section delete) so references between two lines both being deleted together are correctly
 *  excluded, since a deleted line is never checked as someone else's dependent. */
export function findSchemaDependents(schema: StatementSchema, deletedLineIds: Set<string>): SchemaLineDependents {
  const formulaLines = schema.sections
    .flatMap((s) => s.lines)
    .filter((l) => !deletedLineIds.has(l.id) && l.formula && collectRefIds(l.formula).some((id) => deletedLineIds.has(id)))
    .map((l) => ({ id: l.id, name: l.name }));
  const driverBases = schema.drivers
    .filter((d) => d.basisLineId && deletedLineIds.has(d.basisLineId))
    .map((d) => ({ id: d.id, name: d.name }));
  return { formulaLines, driverBases };
}
