import type { LlmProvider, StructuredRequest } from './llmProvider';

/**
 * DEV-ONLY stand-in for a real model, so the import UI can be exercised end to end without an API key.
 * It doesn't read the workbook — it recognizes one specific workbook (a private Clarivate model) by its
 * sheet name and returns the answers a model should give for it. Any other workbook comes back as "no
 * statements found". Delete this once a real adapter exists.
 */
/** A group: title, the header row introducing it, and its inclusive row range. */
const g = (title: string, headerRow: number, firstRow: number, lastRow: number) => ({ title, headerRow, firstRow, lastRow });

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
          { name: 'KPIs', firstRow: 111, lastRow: 151, groups: [g("Organic Growth", 112, 113, 118), g("Revenue by Type", 119, 120, 130), g("% of Total", 126, 127, 130), g("Revenue by Geography", 131, 132, 142), g("% of Total", 138, 139, 142), g("Other KPIs", 143, 144, 151)] },
          { name: 'Segment Breakout', firstRow: 153, lastRow: 309, groups: [g("Academia & Government (A&G)", 154, 155, 187), g("% of Revenue", 168, 169, 174), g("Decommissioning Impact", 175, 176, 187), g("Intellectual Property (IP)", 188, 189, 208), g("% of Revenue", 202, 203, 208), g("Life Sciences & Healthcare (LS&H)", 209, 210, 242), g("% of Revenue", 223, 224, 229), g("Decommissioning Impact", 230, 231, 242), g("Sale Proceeds", 243, 244, 255), g("Sale Enabled", 245, 246, 255), g("Debt Paydown", 256, 257, 273), g("Debt Outstanding", 258, 259, 265), g("Debt Paydown", 266, 267, 273), g("Consolidated", 274, 275, 309), g("% of Revenue", 288, 289, 294), g("COGS / SG&A Breakout", 295, 296, 309)] },
          { name: 'Income Statement', firstRow: 311, lastRow: 338, groups: [] },
          { name: 'EBITDA', firstRow: 392, lastRow: 430, groups: [g("Reported", 393, 394, 400), g("Management", 401, 402, 415), g("Analyst", 416, 417, 430)] },
          { name: 'Balance Sheet', firstRow: 477, lastRow: 526, groups: [] },
          { name: 'Cash Flow Statement', firstRow: 528, lastRow: 551, groups: [] },
          { name: 'Working Capital', firstRow: 553, lastRow: 583, groups: [g("Drivers", 554, 555, 568), g("Net Working Capital", 569, 570, 583)] },
          { name: 'Fixed Asset Schedule', firstRow: 585, lastRow: 597, groups: [] },
          { name: 'Intangible Asset Schedule', firstRow: 599, lastRow: 611, groups: [] },
          { name: 'Tax Schedule', firstRow: 613, lastRow: 637, groups: [] },
          { name: 'Debt Schedule', firstRow: 639, lastRow: 718, groups: [g("Beginning Debt Balance", 640, 641, 652), g("Amortization Schedule", 653, 654, 661), g("Mandatory Amortization", 662, 663, 671), g("Cash Available for Optional Prepayment", 672, 673, 685), g("Optional Prepayment", 686, 687, 696), g("New Borrowing", 697, 698, 707), g("Ending Debt Balance", 708, 709, 718)] },
          { name: 'Interest Expense', firstRow: 720, lastRow: 813, groups: [g("Interest Rate Schedule", 723, 724, 733), g("Effective Interest Rate", 734, 735, 744), g("Average Debt Balance", 745, 746, 755), g("Interest Expense", 756, 757, 767), g("PIK Toggle", 768, 769, 776), g("PIK Interest Expense", 777, 778, 788), g("Interest Income", 789, 790, 794), g("Interest Rate Hedges", 795, 796, 809), g("Notional", 797, 798, 809), g("Total Interest Expense", 810, 811, 813)] },
          { name: 'Credit Metrics', firstRow: 837, lastRow: 928, groups: [g("Key Operating Metrics", 838, 839, 848), g("Capital Structure", 849, 850, 865), g("Valuation Multiples", 866, 867, 870), g("Leverage & LTV", 871, 872, 872), g("Gross Leverage", 873, 874, 878), g("Net Leverage", 879, 880, 884), g("LTV", 885, 886, 890), g("FCF & Liquidity", 891, 892, 892), g("FCF", 893, 894, 898), g("Liquidity", 899, 900, 907), g("Coverage Ratios", 908, 909, 909), g("Interest Coverage", 910, 911, 915), g("Fixed Charge Coverage", 916, 917, 928)] },
        ],
        confidence: 'high',
        reasoning: 'Section titles at rows 110, 152, 310, 391, 476, 527, 552, 584, 598, 612, 638, 719 and 836; each ends where the next begins. Annual actuals are AK-AM; AH is LTM despite being flagged Actual.',
        openQuestions: [],
      };
    }

    if (request.schemaName === 'structure_proposals') return { subLines: [] };
    if (request.schemaName === 'mapping_suggestions') return { matches: [] }; // the demo has no view on mappings
    throw new Error(`Demo provider does not handle "${request.schemaName}".`);
  }
}
