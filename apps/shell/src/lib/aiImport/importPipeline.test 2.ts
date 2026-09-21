import { describe, expect, it } from 'vitest';
import { createDefaultStatementSchema } from '../../data/defaultStatementSchema';
import { parseBasisTemplate } from '../parseBasisTemplate';
import { FakeLlmProvider } from './fakeLlmProvider';
import { extractHistoricals, ExtractionError } from './extractHistoricals';
import { type ExtractionPlan, PlanError, parseSheetPlan, planNeedsConfirmation, type SheetPlan } from './extractionPlan';
import { defaultPeriodKeys, periodOptions } from './periodOptions';
import { planSheets } from './planSheets';
import { buildSchemaLineIndex } from './schemaLineIndex';
import { buildSheetEvidence } from './sheetEvidence';
import { parseTriage, triageNeedsConfirmation, triageSheets, TriageError } from './triage';
import { writeBasisTemplate } from './writeBasisTemplate';
import { buildSheetGrid } from './workbookGrid';

const index = buildSchemaLineIndex(createDefaultStatementSchema().sections);

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

const MODEL_PLAN: SheetPlan = {
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
  sections: [
    { name: 'Income Statement', firstRow: 9, lastRow: 11, groups: [] },
    { name: 'Balance Sheet', firstRow: 14, lastRow: 19, groups: [] },
  ],
};

const planOf = (...sheets: SheetPlan[]): ExtractionPlan => ({ sheets, results: [] });
const rawResult = (plan: SheetPlan, extra: Record<string, unknown> = {}) => ({
  ...plan,
  confidence: 'high',
  reasoning: 'clear',
  openQuestions: [],
  ...extra,
});

describe('parseSheetPlan', () => {
  it('accepts a well-formed plan and keeps its confidence and open questions', () => {
    const result = parseSheetPlan(rawResult(MODEL_PLAN, { openQuestions: ['units?'] }), 'Model', [MODEL]);
    expect(result.plan).toEqual(MODEL_PLAN);
    expect(result.openQuestions).toEqual(['units?']);
  });

  it('collects every problem: wrong sheet, bad column, inverted rows, bad confidence', () => {
    const bad = rawResult(MODEL_PLAN, { labelColumn: '3', sections: [{ name: 'IS', firstRow: 9, lastRow: 2, groups: [] }], confidence: 'sure', sheet: 'Nope' });
    try {
      parseSheetPlan(bad, 'Model', [MODEL]);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(PlanError);
      expect((e as PlanError).issues).toHaveLength(5);
    }
  });

  it('rejects a plan for a different sheet than the one asked about', () => {
    const other = buildSheetGrid('Other', false, [['x']]);
    expect(() => parseSheetPlan(rawResult({ ...MODEL_PLAN, sheet: 'Other' }), 'Model', [MODEL, other])).toThrow(PlanError);
  });

  it('asks for confirmation when any sheet is below high confidence or has open questions', () => {
    const ok = parseSheetPlan(rawResult(MODEL_PLAN), 'Model', [MODEL]);
    expect(planNeedsConfirmation([ok])).toBe(false);
    expect(planNeedsConfirmation([{ ...ok, confidence: 'medium' }])).toBe(true);
    expect(planNeedsConfirmation([{ ...ok, openQuestions: ['which?'] }])).toBe(true);
  });
});

