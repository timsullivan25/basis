import type { DriverDefinition, StatementLine, StatementSchema, StatementSchemaRepository, StatementSection } from './types';
import { openBasisDb } from './db';
import { createDefaultStatementSchema } from './defaultStatementSchema';
import { remapFormulaIds } from '../lib/engine/resolve';

/** Every line gets a fresh id on copy, recorded in `idMap` as it goes — formulas aren't
 *  touched here, since a line's formula can reference a line defined later in the schema and
 *  the full old-id -> new-id map needs to exist before any of them are remapped. */
function cloneSectionShallow(section: StatementSection, idMap: Map<string, string>): StatementSection {
  return {
    ...section,
    id: crypto.randomUUID(),
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
 *  formula's resolved refs (both ref.lineId and driverRef.driverId) to point at the copy's ids. */
function remapSectionFormulas(section: StatementSection, idMap: Map<string, string>): StatementSection {
  return {
    ...section,
    lines: section.lines.map((l) => ({ ...l, formula: l.formula ? remapFormulaIds(l.formula, idMap) : null })),
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

/** First StatementSchemaRepository adapter. Swap for an API-backed one later without touching callers. */
export class IndexedDbStatementSchemaRepository implements StatementSchemaRepository {
  async list(): Promise<StatementSchema[]> {
    const db = await openBasisDb();
    const existing = await db.getAllFromIndex('statementSchema', 'by-createdAt');
    if (existing.length > 0) return existing;

    // put (not add): concurrent calls on an empty store (e.g. two screens mounting at once)
    // all seed the same fixed id, so they converge on one row instead of racing to add duplicates.
    const seeded = createDefaultStatementSchema();
    await db.put('statementSchema', seeded);
    return [seeded];
  }

  async get(id: string): Promise<StatementSchema | undefined> {
    const db = await openBasisDb();
    return db.get('statementSchema', id);
  }

  async create(input: { name: string }): Promise<StatementSchema> {
    const db = await openBasisDb();
    const now = new Date().toISOString();
    const schema: StatementSchema = {
      id: crypto.randomUUID(),
      name: input.name,
      createdAt: now,
      updatedAt: now,
      sections: [],
      drivers: [],
    };
    await db.add('statementSchema', schema);
    return schema;
  }

  async duplicate(id: string, name: string): Promise<StatementSchema> {
    const db = await openBasisDb();
    const source = await db.get('statementSchema', id);
    if (!source) throw new Error(`Statement schema not found: ${id}`);

    const idMap = new Map<string, string>();
    const clonedSections = source.sections.map((s) => cloneSectionShallow(s, idMap));
    const clonedDrivers = cloneDriversShallow(source.drivers ?? [], idMap);
    const now = new Date().toISOString();
    const copy: StatementSchema = {
      id: crypto.randomUUID(),
      name,
      copiedFromSchemaId: source.id,
      createdAt: now,
      updatedAt: now,
      sections: clonedSections.map((s) => remapSectionFormulas(s, idMap)),
      drivers: remapDriverLineRefs(clonedDrivers, idMap),
    };
    await db.add('statementSchema', copy);
    return copy;
  }

  async save(schema: StatementSchema): Promise<StatementSchema> {
    const db = await openBasisDb();
    const updated: StatementSchema = { ...schema, updatedAt: new Date().toISOString() };
    await db.put('statementSchema', updated);
    return updated;
  }

  async remove(id: string): Promise<void> {
    const db = await openBasisDb();
    await db.delete('statementSchema', id);
  }
}
