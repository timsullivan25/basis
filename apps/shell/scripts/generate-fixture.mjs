// Generates fixtures/basis-template-sample.xlsx: a small synthetic "Basis Template"
// workbook matching parseBasisTemplate.ts's expected layout, sized against the seeded
// default statement schema (see src/data/defaultStatementSchema.ts). Re-run after
// changing that seed content: `node scripts/generate-fixture.mjs`.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as XLSX from 'xlsx';

const PERIODS = ['FY 2023', 'FY 2024', 'FY 2025'];
const PERIOD_DATES = ['2023-12-31', '2024-12-31', '2025-12-31'];

// [section, source line name, values for FY23/24/25]. Names are a deliberate mix of
// exact matches, alias matches (against defaultStatementSchema.ts's seeded aliases),
// and two omissions ("Other Current Assets" / "Other Long Term Liabilities" have no
// row here) so the mapping screen has real unmatched lines to exercise manual review.
const ROWS = [
  ['Income Statement', 'Revenue', [420, 470, 528]],
  ['Income Statement', 'COGS', [145, 158, 172]],
  ['Income Statement', 'S&M', [92, 98, 104]],
  ['Income Statement', 'R&D', [58, 63, 69]],
  ['Income Statement', 'General & Administrative', [41, 44, 47]],
  ['Income Statement', 'D&A', [22, 24, 26]],
  ['Income Statement', 'Net Interest Expense', [18, 17, 15]],
  ['Income Statement', 'Income Tax Expense', [12, 15, 19]],
  ['Balance Sheet', 'Cash & Equivalents', [85, 102, 128]],
  ['Balance Sheet', 'AR', [48, 54, 61]],
  ['Balance Sheet', 'Goodwill & Intangibles', [610, 598, 586]],
  ['Balance Sheet', 'Other Long Term Assets', [34, 36, 38]],
  ['Balance Sheet', 'AP', [22, 24, 27]],
  ['Balance Sheet', 'Unearned Revenue', [134, 149, 168]],
  ['Balance Sheet', 'Other Current Liabilities', [29, 31, 33]],
  ['Balance Sheet', 'Total Borrowings', [420, 390, 355]],
  ['Cash Flow Statement', 'SBC', [14, 16, 18]],
  ['Cash Flow Statement', 'Capex', [19, 21, 23]],
  ['EBITDA', 'Restructuring & Severance', [6, 3, 0]],
  ['EBITDA', 'Transaction & Integration Costs', [9, 4, 0]],
  ['Working Capital', 'Days Sales Outstanding', [41, 42, 42]],
  ['Working Capital', 'Days Payable Outstanding', [28, 28, 29]],
];

const grid = [
  ['', '', ...PERIODS.map(() => 'FY')],
  ['', '', ...PERIOD_DATES],
  ['', '', ...PERIODS],
];

let lastSection = '';
for (const [section, name, values] of ROWS) {
  grid.push([section === lastSection ? '' : section, name, ...values]);
  lastSection = section;
}

const sheet = XLSX.utils.aoa_to_sheet(grid);
const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, sheet, 'Basis Template');

const outPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'basis-template-sample.xlsx');
XLSX.writeFile(workbook, outPath);
console.log(`Wrote ${outPath}`);