describe('triage', () => {
  const NOTES = buildSheetGrid('Notes', false, [['Read me']]);
  const evidence = buildSheetEvidence([MODEL, NOTES], index);
  const answer = { layout: 'single', sheets: [{ name: 'Model', sections: ['Income Statement', 'Balance Sheet'] }], confidence: 'high', reasoning: 'r', alternatives: [] };

  it('sends per-sheet evidence and the requested statement names, not sheet contents', async () => {
    const provider = new FakeLlmProvider(answer);
    const result = await triageSheets(provider, evidence, ['Income Statement', 'Balance Sheet']);
    expect(result.sheets[0].name).toBe('Model');
    const { prompt } = provider.requests[0];
    expect(prompt).toContain('Basis section names: Income Statement, Balance Sheet');
    expect(prompt).toContain('"Model"');
    expect(prompt).toContain('Basis lines matched');
    expect(prompt).not.toContain('520');
  });

  it('rejects sheets that are not in the workbook and layout/sheet-count mismatches', () => {
    expect(() => parseTriage({ ...answer, sheets: [{ name: 'Ghost', sections: [] }] }, ['Model'])).toThrow(TriageError);
    expect(() => parseTriage({ ...answer, layout: 'multiple' }, ['Model'])).toThrow(/at least two/);
    expect(() => parseTriage({ ...answer, layout: 'none' }, ['Model'])).toThrow(/no sheets/);
  });

  it('flags the choice unless confidence is high and something was found; alternatives alone do not', () => {
    const ok = parseTriage(answer, ['Model']);
    expect(triageNeedsConfirmation(ok)).toBe(false);
    expect(triageNeedsConfirmation({ ...ok, confidence: 'low' })).toBe(true);
    expect(triageNeedsConfirmation({ ...ok, alternatives: [{ sheet: 'LBO', note: 'also has statements' }] })).toBe(false);
    expect(triageNeedsConfirmation({ ...ok, layout: 'none', sheets: [] })).toBe(true);
  });
});

describe('planSheets', () => {
  it('asks once per chosen sheet with that sheet\'s windows, and validates each answer', async () => {
    const provider = new FakeLlmProvider(rawResult(MODEL_PLAN));
    const plan = await planSheets(provider, [MODEL], index, [{ name: 'Model', sections: ['Income Statement'] }], ['Income Statement', 'EBITDA']);
    expect(plan.sheets).toEqual([MODEL_PLAN]);
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0].prompt).toContain('Basis section names: Income Statement, EBITDA');
    expect(provider.requests[0].prompt).toContain('Sections the triage step expects on this sheet: Income Statement');
    expect(provider.requests[0].prompt).toContain('TOP ROWS');
    expect(provider.requests[0].prompt).toContain('r9 C="Revenue" #5');
  });

  it('rejects an answer that points at a different sheet', async () => {
    const provider = new FakeLlmProvider(rawResult({ ...MODEL_PLAN, sheet: 'Ghost' }));
    await expect(planSheets(provider, [MODEL], index, [{ name: 'Model', sections: [] }], [])).rejects.toBeInstanceOf(PlanError);
  });
});

describe('extractHistoricals — single sheet', () => {
  it('takes only actual FY columns — not the LTM column flagged actual, not projections, not quarters', () => {
    const { workbook } = extractHistoricals([MODEL], planOf(MODEL_PLAN));
    expect(workbook.periods).toEqual([
      { type: 'FY', date: '2024-12-31T00:00:00.000Z', name: 'FY-2024' },
      { type: 'FY', date: '2025-12-31T00:00:00.000Z', name: 'FY-2025' },
    ]);
  });

  it('copies values verbatim: zeros stay zeros, ratio rows come along, blank rows and headers are skipped', () => {
    const { workbook } = extractHistoricals([MODEL], planOf(MODEL_PLAN));
    const byName = (n: string) => workbook.lines.filter((l) => l.name === n);
    expect(byName('Cash')[0].values).toEqual([0, 50]);
    expect(byName('% Growth')[0].values).toEqual([null, 0.2]);
    expect(workbook.lines.map((l) => l.name)).not.toContain('Assets');
  });

  it('keeps duplicate labels as separate lines with distinct ids, tagged with their statement', () => {
    const { workbook } = extractHistoricals([MODEL], planOf(MODEL_PLAN));
    const dupes = workbook.lines.filter((l) => l.name === 'Deferred Revenue');
    expect(dupes.map((l) => l.values[1])).toEqual([6, 2]);
    expect(new Set(dupes.map((l) => l.id)).size).toBe(2);
    expect(dupes[0].section).toBe('Balance Sheet');
  });

  it("'lowest' granularity prefers quarters over years", () => {
    const { workbook } = extractHistoricals([MODEL], planOf(MODEL_PLAN), 'lowest');
    expect(workbook.periods.map((p) => [p.type, p.name])).toEqual([['Quarter', 'Q4-2025']]);
    expect(workbook.lines.find((l) => l.name === 'Revenue')?.values).toEqual([31]);
  });

  it('errors when no sheet has actual columns of the requested grain', () => {
    const noFy = { ...MODEL_PLAN, periodColumns: MODEL_PLAN.periodColumns.filter((c) => c.kind !== 'FY') };
    expect(() => extractHistoricals([MODEL], planOf(noFy))).toThrow(ExtractionError);
  });

  it('warns about a period with no readable date', () => {
    const { warnings } = extractHistoricals([MODEL], planOf({ ...MODEL_PLAN, dateRow: null }));
    expect(warnings).toEqual([
      'Sheet "Model", column D: no readable period-end date.',
      'Sheet "Model", column E: no readable period-end date.',
      // The fixture's two "Deferred Revenue" lines (current and non-current) share a name and no groups were given.
      'Sheet "Model", section "Balance Sheet": 1 repeated line name (e.g. "Deferred Revenue") — a group may be missing.',
    ]);
  });
});

