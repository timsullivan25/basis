import type { StatementSection } from '../../data';
import type { ExtractionPlan } from './extractionPlan';
import type { LlmProvider } from './llmProvider';
import { planSheets } from './planSheets';
import { buildSchemaLineIndex } from './schemaLineIndex';
import { buildSheetEvidence, type SheetEvidence } from './sheetEvidence';
import { triageSheets, type TriageResult, type TriageSheet } from './triage';
import { readWorkbookGrids, type SheetGrid } from './workbookGrid';

/** The statements the importer looks for; also the section names written into the generated template. */
export const STATEMENT_NAMES = ['Income Statement', 'Balance Sheet', 'Cash Flow Statement'];

export type AnalysisStep = 'reading' | 'scoring' | 'triage' | 'planning';

export interface WorkbookAnalysis {
  grids: SheetGrid[];
  evidence: SheetEvidence[];
  triage: TriageResult;
  /** Null when triage found no statements to plan. */
  plan: ExtractionPlan | null;
}

/** Steps 1-3 and 5-6 of the import: read, gather evidence, triage sheets, then plan each chosen sheet. Confirmation and execution are the caller's (the review UI's). */
export async function analyzeWorkbook(
  provider: LlmProvider,
  file: Blob,
  sections: StatementSection[],
  onStep: (step: AnalysisStep) => void = () => {},
): Promise<WorkbookAnalysis> {
  onStep('reading');
  const grids = await readWorkbookGrids(file);

  onStep('scoring');
  const index = buildSchemaLineIndex(sections);
  const evidence = buildSheetEvidence(grids, index);

  onStep('triage');
  const triage = await triageSheets(provider, evidence, STATEMENT_NAMES);
  if (triage.sheets.length === 0) return { grids, evidence, triage, plan: null };

  onStep('planning');
  const plan = await planSheets(provider, grids, index, triage.sheets);
  return { grids, evidence, triage, plan };
}

/** Re-plans for a sheet selection the user changed by hand, skipping triage. Every requested statement is asked of every chosen sheet. */
export function planForSheets(
  provider: LlmProvider,
  grids: SheetGrid[],
  sections: StatementSection[],
  sheetNames: string[],
): Promise<ExtractionPlan> {
  const chosen: TriageSheet[] = sheetNames.map((name) => ({ name, statements: STATEMENT_NAMES }));
  return planSheets(provider, grids, buildSchemaLineIndex(sections), chosen);
}
