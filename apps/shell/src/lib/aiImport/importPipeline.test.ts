import { describe, expect, it } from 'vitest';
import { parseBasisTemplate } from '../parseBasisTemplate';
import { FakeLlmProvider } from './fakeLlmProvider';
import { extractHistoricals, ExtractionError } from './extractHistoricals';
import { LayoutMapError, needsConfirmation, parseLayoutMap, type LayoutMap } from './layoutMap';
import { locateFinancials } from './locateFinancials';
import { buildOutline } from './outline';
import { writeBasisTemplate } from './writeBasisTemplate';
import { buildSheetGrid } from './workbookGrid';

// A small model shaped like a real one: period headers at the top shared by all statements, quarterly
// and annual columns side by side, an LTM column that is flagged "Actual", and duplicate labels.
//        A   B          C    D        E        F        G        H
const MODEL = buildSheetGrid('Model', false, [
  ['ACME MODEL'],
  [],
  [null, 'Status', null, 'Actual', 'Actual', 'Actual', 'Proj', 'Actual'],
  [null, 'Date', null, '2024-12-31', '2025-12-31', '2025-12-31', '2026-12-31', '2025-12-31'],
  [null, 'Kind', null, 'FY', 'FY', 'LTM', 'FY', 'Q'],
  [null, 'Label', null, 'FY-2024', 'FY-2025', 'LTM', 'FY-2026', 'Q4-2025'],
  [],
  [null, 'Income Statement'],
  [null, null, 'Revenue', 100, 120, 118, 140, 31],
  [null, null, '% Growth', null, 0.2, null, 0.17, null],
  [null, null, 'Net Income', 10, 15, 14, 20, 4],
  [],
  [null, 'Balance Sheet'],
  [null, 'Assets'],
  [null, null, 'Cash', 0, 50, 48, 60, 50],
  [null, null, 'Total Assets', 0, 500, 490, 520, 500],
  [null, 'Liabilities'],
  [null, null, 'Deferred Revenue', 5, 6, 6, 7, 6],
  [null, null, 'Deferred Revenue', 1, 2, 2, 3, 2],
]);

const MAP: LayoutMap = {
  sheet: 'Model',
  labelColumn: 'C',
  dateRow: 4,
  nameRow: 6,
  periodColumns: [
    { column: 'D', kind: 'FY', actual: true },
    { column: 'E', kind: 'FY', actual: true },
    { column: 'F', kind: 'LTM', actual: true },
    { column: 'G', kind: 'FY', actual: false },
    { column: 'H', kind: 'Quarter', actual: true },
  ],
  statements: [
    { name: 'Income Statement', firstRow: 9, lastRow: 11 },
    { name: 'Balance Sheet', firstRow: 14, lastRow: 19 },
  ],
  confidence: 'high',
  reasoning: 'Statements are stacked on the Model sheet.',
  alternatives: [],
};

describe('buildOutline', () => {
  it('shows top rows verbatim and header-like row labels, but not line-item values', () => {
    const outline = buildOutline([MODEL]);
    expect(outline).toContain('## Sheet "Model" — rows 1-19, columns A-H');
    expect(outline).toContain('r3: B=Status D=Actual');
    expect(outline).toContain('r13 [B] Balance Sheet');
    expect(outline).toContain('r11 [C] Net Income (has values)');
    expect(outline).not.toContain('Cash');
  });

  it('keeps statement titles and top-level section headers even when many earlier sub-headers exceed the cap', () => {
    const filler = Array.from({ length: 100 }, (_, i) => [null, null, `Assumption block ${i}`]);
    const grid = buildSheetGrid('Big', false, [...filler, [null, 'Balance Sheet'], [null, null, 'Cash', 5], [null, 'Working Capital Schedule'], [null, null, 'DSO', 40]]);
    const outline = buildOutline([grid]);
    expect(outline).toContain('r101 [B] Balance Sheet');
    expect(outline).toContain('r103 [B] Working Capital Schedule');
    expect(outline).toContain('more label rows omitted');
  });

  it('notes empty sheets instead of dropping them', () => {
    expect(buildOutline([{ name: 'Divider -->', hidden: false, rows: [] }])).toContain('Divider -->" — empty');
  });
});

