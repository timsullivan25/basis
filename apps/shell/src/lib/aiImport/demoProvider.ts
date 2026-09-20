import type { LlmProvider, StructuredRequest } from './llmProvider';

/**
 * DEV-ONLY stand-in for a real model, so the import UI can be exercised end to end without an API key.
 * It doesn't read the workbook — it recognizes one specific workbook (a private Clarivate model) by its
 * sheet name and returns the answers a model should give for it. Any other workbook comes back as "no
 * statements found". Delete this once a real adapter exists.
 */
export class DemoLlmProvider implements LlmProvider {
  readonly name = 'demo';

  async generateStructured(request: StructuredRequest): Promise<unknown> {
    await new Promise((resolve) => setTimeout(resolve, 600)); // feel like a real call
    const knowsWorkbook = request.prompt.includes('"CLVT Model"');

    if (request.schemaName === 'financials_sheet_triage') {
      if (!knowsWorkbook) {
        return {
          layout: 'none',
          sheets: [],
          confidence: 'low',
          reasoning: 'The demo provider only recognizes one specific test workbook, so it cannot find statements in this one. A real model is needed for arbitrary files.',
          alternatives: [],
        };
      }
      return {
        layout: 'single',
        sheets: [{ name: 'CLVT Model', sections: ['Income Statement', 'Balance Sheet', 'Cash Flow Statement', 'EBITDA', 'Working Capital', 'Credit Metrics', 'KPIs', 'Segment Breakout', 'Debt Schedule'] }],
        confidence: 'high',
        reasoning: 'The "CLVT Model" sheet holds the three statements and the supporting schedules stacked one under another, and has by far the most matching lines. The LBO and Summary Financials tabs only reproduce some of them.',
        alternatives: [
          { sheet: 'LBO', note: 'Reproduces income statement and balance sheet lines for the returns analysis.' },
          { sheet: 'Summary Financials', note: 'Output summary of the model sheet.' },
        ],
      };
    }

    if (request.schemaName === 'sheet_extraction_plan') {
      return {
        sheet: 'CLVT Model',
        labelColumn: 'D',
        dateRow: 4,
        nameRow: 9,
        periodColumns: [
          ...'IJKLMNOPQRSTU'.split('').map((column) => ({ column, kind: 'Quarter', actual: true })),
          ...['V', 'W', 'X', 'Y', 'Z', 'AA', 'AB', 'AC', 'AD', 'AE', 'AF'].map((column) => ({ column, kind: 'Quarter', actual: false })),
          { column: 'AH', kind: 'LTM', actual: true },
          { column: 'AI', kind: 'NTM', actual: false },
          { column: 'AK', kind: 'FY', actual: true },
          { column: 'AL', kind: 'FY', actual: true },
          { column: 'AM', kind: 'FY', actual: true },
          { column: 'AN', kind: 'FY', actual: false },
          { column: 'AO', kind: 'FY', actual: false },
          { column: 'AP', kind: 'FY', actual: false },
        ],
        // Blocks of historical line items, each ending where the next schedule's title begins. Assumptions
        // (rows 11-309's inputs), Expense Normalization, Cost Savings and Public Equity are left out.
        sections: [
          { name: 'KPIs', firstRow: 111, lastRow: 151 },
          { name: 'Segment Breakout', firstRow: 153, lastRow: 309 },
          { name: 'Income Statement', firstRow: 311, lastRow: 338 },
          { name: 'EBITDA', firstRow: 392, lastRow: 430 },
          { name: 'Balance Sheet', firstRow: 477, lastRow: 526 },
          { name: 'Cash Flow Statement', firstRow: 528, lastRow: 551 },
          { name: 'Working Capital', firstRow: 553, lastRow: 583 },
          { name: 'Fixed Asset Schedule', firstRow: 585, lastRow: 597 },
          { name: 'Intangible Asset Schedule', firstRow: 599, lastRow: 611 },
          { name: 'Tax Schedule', firstRow: 613, lastRow: 637 },
          { name: 'Debt Schedule', firstRow: 639, lastRow: 718 },
          { name: 'Interest Expense', firstRow: 720, lastRow: 813 },
          { name: 'Credit Metrics', firstRow: 837, lastRow: 928 },
        ],
        confidence: 'high',
        reasoning: 'Section titles at rows 110, 152, 310, 391, 476, 527, 552, 584, 598, 612, 638, 719 and 836; each ends where the next begins. Annual actuals are AK-AM; AH is LTM despite being flagged Actual.',
        openQuestions: [],
      };
    }

    throw new Error(`Demo provider does not handle "${request.schemaName}".`);
  }
}
