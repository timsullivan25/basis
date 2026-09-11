import type { AnalysisCatalogEntry } from '../data/analysisCatalog';
import type { StatementSchema } from '../data';
import { findSummaryLine, type SummaryConcept } from './summaryLines';

/** Which of a catalog entry's required concepts the schema doesn't currently resolve — empty
 *  means every required concept is satisfied. Doesn't gate whether an analysis can be enabled
 *  (it can always be turned on); this drives the resolution checklist an enabled analysis's own
 *  panel shows for whatever's still missing. */
export function missingConceptsFor(schema: StatementSchema, entry: AnalysisCatalogEntry): SummaryConcept[] {
  return entry.requiredConcepts.filter((concept) => findSummaryLine(schema, concept) === undefined);
}