describe('extractHistoricals — supporting schedules beyond the three statements', () => {
  const SCHEDULES = buildSheetGrid('Sched', false, [
    ['Line', 'FY 2024', 'FY 2025'],
    ['Segment Breakout'],
    ['Academia revenue', 60, 70],
    ['Life Sciences revenue', 40, 50],
    ['Debt Schedule'],
    ['2028 Notes', 500, 500],
    ['Revolver', 20, 0],
  ]);
  const plan: SheetPlan = {
    sheet: 'Sched', labelColumn: 'A', dateRow: null, nameRow: 1,
    periodColumns: ['B', 'C'].map((column) => ({ column, kind: 'FY' as const, actual: true })),
    sections: [
      { name: 'Segment Breakout', firstRow: 3, lastRow: 4, groups: [] },
      { name: 'Debt Schedule', firstRow: 6, lastRow: 7, groups: [] },
    ],
  };

  it('imports every planned section under its own name, so segments and tranches arrive as source lines', () => {
    const { workbook } = extractHistoricals([SCHEDULES], planOf(plan));
    expect(workbook.lines.map((l) => [l.section, l.name, l.values])).toEqual([
      ['Segment Breakout', 'Academia revenue', [60, 70]],
      ['Segment Breakout', 'Life Sciences revenue', [40, 50]],
      ['Debt Schedule', '2028 Notes', [500, 500]],
      ['Debt Schedule', 'Revolver', [20, 0]],
    ]);
  });

  it('warns when two sections claim the same row, since it would be imported twice', () => {
    const overlapping = { ...plan, sections: [{ name: 'Segment Breakout', firstRow: 3, lastRow: 5, groups: [] }, { name: 'Debt Schedule', firstRow: 5, lastRow: 7, groups: [] }] };
    const { warnings } = extractHistoricals([SCHEDULES], planOf(overlapping));
    expect(warnings).toContain('Sheet "Sched", row 5: in both "Segment Breakout" and "Debt Schedule" — imported twice.');
  });
});

