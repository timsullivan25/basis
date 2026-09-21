/** One line/section a model has (or could have) child lines against — a `lineId` target rolls
 *  its children up into that line (see StatementLine.allowsSubLines' own doc comment); a
 *  `sectionId` target is freeform (KPIs) and has no rollup. Used by the mapping screen's
 *  "+ Add sub-line/KPI" row builder. */
export interface InstanceTarget {
  id: string;
  name: string;
  kind: 'line' | 'section';
}

export interface SchemaLineGroup {
  sectionName: string;
  lines: { id: string; name: string }[];
}
