import type { DriverDefinition, LineRole, ProjectionMethod, StatementLine, StatementSchema } from '../data';
import { buildActualFormula, buildDaysFormula, buildFlatFormula, buildGrowthFormula, buildLinkFormula, buildRatioFormula } from './engine/resolve';
import { childrenOf, removeRollOffContra, setChildProjection } from './statementLineChildren';

// Roll-off/Actual are child-line-only projection methods (see instances/projectionMethod.tsx) —
// never selectable on a top-level line, so this map deliberately only covers the subset
// ProjectionSelection actually offers.
const PROJECTION_METHOD_UNIT: Record<Extract<ProjectionMethod, 'growth' | 'percent-of' | 'days-of'>, string> = {
  growth: '%',
  'percent-of': '%',
  'days-of': 'days',
};
/** Phrasing for an auto-generated driver name — distinct from a picker's option labels
 *  ("Percent of…") so the two can read naturally in their own contexts: a dropdown option vs.
 *  "Revenue % of Cost of Revenue" once a basis line is appended to it. */
const DRIVER_NAME_PHRASE: Record<'percent-of' | 'days-of', string> = {
  'percent-of': '% of',
  'days-of': 'Days of',
};

/** What the projection controls commit — mirrors StatementLine.projection, and carries a
 *  basisLineId only for the methods that need one ('link', the two ratio methods and roll-off).
 *  'formula' keeps whatever hand-written formula the line already has. 'actual' is Hardcode: a
 *  driver whose per-period values ARE the line's projected values. */
export type ProjectionSelection =
  | { method: 'flat' }
  | { method: 'growth' }
  | { method: 'percent-of' | 'days-of' | 'roll-off'; basisLineId: string }
  | { method: 'link'; basisLineId: string; flipSign?: boolean }
  | { method: 'formula' }
  | { method: 'actual' };

/** Pure, in-memory mutations of a schema's own structure (sections, lines, projections) — the
 *  template-builder counterpart to lib/statementLineChildren.ts's dynamic-child mutations. Every
 *  function here takes a whole schema and returns a new one; callers (StatementDefinitionsScreen,
 *  and the model workspace's schema-edit mode) hold the result as their own draft/local state and
 *  persist it on their own schedule (a manual Save button, or an eager debounced save) — this
 *  module has no opinion on when a mutation becomes durable. Dependency checks ("is anything
 *  still referencing what I'm about to delete?") stay a caller concern (see lib/lineDependents.ts)
 *  so a confirm-dialog flow can sit in front of the two removal functions here without this module
 *  needing to know about dialogs at all. */

export function findLine(schema: StatementSchema, lineId: string): StatementLine | undefined {
  for (const s of schema.sections) {
    const found = s.lines.find((l) => l.id === lineId);
    if (found) return found;
  }
  return undefined;
}

function moveWithinArray<T>(items: T[], index: number, direction: 'up' | 'down'): T[] {
  const target = direction === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= items.length) return items;
  const next = items.slice();
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** A new line is Required and carries forward flat — a sourced line always has a projection, so
 *  one can't be forgotten. */
function emptyLine(): StatementLine {
  const id = crypto.randomUUID();
  return {
    id,
    name: '',
    role: 'required',
    rowFormat: 'normal',
    numberFormat: 'number',
    sign: 'natural',
    aggregation: 'sum',
    formula: buildFlatFormula(id),
    projection: { method: 'flat' },
    aliases: [],
  };
}

export function addSection(schema: StatementSchema): StatementSchema {
  return { ...schema, sections: [...schema.sections, { id: crypto.randomUUID(), name: '', lines: [] }] };
}

export function renameSection(schema: StatementSchema, sectionId: string, name: string): StatementSchema {
  return { ...schema, sections: schema.sections.map((s) => (s.id === sectionId ? { ...s, name } : s)) };
}

export function setSectionAllowsFreeformLines(schema: StatementSchema, sectionId: string, next: boolean): StatementSchema {
  return { ...schema, sections: schema.sections.map((s) => (s.id === sectionId ? { ...s, allowsFreeformLines: next } : s)) };
}

export function moveSection(schema: StatementSchema, sectionId: string, direction: 'up' | 'down'): StatementSchema {
  return { ...schema, sections: moveWithinArray(schema.sections, schema.sections.findIndex((s) => s.id === sectionId), direction) };
}

/** Removes the section and every driver targeting one of its lines — the raw mutation only; call
 *  lib/lineDependents.ts first if you need to warn the user about what else references those
 *  lines. */
export function removeSection(schema: StatementSchema, sectionId: string): StatementSchema {
  const removed = schema.sections.find((s) => s.id === sectionId);
  const removedLineIds = new Set(removed?.lines.map((l) => l.id) ?? []);
  return {
    ...schema,
    sections: schema.sections.filter((s) => s.id !== sectionId),
    drivers: schema.drivers.filter((d) => !removedLineIds.has(d.targetLineId)),
  };
}

