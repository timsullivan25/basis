import type { StatementLine, StatementSchema, StatementSection } from '../data';
import { childrenOf } from './statementLineChildren';
import type { InstanceTarget } from '../components/models/instances/projectionMethod';

export interface SectionRow {
  id: string;
  line?: StatementLine;
  childLine?: StatementLine;
  isKpi?: boolean;
  addInstanceTarget?: InstanceTarget;
}

/** Builds one section's rows in display order — top-level lines (or, for a freeform/KPI section,
 *  every line as a child), each followed by its own children and an "add sub-line/KPI" row where
 *  applicable. Shared by ModelMappingScreen's single flat table (which prepends its own group
 *  header row and concatenates every section) and SchemaStructureEditor's per-section DataTable,
 *  so "same rows, same order" between the two is true by construction rather than by two screens
 *  independently hand-rolling near-identical logic.
 *
 *  `filter` narrows which top-level lines (or freeform children) appear — used by the mapping
 *  screen's search/tab/needs-review filtering. A line's own children and its "add" row are never
 *  independently filtered; they only disappear when their parent does. Schema-editing contexts
 *  (the template builder, the model workspace's schema mode) pass no filter — every line always
 *  shows there. */
export function buildSectionRows(schema: StatementSchema, section: StatementSection, filter: (line: StatementLine) => boolean = () => true): SectionRow[] {
  const rows: SectionRow[] = [];

  if (section.allowsFreeformLines) {
    // Every line in a freeform section IS a KPI child (added via "+ Add KPI") — there's no
    // "ordinary" line here at all, unlike an ordinary section's top-level lines.
    section.lines.filter(filter).forEach((child) => rows.push({ id: `child-${child.id}`, childLine: child, isKpi: true }));
    rows.push({ id: `add-section-${section.id}`, addInstanceTarget: { id: section.id, name: section.name, kind: 'section' } });
    return rows;
  }

  const topLevelLines = section.lines.filter((l) => !l.parentLineId);
  topLevelLines.filter(filter).forEach((line) => {
    rows.push({ id: line.id, line });
    if (line.allowsSubLines) {
      childrenOf(schema, line.id).forEach((child) => rows.push({ id: `child-${child.id}`, childLine: child, isKpi: false }));
      rows.push({ id: `add-line-${line.id}`, addInstanceTarget: { id: line.id, name: line.name, kind: 'line' } });
    }
  });
  return rows;
}

/** A row in ModelMappingScreen's own flat, all-sections-concatenated table — every SectionRow
 *  plus the section it belongs to (absent on a `__group` divider row, which belongs to no
 *  section itself but marks where one starts) and, for a `__group` row, the section's own name
 *  as `__group`. */
export interface FlatRow extends SectionRow {
  __group?: string;
  sectionId?: string;
}

/** Resolves a DataTable onReorder's `beforeKey` — a RENDERED row's id, not necessarily a real
 *  line's — into the section + raw line id lib/statementSchemaEdit.ts's reorderLine actually
 *  wants. Needed only by a screen with ONE flat table spanning every section (ModelMappingScreen);
 *  SchemaStructureEditor's one-DataTable-per-section layout never has this ambiguity — whichever
 *  section's own table fired onReorder IS the target, full stop.
 *
 *  `beforeKey: null` means "at the end of the table" — resolved to the end of the LAST section.
 *  A `group-<sectionId>` key (dropped ON a section's own header) resolves to that section's
 *  CURRENT first row, not `reorderLine`'s own null-means-end — dropping on a header means
 *  "become the first line here", the opposite end from a bare null. Any other key not found
 *  among `rows` (e.g. a stale id) falls back to the end of the last section, same as null,
 *  rather than silently doing nothing. */
export function resolveFlatRowDropTarget(
  rows: FlatRow[],
  sections: Array<{ id: string }>,
  beforeKey: string | null,
): { toSectionId: string; beforeLineId: string | null } | null {
  const lastSectionId = sections[sections.length - 1]?.id;
  const toEnd = lastSectionId ? { toSectionId: lastSectionId, beforeLineId: null } : null;
  if (beforeKey === null) return toEnd;
  if (beforeKey.startsWith('group-')) {
    const sectionId = beforeKey.slice('group-'.length);
    const groupIndex = rows.findIndex((r) => r.id === beforeKey);
    const next = groupIndex === -1 ? undefined : rows[groupIndex + 1];
    const beforeLineId = next && next.sectionId === sectionId ? (next.line?.id ?? next.childLine?.id ?? null) : null;
    return { toSectionId: sectionId, beforeLineId };
  }
  const target = rows.find((r) => r.id === beforeKey);
  if (!target?.sectionId) return toEnd;
  return { toSectionId: target.sectionId, beforeLineId: target.line?.id ?? target.childLine?.id ?? null };
}