describe('parseLayoutMap', () => {
  it('accepts a well-formed map', () => {
    expect(parseLayoutMap(MAP, [MODEL])).toEqual(MAP);
  });

  it('collects every problem: unknown sheet, bad column, inverted rows, bad confidence', () => {
    const bad = { ...MAP, sheet: 'Nope', labelColumn: '3', statements: [{ name: 'IS', firstRow: 9, lastRow: 2 }], confidence: 'sure' };
    try {
      parseLayoutMap(bad, [MODEL]);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(LayoutMapError);
      expect((e as LayoutMapError).issues).toHaveLength(4);
    }
  });

  it('asks for confirmation unless confidence is high with no alternatives', () => {
    expect(needsConfirmation(MAP)).toBe(false);
    expect(needsConfirmation({ ...MAP, confidence: 'medium' })).toBe(true);
    expect(needsConfirmation({ ...MAP, alternatives: [{ sheet: 'Summary', note: 'also has statements' }] })).toBe(true);
  });
});

describe('locateFinancials', () => {
  it('sends the outline (not the data) to the provider and validates the answer', async () => {
    const provider = new FakeLlmProvider(MAP);
    const map = await locateFinancials(provider, [MODEL]);
    expect(map.sheet).toBe('Model');
    expect(provider.requests[0].prompt).toContain('Workbook outline');
    expect(provider.requests[0].prompt).not.toContain('Cash');
  });

  it('rejects a response that points at a sheet that is not in the workbook', async () => {
    await expect(locateFinancials(new FakeLlmProvider({ ...MAP, sheet: 'Ghost' }), [MODEL])).rejects.toBeInstanceOf(LayoutMapError);
  });
});

describe('extractHistoricals', () => {
  it('takes only actual FY columns — not the LTM column flagged actual, not projections, not quarters', () => {
    const { workbook } = extractHistoricals([MODEL], MAP);
    expect(workbook.periods).toEqual([
      { type: 'FY', date: '2024-12-31T00:00:00.000Z', name: 'FY-2024' },
      { type: 'FY', date: '2025-12-31T00:00:00.000Z', name: 'FY-2025' },
    ]);
  });

  it('copies values verbatim: zeros stay zeros, ratio rows come along, blank rows and headers are skipped', () => {
    const { workbook } = extractHistoricals([MODEL], MAP);
    const byName = (n: string) => workbook.lines.filter((l) => l.name === n);
    expect(byName('Cash')[0].values).toEqual([0, 50]);
    expect(byName('% Growth')[0].values).toEqual([null, 0.2]);
    expect(workbook.lines.map((l) => l.name)).not.toContain('Assets');
  });

  it('keeps duplicate labels as separate lines with distinct ids, tagged with their statement', () => {
    const { workbook } = extractHistoricals([MODEL], MAP);
    const dupes = workbook.lines.filter((l) => l.name === 'Deferred Revenue');
    expect(dupes.map((l) => l.values[1])).toEqual([6, 2]);
    expect(new Set(dupes.map((l) => l.id)).size).toBe(2);
    expect(dupes[0].section).toBe('Balance Sheet');
  });

  it("'lowest' granularity prefers quarters over years", () => {
    const { workbook } = extractHistoricals([MODEL], MAP, 'lowest');
    expect(workbook.periods.map((p) => [p.type, p.name])).toEqual([['Quarter', 'Q4-2025']]);
    expect(workbook.lines.find((l) => l.name === 'Revenue')?.values).toEqual([31]);
  });

  it('errors when the map has no actual columns of the requested grain', () => {
    const noFy = { ...MAP, periodColumns: MAP.periodColumns.filter((c) => c.kind !== 'FY') };
    expect(() => extractHistoricals([MODEL], noFy)).toThrow(ExtractionError);
  });

  it('warns about a period with no readable date', () => {
    const { warnings } = extractHistoricals([MODEL], { ...MAP, dateRow: null });
    expect(warnings).toEqual(['Column D has no readable period-end date.', 'Column E has no readable period-end date.']);
  });
});

describe('writeBasisTemplate', () => {
  it('produces a file the existing template parser reads back identically', async () => {
    const { workbook } = extractHistoricals([MODEL], MAP);
    const parsed = await parseBasisTemplate(await writeBasisTemplate(workbook));
    expect(parsed.periods).toEqual(workbook.periods);
    expect(parsed.lines.map(({ section, name, values }) => ({ section, name, values }))).toEqual(
      workbook.lines.map(({ section, name, values }) => ({ section, name, values })),
    );
  });
});

