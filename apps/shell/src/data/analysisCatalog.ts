import type { SummaryConcept } from '../lib/summaryLines';

/** Analyses are built into the app, not user-authored, so the catalog itself is static — nothing
 *  about it is persisted. `requiredConcepts` resolves through lib/summaryLines.ts's
 *  findSummaryLine, one layer removed from raw StatementLine.aliases strings: a concept resolves
 *  when some schema line's name or aliases match one of that concept's candidate names. */
export interface AnalysisCatalogEntry {
  id: string;
  name: string;
  /** Lucide icon name — shown on the enable/disable row and again on this analysis's own
   *  Accordion section in AnalysesPanel, so the same visual identity carries from "turn it on"
   *  to "here's its output". */
  icon: string;
  requiredConcepts: SummaryConcept[];
  defaultEnabled: boolean;
}

export const ANALYSIS_CATALOG: AnalysisCatalogEntry[] = [
  {
    id: 'dcf',
    name: 'DCF',
    icon: 'calculator',
    requiredConcepts: ['ebit', 'da', 'capex', 'nwc', 'taxRate'],
    defaultEnabled: false,
  },
  {
    id: 'lbo',
    name: 'LBO',
    icon: 'landmark',
    // Same concepts DCF requires, plus revenue/ebitda themselves — every one of these seeds a
    // real historical or ratio driver in the LBO case (see lib/lbo.ts's seedLboCase). A missing
    // tax rate in particular isn't a cosmetic gap: it nulls Net Income, which nulls Free Cash
    // Flow, which stalls the whole debt-schedule sweep — worth surfacing via the same "Required
    // lines" resolution checklist DCF already has, not a silently degraded seed.
    requiredConcepts: ['revenue', 'ebitda', 'da', 'capex', 'nwc', 'taxRate'],
    defaultEnabled: false,
  },
  {
    id: 'recoveryWaterfall',
    name: 'Recovery Waterfall',
    icon: 'waves',
    // No hard requirement here — its valuation is a manual assumption (direct entry always
    // works). EBITDA/Revenue are only needed for the two multiple-based methods, so
    // RecoveryWaterfallPanel checks those itself, conditioned on the method actually chosen,
    // rather than gating the whole analysis through the generic missingConceptsFor checklist.
    requiredConcepts: [],
    defaultEnabled: false,
  },
];
