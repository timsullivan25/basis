import { describe, expect, it } from 'vitest';
import { createBundledTemplates } from './index';
import { DEFAULT_SCHEMA_ID } from '../defaultStatementSchema';

describe('bundled templates', () => {
  it('have unique ids distinct from the built-in default, and a role on every line', () => {
    const templates = createBundledTemplates();
    const ids = [DEFAULT_SCHEMA_ID, ...templates.map((t) => t.id)];
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of templates) {
      for (const line of t.sections.flatMap((s) => s.lines)) expect(line.role).toBeTruthy();
    }
  });

  it('sum every current-liability line into the current-liabilities total', () => {
    // Regression: the abbreviated model's Working Capital "Current Liabilities" omitted
    // Accrued Expenses, so it never reached Net Working Capital, Change in NWC or cash.
    const cases = [
      { section: 'Working Capital', total: 'Current Liabilities' },
      { section: 'Balance Sheet', total: 'Total Current Liabilities' },
    ];
    const parts = ['Accounts Payable', 'Accrued Expenses', 'Other Current Liabilities'];
    for (const t of createBundledTemplates()) {
      for (const { section, total } of cases) {
        const lines = t.sections.find((s) => s.name === section)?.lines ?? [];
        const totalLine = lines.find((l) => l.name === total);
        if (!totalLine) continue;
        const formula = totalLine.formula as unknown as { args?: { kind: string; lineId?: string }[] };
        const refs = (formula.args ?? []).filter((a) => a.kind === 'ref').map((a) => a.lineId);
        const expected = parts.map((name) => lines.find((l) => l.name === name)?.id);
        expect(expected.every(Boolean), `${t.name} / ${section} has all liability lines`).toBe(true);
        expect(refs, `${t.name} / ${section} / ${total}`).toEqual(expected);
      }
    }
  });
});
