import type { DriverDefinition, StatementLine, StatementSchema, StatementSection } from '../data/types';
import { remapFormulaIds } from './engine/resolve';

/** Every section AND line gets a fresh id on copy, all recorded in `idMap` as it goes —
 *  formulas aren't touched here, since a line's formula can reference a line defined later in
 *  the schema and the full old-id -> new-id map needs to exist before any of them are remapped.
 *  The section's own id is recorded too, not just its lines'. */
function cloneSectionShallow(section: StatementSection, idMap: Map<string, string>): StatementSection {
  const newSectionId = crypto.randomUUID();
  idMap.set(section.id, newSectionId);
  return {
    ...section,
    id: newSectionId,
    lines: section.lines.map((l): StatementLine => {
      const newId = crypto.randomUUID();
      idMap.set(l.id, newId);
      return { ...l, id: newId };
    }),
  };
}

/** Same idea as cloneSectionShallow, for drivers — every driver gets a fresh id too, recorded
 *  into the SAME idMap (line ids and driver ids are separate uuid pools, so one combined map
 *  is safe), since a driverRef inside some line's formula needs it remapped alongside line refs. */
function cloneDriversShallow(drivers: DriverDefinition[], idMap: Map<string, string>): DriverDefinition[] {
  return drivers.map((d): DriverDefinition => {
    const newId = crypto.randomUUID();
    idMap.set(d.id, newId);
    return { ...d, id: newId };
  });
}

/** Second pass, once every line AND driver in the copy has its final id — rewrites each
 *  formula's resolved refs (both ref.lineId and driverRef.driverId) to point at the copy's ids,
 *  and a line's own parentLineId (a line-id reference like any other, just not inside a formula
 *  tree, so remapFormulaIds doesn't touch it). */
function remapSectionFormulas(section: StatementSection, idMap: Map<string, string>): StatementSection {
  return {
    ...section,
    lines: section.lines.map((l) => ({
      ...l,
      formula: l.formula ? remapFormulaIds(l.formula, idMap) : null,
      parentLineId: l.parentLineId ? (idMap.get(l.parentLineId) ?? l.parentLineId) : undefined,
    })),
  };
}

/** A DriverDefinition's own targetLineId/basisLineId aren't inside a ResolvedFormula tree, so
 *  remapFormulaIds doesn't touch them — rewritten here through the same idMap instead. */
function remapDriverLineRefs(drivers: DriverDefinition[], idMap: Map<string, string>): DriverDefinition[] {
  return drivers.map((d) => ({
    ...d,
    targetLineId: idMap.get(d.targetLineId) ?? d.targetLineId,
    basisLineId: d.basisLineId ? (idMap.get(d.basisLineId) ?? d.basisLineId) : undefined,
  }));
}

/** Pure, in-memory structural clone of a schema — every section/line/driver id regenerated in
 *  the source's own order, every formula/driver/parentLineId reference remapped onto the copy.
 *  No IndexedDB access, no side effects — the caller decides whether and when to persist the
 *  result. Shared by StatementSchemaRepository.duplicate() (persists immediately, for an
 *  explicit "Duplicate" action in the template library) and by ModelMappingScreen (holds the
 *  result as an in-memory draft, mutating it further as tranches/segments/KPIs are added, and
 *  persisting only once, at Save) — a new model's schema is real and final from the moment a
 *  template is chosen, never a temporary id space needing its own remap pass later. */
export function cloneStatementSchemaStructure(
  source: StatementSchema,
  newId: string,
  name: string,
): { schema: StatementSchema; idMap: Map<string, string> } {
  const idMap = new Map<string, string>();
  const clonedSections = source.sections.map((s) => cloneSectionShallow(s, idMap));
  const clonedDrivers = cloneDriversShallow(source.drivers ?? [], idMap);
  const now = new Date().toISOString();
  const schema: StatementSchema = {
    id: newId,
    name,
    copiedFromSchemaId: source.id,
    createdAt: now,
    updatedAt: now,
    sections: clonedSections.map((s) => remapSectionFormulas(s, idMap)),
    drivers: remapDriverLineRefs(clonedDrivers, idMap),
    ...(source.conceptLineIds
      ? {
          conceptLineIds: Object.fromEntries(
            Object.entries(source.conceptLineIds).map(([concept, lineId]) => [concept, idMap.get(lineId) ?? lineId]),
          ),
        }
      : {}),
  };
  return { schema, idMap };
}
