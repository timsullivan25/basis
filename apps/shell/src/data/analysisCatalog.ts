import type { SummaryConcept } from '../lib/summaryLines';

/** Analyses are built into the app, not user-authored, so the catalog itself is static — nothing
 *  about it is persisted. `requiredConcepts` resolves through lib/summaryLines.ts's
 *  findSummaryLine, one layer removed from raw StatementLine.aliases strings: a concept resolves
 *  when some schema line's name or aliases match one of that concept's candidate names. */
export interface AnalysisCatalogEntry {
  id: string;
  name: string;
  requiredConcepts: SummaryConcept[];
  defaultEnabled: boolean;
}

export const ANALYSIS_CATALOG: AnalysisCatalogEntry[] = [
  {
    id: 'dcf',
    name: 'DCF',
    requiredConcepts: ['ebit', 'da', 'capex', 'nwc', 'taxRate'],
    defaultEnabled: false,
  },
];
