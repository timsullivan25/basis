import type { LlmProvider } from './llmProvider';
import { parseSheetPlan, SHEET_PLAN_SCHEMA, type ExtractionPlan, type SheetPlanResult } from './extractionPlan';
import type { SchemaLineIndex } from './schemaLineIndex';
import type { TriageSheet } from './triage';
import { buildSheetWindows, windowsToText } from './windows';
import type { SheetGrid } from './workbookGrid';
import { getPrompt } from './prompts';

/** Asks the provider for a per-sheet extraction plan from top-row and label windows; one call per sheet. Each answer is validated against its sheet. */
export async function planSheets(
  provider: LlmProvider,
  grids: SheetGrid[],
  index: SchemaLineIndex,
  chosen: TriageSheet[],
  sectionNames: string[],
): Promise<ExtractionPlan> {
  const results: SheetPlanResult[] = await Promise.all(
    chosen.map(async ({ name, sections }) => {
      const grid = grids.find((g) => g.name === name);
      if (!grid) throw new Error(`Sheet "${name}" not found.`);
      const raw = await provider.generateStructured({
        system: getPrompt('plan'),
        prompt: `Basis section names: ${sectionNames.join(', ')}\nSections the triage step expects on this sheet: ${sections.join(', ') || '(none listed)'}\n\n${windowsToText(buildSheetWindows(grid, index))}`,
        schemaName: 'sheet_extraction_plan',
        schema: SHEET_PLAN_SCHEMA,
        // Finding every block on a long sheet benefits from some deliberation (triage does not). Kept low for fast, cheap testing; raise it, or use a stronger model, for production.
        effort: 'low',
      });
      return parseSheetPlan(raw, name, grids);
    }),
  );
  return { sheets: results.map((r) => r.plan), results };
}
