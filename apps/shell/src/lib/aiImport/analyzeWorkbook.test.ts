import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { createDefaultStatementSchema } from '../../data/defaultStatementSchema';
import { analyzeWorkbook, planForSheets, sectionNames, type AnalysisStep } from './analyzeWorkbook';
import { extractHistoricals } from './extractHistoricals';
import { FakeLlmProvider } from './fakeLlmProvider';
import type { StructuredRequest } from './llmProvider';

const sections = createDefaultStatementSchema().sections;

function workbook(): Blob {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ['Line', 'FY 2024', 'FY 2025'],
      ['Revenue', 100, 120],
      ['Net Income', 10, 15],
    ]),
    'Model',
  );
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Read me']]), 'Notes');
  return new Blob([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })]);
}

const triageAnswer = { layout: 'single', sheets: [{ name: 'Model', sections: ['Income Statement'] }], confidence: 'high', reasoning: 'r', alternatives: [] };
const planAnswer = {
  sheet: 'Model', labelColumn: 'A', dateRow: null, nameRow: 1,
  periodColumns: [{ column: 'B', kind: 'FY', actual: true }, { column: 'C', kind: 'FY', actual: true }],
  sections: [{ name: 'Income Statement', firstRow: 2, lastRow: 3 }],
  confidence: 'high', reasoning: 'r', openQuestions: [],
};
const respond = (request: StructuredRequest) => (request.schemaName === 'financials_sheet_triage' ? triageAnswer : planAnswer);

describe('analyzeWorkbook', () => {
  it('runs read → score → triage → plan and returns everything the review step needs', async () => {
    const steps: AnalysisStep[] = [];
    const provider = new FakeLlmProvider(respond);
    const analysis = await analyzeWorkbook(provider, workbook(), sections, (s) => steps.push(s));
    expect(steps).toEqual(['reading', 'scoring', 'triage', 'planning']);
    expect(analysis.evidence.map((e) => e.name)).toEqual(['Model', 'Notes']);
    expect(analysis.triage.sheets[0].name).toBe('Model');
    expect(provider.requests.map((r) => r.schemaName)).toEqual(['financials_sheet_triage', 'sheet_extraction_plan']);
    expect(extractHistoricals(analysis.grids, analysis.plan!).workbook.lines.map((l) => l.name)).toEqual(['Revenue', 'Net Income']);
  });

  it('stops after triage when no statements were found', async () => {
    const none = { layout: 'none', sheets: [], confidence: 'low', reasoning: 'nothing', alternatives: [] };
    const provider = new FakeLlmProvider(none);
    const analysis = await analyzeWorkbook(provider, workbook(), sections);
    expect(analysis.plan).toBeNull();
    expect(provider.requests).toHaveLength(1);
  });
});

describe('planForSheets', () => {
  it('re-plans a hand-picked sheet, offering every Basis section name, without triage', async () => {
    const grids = (await analyzeWorkbook(new FakeLlmProvider(respond), workbook(), sections)).grids;
    const provider = new FakeLlmProvider(respond);
    const plan = await planForSheets(provider, grids, sections, ['Model']);
    expect(plan.sheets[0].sheet).toBe('Model');
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0].prompt).toContain(`Basis section names: ${sectionNames(sections).join(', ')}`);
  });
});
