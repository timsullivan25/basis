import type { StatementSchema, StatementSection } from './types';

function emptySection(name: string): StatementSection {
  return { id: crypto.randomUUID(), name, lines: [] };
}

/** Seeded once, the first time no schema has been saved yet. Fully editable afterward. */
export function createDefaultStatementSchema(): StatementSchema {
  return {
    sections: [
      emptySection('Income Statement'),
      emptySection('Balance Sheet'),
      emptySection('Cash Flow Statement'),
      emptySection('EBITDA'),
      emptySection('Working Capital'),
      emptySection('Credit Metrics'),
    ],
  };
}
