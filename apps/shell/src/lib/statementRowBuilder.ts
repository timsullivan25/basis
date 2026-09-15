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
