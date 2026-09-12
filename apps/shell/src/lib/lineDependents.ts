import type { LineInstance, StatementSchema } from '../data';
import { collectRefIds } from './engine/resolve';

/** What deleting one or more schema lines (by id) would break, entirely within the statement
 *  definition itself — no repository access, safe to call on every keystroke. Deliberately
 *  doesn't look at any company's mapping/model data: a saved model's schema choice is locked,
 *  and what a specific model's own mapping depends on is that mapping's own concern (see
 *  findInstanceBasisDependents, used from the mapping screen instead). */
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

/** What deleting one sub-line instance would break within its own model — a sibling instance
 *  using it as a projection basis. Synchronous, scoped to one already-known instance list (e.g.
 *  the mapping screen's in-progress `editableInstances`) — no repository access needed, since
 *  this is entirely local to the model being edited. */
export interface InstanceBasisDependents {
  dependentNames: string[];
}

export function hasInstanceBasisDependents(d: InstanceBasisDependents): boolean {
  return d.dependentNames.length > 0;
}

export function findInstanceBasisDependents(
  instances: Pick<LineInstance, 'id' | 'name' | 'projection'>[],
  deletedId: string,
): InstanceBasisDependents {
  const dependentNames = instances
    .filter((i) => i.id !== deletedId && 'basisLineId' in i.projection && i.projection.basisLineId === deletedId)
    .map((i) => i.name);
  return { dependentNames };
}
