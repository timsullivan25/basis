import type { DriverDefinition, ProjectionMethod, ResolvedFormula, StatementLine, StatementSchema } from '../data/types';
import {
  buildActualFormula,
  buildDaysFormula,
  buildFlatFormula,
  buildGrowthFormula,
  buildRatioFormula,
  buildRollOffFormula,
} from './engine/resolve';

/** Pure, in-memory mutations of a schema's dynamic child lines (segments, EBITDA adjustments,
 *  KPIs, debt tranches) — the replacement for the old LineInstance entity + withDynamicInstances
 *  splice/rollup mechanism. A child is now an ordinary StatementLine living directly in the
 *  schema, distinguished only by `parentLineId` (or, for a freeform/KPI line, simply by living
 *  in a section whose allowsFreeformLines is true, same as any other line there) — no coupling to
 *  models specifically, so a template can define default child lines too (see
 *  SchemaStructureEditor.tsx's own "+ Add sub-line", used by both the template builder and the
 *  model workspace's Edit-schema mode). Every function here takes a whole schema and returns a
 *  new one; each caller decides its own persistence — a manual Save (the template builder), a
 *  debounced eager save (an existing model's Edit-schema mode), or nothing until the mapping
 *  screen's own Save for a brand-new import (see ModelMappingScreen.tsx's changeSchema). */

function findLine(schema: StatementSchema, lineId: string): StatementLine | undefined {
  for (const s of schema.sections) {
    const found = s.lines.find((l) => l.id === lineId);
    if (found) return found;
  }
  return undefined;
}

function mapLines(schema: StatementSchema, fn: (line: StatementLine) => StatementLine): StatementSchema {
  return { ...schema, sections: schema.sections.map((s) => ({ ...s, lines: s.lines.map(fn) })) };
}

/** Every line under `parentLineId`, in schema order. */
export function childrenOf(schema: StatementSchema, parentLineId: string): StatementLine[] {
  return schema.sections.flatMap((s) => s.lines).filter((l) => l.parentLineId === parentLineId);
}

/** A child's effective kind is always its parent's, walked live off the schema — never
 *  independently stored on the child (see StatementLine.lineKind's own doc comment), so it can
 *  never drift out of sync with the parent. */
export function effectiveLineKind(schema: StatementSchema, line: StatementLine): 'debt' | 'check' | undefined {
  if (!line.parentLineId) return line.lineKind;
  const parent = findLine(schema, line.parentLineId);
  return parent ? effectiveLineKind(schema, parent) : undefined;
}

/** Rebuilds a parent's own formula from its CURRENT children — sum(child1, child2, ...), or
 *  back to no formula at all once the last child is removed. Every allowsSubLines line in this
 *  schema starts out formula-less, so there's no real case here of a parent whose ORIGINAL
 *  hand-authored formula needs preserving underneath the rollup — unlike a roll-off contra
 *  (see applyRollOffContra), which does need that. Reused every time a child is added or removed. */
export function regenerateParentSumFormula(schema: StatementSchema, parentLineId: string): StatementSchema {
  const children = childrenOf(schema, parentLineId);
  const formula: ResolvedFormula | null =
    children.length > 0
      ? { kind: 'call', fn: 'sum', args: children.map((c): ResolvedFormula => ({ kind: 'ref', lineId: c.id })) }
      : null;
  return mapLines(schema, (l) => (l.id === parentLineId ? { ...l, formula } : l));
}

/** Appends a brand-new child line — either rolling up into `parentLineId` (a tranche, a segment,
 *  an EBITDA adjustment) or freestanding under `sectionId` (a KPI); exactly one of the two,
 *  mirroring the old LineInstance's "exactly one of lineId/sectionId" convention. Defaults to a
 *  flat carry-forward, same as any newly-created line/instance always has in this app. */
export function addChildLine(
  schema: StatementSchema,
  target: { kind: 'line'; parentLineId: string } | { kind: 'section'; sectionId: string },
  name: string,
): { schema: StatementSchema; lineId: string } {
  const newId = crypto.randomUUID();
  const newLine: StatementLine = {
    id: newId,
    name,
    role: 'optional',
    rowFormat: 'normal',
    numberFormat: 'number',
    sign: 'natural',
    aggregation: 'sum',
    formula: buildFlatFormula(newId),
    projection: { method: 'flat' },
    aliases: [],
    parentLineId: target.kind === 'line' ? target.parentLineId : undefined,
  };

  if (target.kind === 'section') {
    return {
      schema: {
        ...schema,
        sections: schema.sections.map((s) => (s.id === target.sectionId ? { ...s, lines: [...s.lines, newLine] } : s)),
      },
      lineId: newId,
    };
  }

  // Insert right after the parent's LAST existing child (or right after the parent itself if it
  // has none yet), preserving creation order — mirrors withDynamicInstances.ts's old
  // insertedCountByParentId bookkeeping, now just an array splice since children are real lines.
  let inserted = {
    ...schema,
    sections: schema.sections.map((s) => {
      const parentIndex = s.lines.findIndex((l) => l.id === target.parentLineId);
      if (parentIndex === -1) return s;
      let insertAt = parentIndex + 1;
      while (insertAt < s.lines.length && s.lines[insertAt].parentLineId === target.parentLineId) insertAt += 1;
      const lines = [...s.lines];
      lines.splice(insertAt, 0, newLine);
      return { ...s, lines };
    }),
  };
  inserted = regenerateParentSumFormula(inserted, target.parentLineId);
  return { schema: inserted, lineId: newId };
}

