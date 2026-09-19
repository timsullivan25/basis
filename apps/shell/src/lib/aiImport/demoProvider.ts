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
        sheets: [{ name: 'CLVT Model', statements: ['Income Statement', 'Balance Sheet', 'Cash Flow Statement'] }],
        confidence: 'high',
        reasoning: 'The "CLVT Model" sheet holds all three statements stacked one under another and has by far the most matching lines. The LBO and Summary Financials tabs only reproduce some of them.',
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
        statements: [
          { name: 'Income Statement', firstRow: 311, lastRow: 338 },
          { name: 'Balance Sheet', firstRow: 477, lastRow: 526 },
          { name: 'Cash Flow Statement', firstRow: 528, lastRow: 551 },
        ],
        confidence: 'high',
        reasoning: 'Statement titles at rows 310, 476 and 527; each ends where the next schedule begins. Annual actuals are AK-AM; AH is LTM despite being flagged Actual.',
        openQuestions: [],
      };
    }

    throw new Error(`Demo provider does not handle "${request.schemaName}".`);
  }
}
