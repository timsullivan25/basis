import type { ConceptInput, StatementLine, StatementSchema } from '../data';
import { normalize } from './matchStatementLines';

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
  | 'taxRate'
  | 'cash'
  | 'fcf';

/** Candidate names per concept, tried in order — e.g. EBITDA prefers "Adjusted EBITDA" (the
 *  bridge's final line) and only falls back to a plain "EBITDA" line if no adjusted one exists. */
const CANDIDATES: Record<SummaryConcept, string[]> = {
  revenue: ['Revenue'],
  // Prefers the deepest EBITDA bridge level a schema actually has, falling back down toward
  // plain EBITDA — see the EBITDA Delta lines in defaultStatementSchema.ts (Phase 9). A level
  // with no instances still resolves here (it's an ordinary line, just usually null/absent),
  // which is why this is a preference order, not a presence check.
  ebitda: ['Pro Forma EBITDA', 'Cash EBITDA', 'Adjusted EBITDA', 'EBITDA'],
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
  cash: ['Cash & Equivalents'],
  fcf: ['Free Cash Flow', 'FCF'],
};

/** The single canonical alias string to write when a user assigns a line to satisfy a concept
 *  (see AnalysesPanel/DcfPanel's "resolve a required concept" flow) — the first, most-preferred
 *  candidate name, same list findSummaryLine itself already tries in order. */
export function canonicalAliasFor(concept: SummaryConcept): string {
  return CANDIDATES[concept][0];
}

/** Finds the schema line matching a canonical concept, by name or alias, case-insensitively.
 *  Returns undefined (never throws) when the schema has no line for it — every Summary panel
 *  tile/row built on this must handle that by omitting itself, not fabricating a value. */
export function findSummaryLine(schema: StatementSchema, concept: SummaryConcept): StatementLine | undefined {
  const lines = schema.sections.flatMap((s) => s.lines);
  // An explicit pick wins over name/alias matching — ignored if that line has since been deleted.
  const pickedId = schema.conceptLineIds?.[concept];
  const picked = pickedId ? lines.find((l) => l.id === pickedId) : undefined;
  if (picked) return picked;
  for (const candidate of CANDIDATES[concept]) {
    const target = normalize(candidate);
    const match = lines.find((l) => normalize(l.name) === target || l.aliases.some((a) => normalize(a) === target));
    if (match) return match;
  }
  return undefined;
}

/** Points a concept at a specific line — returns the updated schema for the caller to persist.
 *  Re-pointable at any time (the "Lines used" card on each analysis), unlike the old
 *  alias-append, which couldn't override a line whose own name already matched. */
export function assignConceptLine(schema: StatementSchema, concept: SummaryConcept, lineId: string): StatementSchema {
  return { ...schema, conceptLineIds: { ...schema.conceptLineIds, [concept]: lineId } };
}

/** Concepts that can be a single entered number instead of a line, with the value they start at
 *  when nothing links. 25% tax = 21% federal + state/local. */
export const INPUT_CONCEPT_DEFAULTS: Partial<Record<SummaryConcept, number>> = { taxRate: 0.25 };

/** Where a concept's value comes from: a line, read period by period, or an entered number,
 *  flat across every period. undefined only for a linked concept with no line. */
export type ConceptSource = { kind: 'line'; line: StatementLine } | { kind: 'input'; value: number };

export function conceptSource(schema: StatementSchema, concept: SummaryConcept): ConceptSource | undefined {
  const line = findSummaryLine(schema, concept);
  const defaultValue = INPUT_CONCEPT_DEFAULTS[concept];
  if (defaultValue === undefined) return line ? { kind: 'line', line } : undefined;
  const choice = schema.conceptInputs?.[concept];
  const mode = choice?.mode ?? (line ? 'linked' : 'input');
  if (mode === 'input') return { kind: 'input', value: choice?.value ?? defaultValue };
  return line ? { kind: 'line', line } : undefined;
}

/** What an analysis hands its compute function for a concept: a line id, or the input number. */
export function conceptRef(schema: StatementSchema, concept: SummaryConcept): string | number | undefined {
  const source = conceptSource(schema, concept);
  return source?.kind === 'line' ? source.line.id : source?.value;
}

/** A concept's value at one period, whichever way it's sourced. */
export function readConceptValue(schema: StatementSchema, values: { getValue(lineId: string, periodIndex: number): number | null }, concept: SummaryConcept, periodIndex: number): number | null {
  const source = conceptSource(schema, concept);
  if (!source) return null;
  return source.kind === 'input' ? source.value : values.getValue(source.line.id, periodIndex);
}

/** Switches a concept between linked and input, or sets its input value — returns the updated
 *  schema for the caller to persist. */
export function setConceptInput(schema: StatementSchema, concept: SummaryConcept, patch: Partial<ConceptInput>): StatementSchema {
  const current = schema.conceptInputs?.[concept];
  const source = conceptSource(schema, concept);
  const next: ConceptInput = {
    mode: current?.mode ?? (source?.kind === 'line' ? 'linked' : 'input'),
    value: current?.value ?? INPUT_CONCEPT_DEFAULTS[concept] ?? 0,
    ...patch,
  };
  return { ...schema, conceptInputs: { ...schema.conceptInputs, [concept]: next } };
}