describe('period options and explicit period selection', () => {
  const options = periodOptions([MODEL], planOf(MODEL_PLAN));

  it('lists every period column once, marking which can be imported (reported FY/Quarter/Semi-Annual only)', () => {
    expect(options.map((o) => [o.name, o.kind, o.actual, o.importable])).toEqual([
      ['FY-2024', 'FY', true, true],
      ['FY-2025', 'FY', true, true],
      ['LTM', 'LTM', true, false], // reported, but not a period Basis models
      ['FY-2026', 'FY', false, false], // projection
      ['Q4-2025', 'Quarter', true, true],
    ]);
  });

  it('defaults to annual actuals, or the finest grain present', () => {
    expect([...defaultPeriodKeys(options, 'annual')]).toEqual(['fy2024', 'fy2025']);
    expect([...defaultPeriodKeys(options, 'lowest')]).toEqual(['q42025']);
  });

  it('imports exactly the chosen periods, including a mix of types', () => {
    const { workbook } = extractHistoricals([MODEL], planOf(MODEL_PLAN), { keys: new Set(['fy2025', 'q42025']) });
    expect(workbook.periods.map((p) => [p.name, p.type])).toEqual([['FY-2025', 'FY'], ['Q4-2025', 'Quarter']]);
    expect(workbook.lines.find((l) => l.name === 'Revenue')?.values).toEqual([120, 31]);
  });

  it('never imports a projection or LTM column, even if its key is selected', () => {
    const { workbook } = extractHistoricals([MODEL], planOf(MODEL_PLAN), { keys: new Set(['fy2024', 'fy2026', 'ltm']) });
    expect(workbook.periods.map((p) => p.name)).toEqual(['FY-2024']);
  });

  it('errors clearly when nothing is selected', () => {
    expect(() => extractHistoricals([MODEL], planOf(MODEL_PLAN), { keys: new Set() })).toThrow('No periods are selected.');
  });
});

describe('groups — repeated labels keep their context', () => {
  //   A                          B      C
  const SEGMENTS = buildSheetGrid('Seg', false, [
    ['Line', 'FY 2024', 'FY 2025'],
    ['Segments'],                     // 2: section title
    ['Academia'],                     // 3: group header
    ['Revenue', 60, 70],              // 4
    ['% of Revenue'],                 // 5: nested header
    ['Costs', 20, 22],                // 6
    ['Life Sciences'],                // 7: group header
    ['Revenue', 40, 50],              // 8
    ['Total', 100, 120],              // 9: outside any group
  ]);
  const base: SheetPlan = {
    sheet: 'Seg', labelColumn: 'A', dateRow: null, nameRow: 1,
    periodColumns: ['B', 'C'].map((column) => ({ column, kind: 'FY' as const, actual: true })),
    sections: [{
      name: 'Segments', firstRow: 3, lastRow: 9,
      groups: [
        { title: 'Academia', headerRow: 3, firstRow: 4, lastRow: 6 },
        { title: '% of Revenue', headerRow: 5, firstRow: 6, lastRow: 6 },
        { title: 'Life Sciences', headerRow: 7, firstRow: 8, lastRow: 8 },
      ],
    }],
  };
  const names = (plan: SheetPlan) => extractHistoricals([SEGMENTS], planOf(plan)).workbook.lines.map((l) => l.name);

  it('prefixes each line with its enclosing groups, outermost first, and leaves ungrouped lines alone', () => {
    expect(names(base)).toEqual([
      'Academia — Revenue',
      'Academia — % of Revenue — Costs',
      'Life Sciences — Revenue',
      'Total',
    ]);
  });

  it('makes previously repeated names unique, so no duplicate warning fires', () => {
    expect(extractHistoricals([SEGMENTS], planOf(base)).warnings.filter((w) => w.includes('repeated'))).toEqual([]);
  });

  it('warns when names still repeat because no groups were given', () => {
    const { warnings } = extractHistoricals([SEGMENTS], planOf({ ...base, sections: [{ ...base.sections[0], groups: [] }] }));
    expect(warnings).toContain('Sheet "Seg", section "Segments": 1 repeated line name (e.g. "Revenue") — a group may be missing.');
  });

  it('warns about groups that overlap without nesting', () => {
    const crossing = { ...base, sections: [{ ...base.sections[0], groups: [
      { title: 'A', headerRow: 3, firstRow: 4, lastRow: 6 },
      { title: 'B', headerRow: 5, firstRow: 6, lastRow: 8 },
    ] }] };
    expect(extractHistoricals([SEGMENTS], planOf(crossing)).warnings.some((w) => w.includes('groups "A" and "B" overlap without nesting'))).toBe(true);
  });

  it('parses groups from a provider answer, defaulting to none and rejecting a malformed group', () => {
    const grids = [SEGMENTS];
    const withGroups = parseSheetPlan(rawResult(base), 'Seg', grids);
    expect(withGroups.plan.sections[0].groups).toHaveLength(3);
    const noGroups = parseSheetPlan(rawResult({ ...base, sections: [{ name: 'Segments', firstRow: 3, lastRow: 9 }] as never }), 'Seg', grids);
    expect(noGroups.plan.sections[0].groups).toEqual([]);
    const bad = rawResult({ ...base, sections: [{ ...base.sections[0], groups: [{ title: 'X', headerRow: 5, firstRow: 4, lastRow: 6 }] }] });
    expect(() => parseSheetPlan(bad, 'Seg', grids)).toThrow(PlanError);
  });

  it('tells the model how to describe groups', async () => {
    const provider = new FakeLlmProvider(rawResult(base));
    await planSheets(provider, [SEGMENTS], index, [{ name: 'Seg', sections: [] }], []);
    expect(provider.requests[0].system).toContain('groups (inside each section)');
  });
});

