import { describe, expect, it } from 'vitest';
import { missingConceptsFor } from './analysisAvailability';
import { ANALYSIS_CATALOG } from '../data/analysisCatalog';
import type { AnalysisCatalogEntry } from '../data/analysisCatalog';
import type { StatementLine, StatementSchema } from '../data';

function line(id: string, name: string, aliases: string[] = []): StatementLine {
  return {
    id, name, role: 'required', rowFormat: 'normal', numberFormat: 'number', sign: 'natural', aggregation: 'sum',
    formula: null, projection: null, aliases,
  };
}

function schema(lines: StatementLine[]): StatementSchema {
  return { id: 's1', name: 'Test', createdAt: '', updatedAt: '', sections: [{ id: 'sec', name: 'Section', lines }], drivers: [] };
}

const dcfEntry = ANALYSIS_CATALOG.find((e) => e.id === 'dcf') as AnalysisCatalogEntry;

describe('missingConceptsFor', () => {
  it('lists every required concept as missing on an empty schema', () => {
    expect(missingConceptsFor(schema([]), dcfEntry)).toEqual(['ebit', 'da', 'capex', 'nwc', 'taxRate']);
  });

  it('lists nothing missing once every required concept resolves', () => {
    const s = schema([
      line('op-income', 'Operating Income', ['EBIT']),
      line('da', 'Depreciation & Amortization', ['D&A']),
      line('capex', 'Capital Expenditures', ['Capex']),
      line('nwc', 'Net Working Capital'),
      line('tax-rate', 'Effective Tax Rate'),
    ]);
    expect(missingConceptsFor(s, dcfEntry)).toEqual([]);
  });

  it('lists exactly the concepts still unresolved on a partially-supported schema', () => {
    const s = schema([
      line('op-income', 'Operating Income', ['EBIT']),
      line('da', 'Depreciation & Amortization', ['D&A']),
      line('capex', 'Capital Expenditures', ['Capex']),
      // no line for Net Working Capital or an effective tax rate
    ]);
    expect(missingConceptsFor(s, dcfEntry)).toEqual(['nwc', 'taxRate']);
  });

  it('matches the DCF catalog entry\'s own default-schema reality: 4 of 5 concepts resolve out of the box', () => {
    // Mirrors defaultStatementSchema.ts's actual aliases (EBIT/D&A/Capex) and exact-name line
    // (Net Working Capital) — only the tax-rate concept has nothing to resolve against yet.
    const s = schema([
      line('op-income', 'Operating Income', ['EBIT']),
      line('da', 'Depreciation & Amortization', ['D&A']),
      line('capex', 'Capital Expenditures', ['Capex']),
      line('nwc', 'Net Working Capital'),
    ]);
    expect(missingConceptsFor(s, dcfEntry)).toEqual(['taxRate']);
  });
});
