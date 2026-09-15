import type { DriverDefinition, ProjectionMethod, StatementLine, StatementSchema } from '../data';
import { buildDaysFormula, buildFlatFormula, buildGrowthFormula, buildRatioFormula } from './engine/resolve';

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

/** What the "Projection method" control commits — mirrors StatementLine.projection plus the
 *  'none' case, and carries a basisLineId only for the two methods that need one. */
export type ProjectionSelection =
  | { method: 'none' }
  | { method: 'flat' }
  | { method: 'growth' }
  | { method: 'percent-of' | 'days-of'; basisLineId: string };

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

function emptyLine(): StatementLine {
  return {
    id: crypto.randomUUID(),
    name: '',
    required: true,
    rowFormat: 'normal',
    numberFormat: 'number',
    sign: 'natural',
    aggregation: 'sum',
    formula: null,
    projection: null,
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

/** The single entry point for a top-level line's "Projection method" control — computes and
 *  writes both the line's formula and (for the four driver-generating methods) a fresh
 *  DriverDefinition, replacing any driver this line previously had. A method change always
 *  discards the old driver rather than reinterpreting its per-model values under a new method's
 *  semantics, which would be silent and easy to get subtly wrong. */
export function setLineProjection(schema: StatementSchema, lineId: string, selection: ProjectionSelection): StatementSchema {
  const line = findLine(schema, lineId);
  const existingDriverId = line?.projection && 'driverId' in line.projection ? line.projection.driverId : undefined;
  const remainingDrivers = existingDriverId ? schema.drivers.filter((d) => d.id !== existingDriverId) : schema.drivers;

  if (selection.method === 'none') {
    return updateLine({ ...schema, drivers: remainingDrivers }, lineId, { formula: null, projection: null });
  }
  if (selection.method === 'flat') {
    return updateLine({ ...schema, drivers: remainingDrivers }, lineId, { formula: buildFlatFormula(lineId), projection: { method: 'flat' } });
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
    return updateLine({ ...schema, drivers: [...remainingDrivers, driver] }, lineId, {
      formula: buildGrowthFormula(lineId, driverId),
      projection: { method: 'growth', driverId },
    });
  }

  const driverId = crypto.randomUUID();
  const basisName = findLine(schema, selection.basisLineId)?.name || 'basis';
  const driver: DriverDefinition = {
    id: driverId,
    name: `${line?.name || 'Line'} ${DRIVER_NAME_PHRASE[selection.method]} ${basisName}`,
    unit: PROJECTION_METHOD_UNIT[selection.method],
    targetLineId: lineId,
    method: selection.method,
    basisLineId: selection.basisLineId,
  };
  const formula =
    selection.method === 'days-of' ? buildDaysFormula(selection.basisLineId, driverId) : buildRatioFormula(selection.basisLineId, driverId);
  return updateLine({ ...schema, drivers: [...remainingDrivers, driver] }, lineId, { formula, projection: { method: selection.method, driverId } });
}

/** Removes the line and its driver (if it had one) — the raw mutation only; call
 *  lib/lineDependents.ts first if you need to warn the user about what else references it. */
export function removeLine(schema: StatementSchema, sectionId: string, lineId: string): StatementSchema {
  return {
    ...schema,
    sections: schema.sections.map((s) => (s.id === sectionId ? { ...s, lines: s.lines.filter((line) => line.id !== lineId) } : s)),
    drivers: schema.drivers.filter((d) => d.targetLineId !== lineId),
  };
}

export function moveLine(schema: StatementSchema, sectionId: string, lineId: string, direction: 'up' | 'down'): StatementSchema {
  return {
    ...schema,
    sections: schema.sections.map((s) =>
      s.id === sectionId ? { ...s, lines: moveWithinArray(s.lines, s.lines.findIndex((line) => line.id === lineId), direction) } : s,
    ),
  };
}

export function moveLineToSection(schema: StatementSchema, fromSectionId: string, lineId: string, toSectionId: string): StatementSchema {
  const fromSection = schema.sections.find((s) => s.id === fromSectionId);
  const line = fromSection?.lines.find((l) => l.id === lineId);
  if (!line) return schema;
  return {
    ...schema,
    sections: schema.sections.map((s) => {
      if (s.id === fromSectionId) return { ...s, lines: s.lines.filter((l) => l.id !== lineId) };
      if (s.id === toSectionId) return { ...s, lines: [...s.lines, line] };
      return s;
    }),
  };
}
