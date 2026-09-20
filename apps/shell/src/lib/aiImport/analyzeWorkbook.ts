import type { StatementSection } from '../../data';
import type { ExtractionPlan } from './extractionPlan';
import type { LlmProvider } from './llmProvider';
import { planSheets } from './planSheets';
import { buildSchemaLineIndex } from './schemaLineIndex';
import { buildSheetEvidence, type SheetEvidence } from './sheetEvidence';
import { triageSheets, type TriageResult, type TriageSheet } from './triage';
import { readWorkbookGrids, type SheetGrid } from './workbookGrid';

/** The Basis section names the importer treats as canonical — a block on the sheet that corresponds to one is written into the template under that exact name. */
export function sectionNames(sections: StatementSection[]): string[] {
  return sections.map((s) => s.name);
}

export type AnalysisStep = 'reading' | 'scoring' | 'triage' | 'planning';

export interface WorkbookAnalysis {
  grids: SheetGrid[];
  evidence: SheetEvidence[];
  triage: TriageResult;
  /** Null when triage found no financials to plan. */
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
  const names = sectionNames(sections);
  const triage = await triageSheets(provider, evidence, names);
  if (triage.sheets.length === 0) return { grids, evidence, triage, plan: null };

  onStep('planning');
  const plan = await planSheets(provider, grids, index, triage.sheets, names);
  return { grids, evidence, triage, plan };
}

/** Re-plans for a sheet selection the user changed by hand, skipping triage. */
export function planForSheets(
  provider: LlmProvider,
  grids: SheetGrid[],
  sections: StatementSection[],
  sheetNames: string[],
): Promise<ExtractionPlan> {
  const chosen: TriageSheet[] = sheetNames.map((name) => ({ name, sections: [] }));
  return planSheets(provider, grids, buildSchemaLineIndex(sections), chosen, sectionNames(sections));
}
