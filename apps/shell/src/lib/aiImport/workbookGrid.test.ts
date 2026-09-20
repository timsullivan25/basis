import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { buildSheetGrid, gridToText, readWorkbookGrids } from './workbookGrid';
import { FakeLlmProvider } from './fakeLlmProvider';
import type { StructuredRequest } from './llmProvider';

describe('buildSheetGrid', () => {
  it('drops blank rows but keeps source row numbers, and trims trailing blank cells', () => {
    const grid = buildSheetGrid('IS', false, [
      ['Acme Corp', null, null],
      [null, null],
      ['Revenue', 100, 120, null, ''],
    ]);
    expect(grid.rows).toEqual([
      { rowNumber: 1, cells: ['Acme Corp'] },
      { rowNumber: 3, cells: ['Revenue', 100, 120] },
    ]);
  });

  it('normalizes dates to yyyy-mm-dd and trims strings', () => {
    const grid = buildSheetGrid('IS', false, [[' FY24 ', new Date('2024-12-31T00:00:00Z')]]);
    expect(grid.rows[0].cells).toEqual(['FY24', '2024-12-31']);
  });
});

describe('gridToText', () => {
  it('emits a sheet label, column-letter header, and row-numbered tab-separated rows', () => {
    const text = gridToText(buildSheetGrid('IS', false, [['Revenue', 100], [null], ['COGS', 40]]));
    expect(text).toBe(['Sheet: IS', '\tA\tB', '1\tRevenue\t100', '3\tCOGS\t40'].join('\n'));
  });

  it('labels hidden sheets', () => {
    expect(gridToText(buildSheetGrid('Old', true, [['x']]))).toContain('Sheet: Old (hidden)');
  });
});

describe('readWorkbookGrids', () => {
  it('reads every sheet of a real workbook and flags hidden ones', async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Revenue', 100, 120]]), 'IS');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Cash', 5]]), 'Scratch');
    wb.Workbook = { Sheets: [{ Hidden: 0 }, { Hidden: 1 }] };
    const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });

    const grids = await readWorkbookGrids(new Blob([bytes]));
    expect(grids.map((g) => [g.name, g.hidden])).toEqual([['IS', false], ['Scratch', true]]);
    expect(grids[0].rows[0]).toEqual({ rowNumber: 1, cells: ['Revenue', 100, 120] });
  });
});

describe('readWorkbookGrids — sheets that do not start at A1', () => {
  it('keeps absolute row numbers and column positions when the first populated cell is C3', async () => {
    const wb = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([['Revenue', 100]]);
    XLSX.utils.sheet_add_aoa(sheet, [['Revenue', 100]], { origin: 'C3' });
    delete sheet['A1'];
    delete sheet['B1'];
    sheet['!ref'] = 'C3:D3';
    XLSX.utils.book_append_sheet(wb, sheet, 'Offset');
    const [grid] = await readWorkbookGrids(new Blob([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })]));
    expect(grid.rows).toEqual([{ rowNumber: 3, cells: [null, null, 'Revenue', 100] }]);
  });
});

describe('FakeLlmProvider', () => {
  it('returns the canned response and records requests', async () => {
    const provider = new FakeLlmProvider({ ok: true });
    const request = { system: 's', prompt: 'p', schemaName: 'n', schema: {} };
    expect(await provider.generateStructured(request)).toEqual({ ok: true });
    expect(provider.requests).toEqual([request]);
  });

  it('accepts a function so a test can respond based on the request', async () => {
    const provider = new FakeLlmProvider((r: StructuredRequest) => ({ echoed: r.prompt }));
    const out = await provider.generateStructured({ system: '', prompt: 'hi', schemaName: 'n', schema: {} });
    expect(out).toEqual({ echoed: 'hi' });
  });
});