export function addLine(schema: StatementSchema, sectionId: string): StatementSchema {
  return { ...schema, sections: schema.sections.map((s) => (s.id === sectionId ? { ...s, lines: [...s.lines, emptyLine()] } : s)) };
}

export function updateLine(schema: StatementSchema, lineId: string, patch: Partial<StatementLine>): StatementSchema {
  // No rename cascade needed — formulas reference lines by resolved id (see
  // lib/engine/resolve.ts), so a rename here never touches anything that reads this line.
  return {
    ...schema,
    sections: schema.sections.map((s) => ({
      ...s,
      lines: s.lines.map((line) => (line.id === lineId ? { ...line, ...patch } : line)),
    })),
  };
}

/** The single entry point for a sourced line's projection controls — computes and writes both the
 *  line's formula and (for the driver-generating methods) a fresh DriverDefinition, replacing any
 *  driver this line previously had. A type change always discards the old driver rather than
 *  reinterpreting its per-model values under a new method's semantics, which would be silent and
 *  easy to get subtly wrong. Switching TO 'formula' keeps a hand-written formula that's already
 *  there but never a generated one (a flat/growth/link formula isn't the user's to inherit). */
export function setLineProjection(schema: StatementSchema, lineId: string, selection: ProjectionSelection): StatementSchema {
  // Roll-off has its own mechanism (a contra on the basis line — see statementLineChildren.ts's
  // applyRollOffContra), shared with sub-lines, which cleans up a previous roll-off itself.
  if (selection.method === 'roll-off') return setChildProjection(schema, lineId, selection);

  const line = findLine(schema, lineId);
  // Leaving a roll-off: take its contra back out of the basis line first.
  const existingDriverId = line?.projection && 'driverId' in line.projection ? line.projection.driverId : undefined;
  const rollOffBasisId =
    line?.projection?.method === 'roll-off' ? schema.drivers.find((d) => d.id === existingDriverId)?.basisLineId : undefined;
  const uncontra = rollOffBasisId ? removeRollOffContra(schema, lineId, rollOffBasisId) : schema;
  const remainingDrivers = existingDriverId ? uncontra.drivers.filter((d) => d.id !== existingDriverId) : uncontra.drivers;
  const base = { ...uncontra, drivers: remainingDrivers };

  if (selection.method === 'actual') {
    const driverId = crypto.randomUUID();
    const driver: DriverDefinition = { id: driverId, name: `${line?.name || 'Line'} Value`, unit: '', targetLineId: lineId, method: 'actual' };
    return updateLine({ ...base, drivers: [...remainingDrivers, driver] }, lineId, {
      formula: buildActualFormula(driverId),
      projection: { method: 'actual', driverId },
    });
  }
  if (selection.method === 'formula') {
    const keep = line?.projection?.method === 'formula' ? line.formula : null;
    return updateLine(base, lineId, { formula: keep, projection: { method: 'formula' } });
  }
  if (selection.method === 'link') {
    const flipSign = selection.flipSign === true;
    return updateLine(base, lineId, {
      formula: buildLinkFormula(selection.basisLineId, flipSign),
      projection: { method: 'link', basisLineId: selection.basisLineId, ...(flipSign ? { flipSign } : {}) },
    });
  }
  if (selection.method === 'flat') {
    return updateLine(base, lineId, { formula: buildFlatFormula(lineId), projection: { method: 'flat' } });
  }
  if (selection.method === 'growth') {
    const driverId = crypto.randomUUID();
    const driver: DriverDefinition = {
      id: driverId,
      name: `${line?.name || 'Line'} Growth Rate`,
      unit: PROJECTION_METHOD_UNIT.growth,
      targetLineId: lineId,
      method: 'growth',
    };
    return updateLine({ ...base, drivers: [...remainingDrivers, driver] }, lineId, {
      formula: buildGrowthFormula(lineId, driverId),
      projection: { method: 'growth', driverId },
    });
  }

  const driverId = crypto.randomUUID();
  const basisName = findLine(schema, selection.basisLineId)?.name || 'basis';
  const driver: DriverDefinition = {
    id: driverId,
    name: `${line?.name || 'Line'} ${DRIVER_NAME_PHRASE[selection.method as 'percent-of' | 'days-of']} ${basisName}`,
    unit: PROJECTION_METHOD_UNIT[selection.method as 'percent-of' | 'days-of'],
    targetLineId: lineId,
    method: selection.method,
    basisLineId: selection.basisLineId,
  };
  const formula =
    selection.method === 'days-of' ? buildDaysFormula(selection.basisLineId, driverId) : buildRatioFormula(selection.basisLineId, driverId);
  return updateLine({ ...base, drivers: [...remainingDrivers, driver] }, lineId, { formula, projection: { method: selection.method, driverId } });
}

