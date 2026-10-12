import { describe, expect, it } from 'vitest';
import { createDefaultStatementSchema } from '../../data/defaultStatementSchema';
import { buildSchemaLineIndex } from './schemaLineIndex';
import { buildSheetEvidence, evidenceToText } from './sheetEvidence';
import { buildSheetWindows, windowsToText } from './windows';
import { buildSheetGrid } from './workbookGrid';

const index = buildSchemaLineIndex(createDefaultStatementSchema().sections);

const MODEL = buildSheetGrid('Model', false, [
  [null, 'Acme'],
  [null, null, null, 'FY-2023', 'FY-2024', 'FY-2025'],
  [null, 'Income Statement'],
  [null, null, 'Revenue', 100, 120, 140],
  [null, null, 'COGS', -40, -48, -56],
  [null, null, 'Net Income', 10, 12, 15],
  [null, 'Balance Sheet'],
  [null, null, 'Cash & Equivalents', 5, 6, 7],
  [null, null, 'Cash & Equivalents', 5, 6, 7],
]);
const NOTES = buildSheetGrid('Notes', false, [['Read me first'], ['Contact the deal team']]);

describe('buildSchemaLineIndex', () => {
  it('matches schema line names and registered aliases, ignoring case and punctuation', () => {
    expect(index.match('revenue')?.lineName).toBe('Revenue');
    expect(index.match('COGS')?.lineName).toBe('Cost of Revenue');
    expect(index.match('Cost of Goods Sold')?.lineName).toBe('Cost of Revenue');
    expect(index.match('Random Thing')).toBeUndefined();
  });
});

describe('buildSheetEvidence', () => {
  const [model, notes] = buildSheetEvidence([MODEL, NOTES], index);

  it('counts distinct matched schema lines, grouped by schema section', () => {
    expect(model.schemaMatches.distinctLines).toBeGreaterThanOrEqual(3);
    expect(model.schemaMatches.bySection['Income Statement']).toBeGreaterThanOrEqual(2);
    expect(model.schemaMatches.examples.some((e) => e.includes('"COGS" → Cost of Revenue'))).toBe(true);
  });

  it('does not double-count a label that repeats', () => {
    const repeated = buildSheetEvidence([buildSheetGrid('X', false, [['Revenue', 1], ['Revenue', 2]])], index)[0];
    expect(repeated.schemaMatches.distinctLines).toBe(1);
  });

  it('detects period-looking headers in the top rows', () => {
    expect(model.periodHeaderHint).toBe(true);
    expect(notes.periodHeaderHint).toBe(false);
  });

  it('reports a sheet with no financial content as having no matches', () => {
    expect(notes.schemaMatches.distinctLines).toBe(0);
    expect(evidenceToText([notes])).toContain('no Basis line matches');
  });

  it('records size and cell-type counts', () => {
    expect(model.rowCount).toBe(9);
    expect(model.columnCount).toBe(6);
    expect(model.numericCells).toBe(5 * 3);
  });
});

describe('buildSheetWindows', () => {
  const windows = buildSheetWindows(MODEL, index);

  it('keeps the top rows verbatim and one label row per non-empty row', () => {
    expect(windows.topRows[1].cells).toEqual([null, null, null, 'FY-2023', 'FY-2024', 'FY-2025']);
    expect(windows.labelRows).toHaveLength(9);
  });

  it('summarizes each row by number count and first number, and annotates schema matches', () => {
    const revenue = windows.labelRows.find((r) => r.rowNumber === 4)!;
    expect(revenue).toMatchObject({ numericCount: 3, firstNumber: { column: 'D', value: 100 }, schemaMatch: 'Revenue (Income Statement)' });
    const header = windows.labelRows.find((r) => r.rowNumber === 3)!;
    expect(header.numericCount).toBe(0);
    expect(header.schemaMatch).toBeNull();
  });

  it('never includes values beyond the first number per row', () => {
    const text = windowsToText(windows);
    expect(text).toContain('r4 C="Revenue" #3 first=D:100 → Revenue (Income Statement)');
    // (This sheet is shorter than the top-rows window, so only the label section is checked for leaked values.)
    const labelSection = text.slice(text.indexOf('ROW LABELS'));
    expect(labelSection).not.toContain('120');
    expect(text).toContain('TOP ROWS');
  });
});