/** Removes a child line and cleans up everything that could reference it: the parent's rollup
 *  formula (regenerated), its own driver (if any), any OTHER line whose driver uses it as a
 *  percent-of/days-of/roll-off basis (falls back to flat, same treatment the old
 *  findInstanceBasisDependents/commitInstanceDelete gave a sibling instance), and its roll-off
 *  contra on whatever basis line it was rolling off onto, if it was a roll-off child. Callers
 *  should check findSchemaDependents({...schema}, new Set([lineId])) first and confirm with the
 *  user when something depends on it, the same way StatementDefinitionsScreen's
 *  requestLineRemoval/commitLineRemoval split already works — this function itself always
 *  proceeds unconditionally. */
export function removeChildLine(schema: StatementSchema, lineId: string): StatementSchema {
  const line = findLine(schema, lineId);
  if (!line) return schema;

  let next = schema;
  const ownDriverId = line.projection && 'driverId' in line.projection ? line.projection.driverId : undefined;

  if (line.projection?.method === 'roll-off' && ownDriverId) {
    const driver = next.drivers.find((d) => d.id === ownDriverId);
    if (driver?.basisLineId) next = removeRollOffContra(next, lineId, driver.basisLineId);
  }

  // Any OTHER line whose driver uses this one as a basis falls back to flat.
  const fallenBackIds = new Set(
    next.drivers.filter((d) => d.basisLineId === lineId).map((d) => d.targetLineId),
  );
  next = mapLines(next, (l) => (fallenBackIds.has(l.id) ? { ...l, formula: buildFlatFormula(l.id), projection: { method: 'flat' } } : l));
  next = { ...next, drivers: next.drivers.filter((d) => d.basisLineId !== lineId) };

  // This line's own driver (if any) is now orphaned too.
  if (ownDriverId) {
    next = { ...next, drivers: next.drivers.filter((d) => d.id !== ownDriverId) };
  }

  next = { ...next, sections: next.sections.map((s) => ({ ...s, lines: s.lines.filter((l) => l.id !== lineId) })) };

  if (line.parentLineId) next = regenerateParentSumFormula(next, line.parentLineId);
  return next;
}

/** Structural check for "this formula is already a roll-off contra wrapper" — a plain
 *  subtraction of a sum() over roll-off children, wrapping whatever formula was there before.
 *  Non-destructive by construction: the wrapped `left` is set once, on first wrap, and never
 *  touched again — only the `right` sum's own argument list ever changes as roll-off children
 *  are added or removed. */
function asRollOffWrapper(
  formula: ResolvedFormula | null,
): { kind: 'bin'; op: '-'; left: ResolvedFormula; right: { kind: 'call'; fn: 'sum'; args: ResolvedFormula[] } } | null {
  if (
    formula !== null &&
    formula.kind === 'bin' &&
    formula.op === '-' &&
    formula.right.kind === 'call' &&
    formula.right.fn === 'sum'
  ) {
    return formula as { kind: 'bin'; op: '-'; left: ResolvedFormula; right: { kind: 'call'; fn: 'sum'; args: ResolvedFormula[] } };
  }
  return null;
}

/** Adds (or extends) a roll-off contra on `basisLineId` for `childLineId`. A basis line with no
 *  formula at all (a plain directly-mapped line with nothing computed for projected periods)
 *  has nothing to wrap — roll-off against it simply can't apply to projected periods, same
 *  limitation as before this change. */
export function applyRollOffContra(schema: StatementSchema, childLineId: string, basisLineId: string): StatementSchema {
  return mapLines(schema, (l) => {
    if (l.id !== basisLineId || l.formula === null) return l;
    const wrapper = asRollOffWrapper(l.formula);
    const childRef: ResolvedFormula = { kind: 'ref', lineId: childLineId };
    if (wrapper) {
      return { ...l, formula: { ...wrapper, right: { ...wrapper.right, args: [...wrapper.right.args, childRef] } } };
    }
    return { ...l, formula: { kind: 'bin', op: '-', left: l.formula, right: { kind: 'call', fn: 'sum', args: [childRef] } } };
  });
}