describe('extractHistoricals — several sheets consolidated', () => {
  // Statements on separate tabs; period labels are written differently and one tab lacks a year.
  const IS = buildSheetGrid('IS', false, [
    ['Line', 'FY 2023', 'FY 2024', 'FY 2025'],
    ['Revenue', 90, 100, 120],
    ['Net Income', 8, 10, 15],
  ]);
  const BS = buildSheetGrid('BS', false, [
    ['Line', 'FY-2024', 'FY-2025'],
    ['Total Assets', 480, 500],
  ]);
  const isPlan: SheetPlan = {
    sheet: 'IS', labelColumn: 'A', dateRow: null, nameRow: 1,
    periodColumns: ['B', 'C', 'D'].map((column) => ({ column, kind: 'FY' as const, actual: true })),
    sections: [{ name: 'Income Statement', firstRow: 2, lastRow: 3, groups: [] }],
  };
  const bsPlan: SheetPlan = {
    sheet: 'BS', labelColumn: 'A', dateRow: null, nameRow: 1,
    periodColumns: ['B', 'C'].map((column) => ({ column, kind: 'FY' as const, actual: true })),
    sections: [{ name: 'Balance Sheet', firstRow: 2, lastRow: 2, groups: [] }],
  };

  it('aligns periods by name, ignoring punctuation, and fills gaps with null', () => {
    const { workbook, warnings } = extractHistoricals([IS, BS], planOf(isPlan, bsPlan));
    expect(workbook.periods.map((p) => p.name)).toEqual(['FY 2023', 'FY 2024', 'FY 2025']);
    expect(workbook.lines.map((l) => [l.section, l.name, l.values])).toEqual([
      ['Income Statement', 'Revenue', [90, 100, 120]],
      ['Income Statement', 'Net Income', [8, 10, 15]],
      ['Balance Sheet', 'Total Assets', [null, 480, 500]],
    ]);
    expect(warnings).toContain('Sheet "BS" has no data for: FY 2023.');
  });

  it('skips a sheet with no usable columns, with a warning, as long as another sheet works', () => {
    const noActual = { ...bsPlan, periodColumns: bsPlan.periodColumns.map((c) => ({ ...c, actual: false })) };
    const { workbook, warnings } = extractHistoricals([IS, BS], planOf(isPlan, noActual));
    expect(workbook.lines.map((l) => l.name)).toEqual(['Revenue', 'Net Income']);
    expect(warnings.some((w) => w.includes('Sheet "BS": none of the selected periods are on this sheet'))).toBe(true);
  });
});

describe('writeBasisTemplate', () => {
  it('produces a file the existing template parser reads back identically', async () => {
    const { workbook } = extractHistoricals([MODEL], planOf(MODEL_PLAN));
    const parsed = await parseBasisTemplate(await writeBasisTemplate(workbook));
    expect(parsed.periods).toEqual(workbook.periods);
    expect(parsed.lines.map(({ section, name, values }) => ({ section, name, values }))).toEqual(
      workbook.lines.map(({ section, name, values }) => ({ section, name, values })),
    );
  });
});
