import type { LlmProvider } from './llmProvider';
import { evidenceToText, type SheetEvidence } from './sheetEvidence';

export interface TriageSheet {
  name: string;
  /** Which sections this sheet holds — Basis section names where they match (e.g. "Income Statement", "EBITDA"), otherwise the sheet's own heading. */
  sections: string[];
}

export interface TriageResult {
  /** 'single': one sheet holds the financials. 'multiple': they are split across sheets. 'none': no historical financials found. */
  layout: 'single' | 'multiple' | 'none';
  sheets: TriageSheet[];
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
  /** Other sheets that also looked like plausible financials, so the confirm step can offer them. */
  alternatives: { sheet: string; note: string }[];
}

export class TriageError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`Invalid triage answer: ${issues.join('; ')}`);
    this.issues = issues;
  }
}

/** True when the sheet choice should be flagged for a human before we build on it. Alternatives alone don't trigger it — analysis tabs that mirror a few statement lines are normal, so they're shown as information. */
export function triageNeedsConfirmation(result: TriageResult): boolean {
  return result.layout === 'none' || result.confidence !== 'high';
}

export const TRIAGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['layout', 'sheets', 'confidence', 'reasoning', 'alternatives'],
  properties: {
    layout: { type: 'string', enum: ['single', 'multiple', 'none'] },
    sheets: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'sections'],
        properties: { name: { type: 'string' }, sections: { type: 'array', items: { type: 'string' } } },
      },
    },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    reasoning: { type: 'string' },
    alternatives: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['sheet', 'note'],
        properties: { sheet: { type: 'string' }, note: { type: 'string' } },
      },
    },
  },
} as const;

const SYSTEM_PROMPT = `You are helping import a company's historical financials from an arbitrary Excel financial model.
Step one: decide WHICH SHEETS hold the historical financials: the three primary statements (Income Statement, Balance Sheet, Cash Flow Statement) and any supporting schedules of historical line items (segment breakouts, KPIs, EBITDA build and adjustments, working capital, debt and capital structure, credit metrics). You are shown one line of facts per sheet.

The facts include how many distinct Basis lines (Revenue, Total Assets, Net Income, ...) appear as row labels on the sheet, grouped by Basis section. Treat them as hints, not answers:
- Analysis and output sheets (valuation, LBO, comps, summaries, charts) often reproduce a handful of lines. The sheet where the financials are BUILT — the working model — is usually the one with the most matches, and the one to prefer.
- Choose layout "single" when one sheet holds the financials (typically stacked one section under another), and list it.
- Choose "multiple" only when they are genuinely split across sheets (e.g. one tab per statement), and list each.
- Choose "none" if nothing looks like historical financials.
- For each chosen sheet, list the sections it holds: use the exact Basis section names given where a block corresponds to one, and add any other schedule of historical line items under the sheet's own heading.
- Do not choose sheets that only hold projections, scenarios, market data or presentation output. Prefer visible sheets.
- confidence is "high" only when the choice is unambiguous. Put other plausible sheets under "alternatives" with a short note.
- reasoning: two or three sentences a human can check.`;

/** Asks which sheet(s) hold the historical financials, from per-sheet evidence. Sheet names are validated against the evidence. */
export async function triageSheets(provider: LlmProvider, evidence: SheetEvidence[], sectionNames: string[]): Promise<TriageResult> {
  const raw = await provider.generateStructured({
    system: SYSTEM_PROMPT,
    prompt: `Basis section names: ${sectionNames.join(', ')}\n\nSheets:\n${evidenceToText(evidence)}`,
    schemaName: 'financials_sheet_triage',
    schema: TRIAGE_SCHEMA,
  });
  return parseTriage(raw, evidence.map((e) => e.name));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseTriage(raw: unknown, sheetNames: string[]): TriageResult {
  if (!isObject(raw)) throw new TriageError(['response is not an object']);
  const issues: string[] = [];
  const known = new Set(sheetNames);

  const layout = raw.layout;
  if (layout !== 'single' && layout !== 'multiple' && layout !== 'none') issues.push('layout must be "single", "multiple" or "none"');
  const confidence = raw.confidence;
  if (confidence !== 'high' && confidence !== 'medium' && confidence !== 'low') issues.push('confidence must be "high", "medium" or "low"');

  const sheets: TriageSheet[] = [];
  if (!Array.isArray(raw.sheets)) {
    issues.push('sheets must be an array');
  } else {
    for (const entry of raw.sheets) {
      if (!isObject(entry) || typeof entry.name !== 'string' || !Array.isArray(entry.sections)) {
        issues.push(`invalid sheets entry ${JSON.stringify(entry)}`);
        continue;
      }
      if (!known.has(entry.name)) issues.push(`sheet "${entry.name}" does not exist in the workbook`);
      sheets.push({ name: entry.name, sections: entry.sections.filter((s): s is string => typeof s === 'string') });
    }
    if (layout === 'single' && sheets.length !== 1) issues.push('layout "single" needs exactly one sheet');
    if (layout === 'multiple' && sheets.length < 2) issues.push('layout "multiple" needs at least two sheets');
    if (layout === 'none' && sheets.length !== 0) issues.push('layout "none" must list no sheets');
  }

  if (issues.length > 0) throw new TriageError(issues);
  return {
    layout: layout as TriageResult['layout'],
    sheets,
    confidence: confidence as TriageResult['confidence'],
    reasoning: typeof raw.reasoning === 'string' ? raw.reasoning : '',
    alternatives: Array.isArray(raw.alternatives)
      ? raw.alternatives.flatMap((a) =>
          isObject(a) && typeof a.sheet === 'string' ? [{ sheet: a.sheet, note: typeof a.note === 'string' ? a.note : '' }] : [],
        )
      : [],
  };
}
