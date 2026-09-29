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
  {
    id: 'lbo',
    name: 'LBO',
    // Same concepts DCF requires, plus revenue/ebitda themselves — every one of these seeds a
    // real historical or ratio driver in the LBO case (see lib/lbo.ts's seedLboCase). A missing
    // tax rate in particular isn't a cosmetic gap: it nulls Net Income, which nulls Free Cash
    // Flow, which stalls the whole debt-schedule sweep — worth surfacing via the same "Required
    // lines" resolution checklist DCF already has, not a silently degraded seed.
    requiredConcepts: ['revenue', 'ebitda', 'da', 'capex', 'nwc', 'taxRate'],
    defaultEnabled: false,
  },
];