/** Changes a line's role (the "Role" column). Required <-> Optional is just the flag. Moving
 *  to Calculated/Check drops the projection (and its driver) and any generated formula — one
 *  hand-written formula is all such a line has, and a hand-written one is kept — plus anything
 *  that only a sourced line can have (debt kind, sub-lines). Moving to Required/Optional gives
 *  the line a projection: its existing hand-written formula becomes a 'formula' projection, and
 *  a line with none starts on Flat. Refuses (returns the schema unchanged) to make a line with
 *  real sub-lines Calculated, since that would orphan them. */
export function setLineRole(schema: StatementSchema, lineId: string, role: LineRole): StatementSchema {
  const line = findLine(schema, lineId);
  if (!line || line.debtScheduleRole) return schema;
  const current = line.role;
  if (current === role) return schema;
  const nowSourced = current === 'required' || current === 'optional';
  const nextSourced = role === 'required' || role === 'optional';
  if (nowSourced && nextSourced) return updateLine(schema, lineId, { role });

  const existingDriverId = line.projection && 'driverId' in line.projection ? line.projection.driverId : undefined;
  const base = existingDriverId ? { ...schema, drivers: schema.drivers.filter((d) => d.id !== existingDriverId) } : schema;

  if (nextSourced) {
    // From Calculated/Check: keep the hand-written formula as the projection, else carry flat.
    return line.formula !== null
      ? updateLine(base, lineId, { role, projection: { method: 'formula' } })
      : updateLine(base, lineId, { role, formula: buildFlatFormula(lineId), projection: { method: 'flat' } });
  }

  if (childrenOf(schema, lineId).length > 0) return schema;
  const keepFormula = line.projection === null || line.projection.method === 'formula';
  return updateLine(base, lineId, {
    role,
    projection: null,
    formula: keepFormula ? line.formula : null,
    lineKind: undefined,
    debtProperties: undefined,
    allowsSubLines: false,
  });
}

/** Removes the line and its driver (if it had one) — the raw mutation only; call
 *  lib/lineDependents.ts first if you need to warn the user about what else references it. A
 *  roll-off line's contra on its basis line is taken back out first, so nothing is left
 *  subtracting a line that no longer exists. */
export function removeLine(schema: StatementSchema, sectionId: string, lineId: string): StatementSchema {
  const line = findLine(schema, lineId);
  const driverId = line?.projection && 'driverId' in line.projection ? line.projection.driverId : undefined;
  const rollOffBasisId = line?.projection?.method === 'roll-off' ? schema.drivers.find((d) => d.id === driverId)?.basisLineId : undefined;
  if (rollOffBasisId) schema = removeRollOffContra(schema, lineId, rollOffBasisId);
  return {
    ...schema,
    sections: schema.sections.map((s) => (s.id === sectionId ? { ...s, lines: s.lines.filter((line) => line.id !== lineId) } : s)),
    drivers: schema.drivers.filter((d) => d.targetLineId !== lineId),
  };
}

/** Drag-and-drop's one primitive, replacing the old moveLine (adjacent-swap, same section only)
 *  and moveLineToSection (cross-section, always appended to the end) — this supersedes both: a
 *  same-section drag to any position IS "reorder", and a cross-section drag IS "relocate", and
 *  both are just "this line now sits immediately before that one" from the DataTable's own drag
 *  event, regardless of which section either currently lives in. `beforeLineId: null` means "at
 *  the end of `toSectionId`"; an id not found in `toSectionId` (e.g. it's a child inside a
 *  different section) falls back to the end the same way, rather than silently dropping the
 *  line. No-ops if `lineId` isn't found anywhere — a stale drag payload shouldn't corrupt the
 *  schema. */
export function reorderLine(schema: StatementSchema, lineId: string, toSectionId: string, beforeLineId: string | null): StatementSchema {
  const fromSection = schema.sections.find((s) => s.lines.some((l) => l.id === lineId));
  const line = fromSection?.lines.find((l) => l.id === lineId);
  if (!line) return schema;
  return {
    ...schema,
    sections: schema.sections.map((s) => {
      if (s.id !== toSectionId) {
        return s.id === fromSection!.id ? { ...s, lines: s.lines.filter((l) => l.id !== lineId) } : s;
      }
      const withoutDragged = s.lines.filter((l) => l.id !== lineId);
      const insertAt = beforeLineId ? withoutDragged.findIndex((l) => l.id === beforeLineId) : -1;
      const idx = insertAt === -1 ? withoutDragged.length : insertAt;
      return { ...s, lines: [...withoutDragged.slice(0, idx), line, ...withoutDragged.slice(idx)] };
    }),
  };
}
