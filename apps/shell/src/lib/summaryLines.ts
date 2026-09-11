import type { StatementLine, StatementSchema } from '../data';

/** Same normalization `matchStatementLines.ts`'s import-time alias matching already uses —
 *  replicated here rather than imported, since that function isn't exported (it's a private
 *  implementation detail of the opposite-direction match: source-name -> target-line). */
function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** The canonical concepts a schema-independent consumer looks for — a Summary panel, or (from
 *  Phase 8 on) an analysis catalog entry's `requiredConcepts` — since schemas are fully
 *  user-editable and nothing guarantees a line named exactly "Revenue" exists. */
export type SummaryConcept =
  | 'revenue'
  | 'ebitda'
  | 'netDebt'
  | 'netLeverage'
  | 'interestCoverage'
  | 'totalDebt'
  | 'totalEquity'
  | 'ebit'
  | 'da'
  | 'capex'
  | 'nwc'
  | 'taxRate';

/** Candidate names per concept, tried in order — e.g. EBITDA prefers "Adjusted EBITDA" (the
 *  bridge's final line) and only falls back to a plain "EBITDA" line if no adjusted one exists. */
const CANDIDATES: Record<SummaryConcept, string[]> = {
  revenue: ['Revenue'],
  ebitda: ['Adjusted EBITDA', 'EBITDA'],
  netDebt: ['Net Debt'],
  netLeverage: ['Net Leverage'],
  interestCoverage: ['Interest Coverage'],
  totalDebt: ['Total Debt'],
  totalEquity: ['Total Equity'],
  ebit: ['EBIT'],
  da: ['D&A'],
  capex: ['Capex'],
  nwc: ['Net Working Capital'],
  taxRate: ['Effective Tax Rate', 'Tax Rate'],
};

/** Finds the schema line matching a canonical concept, by name or alias, case-insensitively.
 *  Returns undefined (never throws) when the schema has no line for it — every Summary panel
 *  tile/row built on this must handle that by omitting itself, not fabricating a value. */
export function findSummaryLine(schema: StatementSchema, concept: SummaryConcept): StatementLine | undefined {
  const lines = schema.sections.flatMap((s) => s.lines);
  for (const candidate of CANDIDATES[concept]) {
    const target = normalize(candidate);
    const match = lines.find((l) => normalize(l.name) === target || l.aliases.some((a) => normalize(a) === target));
    if (match) return match;
  }
  return undefined;
}