/** Removes `childLineId`'s ref from `basisLineId`'s roll-off contra sum — shrinking the sum's
 *  args, or fully unwrapping back to the original (pre-roll-off) formula once the last one is
 *  removed. */
export function removeRollOffContra(schema: StatementSchema, childLineId: string, basisLineId: string): StatementSchema {
  return mapLines(schema, (l) => {
    const wrapper = asRollOffWrapper(l.formula);
    if (l.id !== basisLineId || !wrapper) return l;
    const remainingArgs = wrapper.right.args.filter((a) => !(a.kind === 'ref' && a.lineId === childLineId));
    if (remainingArgs.length === 0) return { ...l, formula: wrapper.left };
    return { ...l, formula: { ...wrapper, right: { ...wrapper.right, args: remainingArgs } } };
  });
}

export type ChildProjectionSelection =
  | { method: 'flat' }
  | { method: 'growth' }
  | { method: 'actual' }
  | { method: 'percent-of' | 'days-of' | 'roll-off'; basisLineId: string };

const DRIVER_UNIT: Record<Exclude<ProjectionMethod, 'flat'>, string> = {
  growth: '%',
  'percent-of': '%',
  'days-of': 'days',
  'roll-off': '%',
  actual: '',
};

/** The single entry point for changing a child line's projection method — computes and writes
 *  both the line's formula and (for every method but 'flat') a fresh DriverDefinition,
 *  replacing any driver this line previously had, exactly mirroring
 *  StatementDefinitionsScreen's setLineProjection for an ordinary schema line (children are
 *  ordinary lines now, so the same construction applies uniformly). Cleans up the old roll-off
 *  contra first if the method is changing away from (or the basis is changing away from under)
 *  a roll-off. */
export function setChildProjection(schema: StatementSchema, lineId: string, selection: ChildProjectionSelection): StatementSchema {
  const line = findLine(schema, lineId);
  if (!line) return schema;
  const existingDriverId = line.projection && 'driverId' in line.projection ? line.projection.driverId : undefined;
  const existingDriver = existingDriverId ? schema.drivers.find((d) => d.id === existingDriverId) : undefined;

  let next = schema;
  if (line.projection?.method === 'roll-off' && existingDriver?.basisLineId) {
    next = removeRollOffContra(next, lineId, existingDriver.basisLineId);
  }
  if (existingDriverId) next = { ...next, drivers: next.drivers.filter((d) => d.id !== existingDriverId) };

  if (selection.method === 'flat') {
    return mapLines(next, (l) => (l.id === lineId ? { ...l, formula: buildFlatFormula(lineId), projection: { method: 'flat' } } : l));
  }

  const driverId = crypto.randomUUID();
  if (selection.method === 'growth' || selection.method === 'actual') {
    const driver: DriverDefinition = {
      id: driverId,
      name: `${line.name || 'Line'} ${selection.method === 'growth' ? 'Growth Rate' : 'Value'}`,
      unit: DRIVER_UNIT[selection.method],
      targetLineId: lineId,
      method: selection.method,
    };
    next = { ...next, drivers: [...next.drivers, driver] };
    const formula = selection.method === 'growth' ? buildGrowthFormula(lineId, driverId) : buildActualFormula(driverId);
    return mapLines(next, (l) => (l.id === lineId ? { ...l, formula, projection: { method: selection.method, driverId } } : l));
  }

  // percent-of / days-of / roll-off — all carry a basisLineId, on the driver (not the line).
  const basisName = findLine(next, selection.basisLineId)?.name ?? 'basis';
  const methodLabel = selection.method === 'percent-of' ? '% of' : selection.method === 'days-of' ? 'Days of' : 'Roll-off vs.';
  const driver: DriverDefinition = {
    id: driverId,
    name: `${line.name || 'Line'} ${methodLabel} ${basisName}`,
    unit: DRIVER_UNIT[selection.method],
    targetLineId: lineId,
    method: selection.method,
    basisLineId: selection.basisLineId,
  };
  next = { ...next, drivers: [...next.drivers, driver] };
  const formula =
    selection.method === 'days-of'
      ? buildDaysFormula(selection.basisLineId, driverId)
      : selection.method === 'roll-off'
        ? buildRollOffFormula(lineId, driverId)
        : buildRatioFormula(selection.basisLineId, driverId);
  next = mapLines(next, (l) => (l.id === lineId ? { ...l, formula, projection: { method: selection.method, driverId } } : l));
  if (selection.method === 'roll-off') next = applyRollOffContra(next, lineId, selection.basisLineId);
  return next;
}
