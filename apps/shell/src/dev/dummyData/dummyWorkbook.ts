// TEMPORARY test data — see ./README.md. Delete this whole folder to remove it.
//
// A synthetic five-year issuer laid out as a "Basis Template" sheet (see
// lib/parseBasisTemplate.ts: col A section, col B group, col C line name, col D onward one
// period each; rows 1-3 hold period type/date/name). Line names match the Basis Default
// template's names/aliases so the mapping screen auto-matches nearly everything. The numbers
// are derived, not typed, so the balance sheet balances and cash ties to the cash flow
// statement in every actual period. No imports, so `node writeDummyWorkbook.ts` can use it too.

export const DUMMY_COMPANY_NAME = 'Dummy Test Co';
export const DUMMY_WORKBOOK_FILE_NAME = 'dummy-test-co.xlsx';

const YEARS = [2021, 2022, 2023, 2024, 2025];

/** Rows under Balance Sheet › Debt — one per capital-structure tranche. seedDummyIssuer.ts adds
 *  a matching sub-line under each tier and maps it to this row by name. */
export const DUMMY_TRANCHE_ROWS = {
  revolver: 'Revolving Credit Facility',
  termLoan: 'Term Loan B',
  secondLien: 'Second Lien Term Loan',
  notes: 'Senior Unsecured Notes',
} as const;

const round = (n: number) => Math.round(n * 10) / 10;

interface Row {
  section: string;
  group?: string;
  name: string;
  values: number[];
}

function buildRows(): Row[] {
  const n = YEARS.length;
  const revenue = [800, 880, 960, 1030, 1100];
  const pct = (p: number) => revenue.map((r) => round(r * p));

  const cogs = pct(0.38);
  const sm = pct(0.15);
  const rnd = pct(0.09);
  const ga = pct(0.08);
  const ebitda = revenue.map((r, i) => r - cogs[i] - sm[i] - rnd[i] - ga[i]);
  const da = pct(0.04);
  // Capex = D&A, other current assets = other current liabilities, and zero stock comp: the Basis
  // Default template projects none of those cash effects, so this keeps projected checks at 0%.
  const capex = pct(0.04);
  const dividends = revenue.map(() => 100);

  const revolver = [20, 35, 10, 0, 15];
  const termLoan = YEARS.map((_, i) => 650 - 6.5 * i); // 1% annual amortization on 650 face
  const secondLien = YEARS.map(() => 200);
  const notes = YEARS.map(() => 300);
  const totalDebt = YEARS.map((_, i) => revolver[i] + termLoan[i] + secondLien[i] + notes[i]);
  const openingDebt = 1180;

  // ~8% blended cost on the prior year-end balance.
  const interest = totalDebt.map((_, i) => round(0.08 * (i === 0 ? openingDebt : totalDebt[i - 1])));
  const pretax = ebitda.map((e, i) => e - da[i] - interest[i]);
  const tax = pretax.map((p) => round(p * 0.25));
  const netIncome = pretax.map((p, i) => p - tax[i]);

  const ar = revenue.map((r) => round((r * 45) / 365));
  const ap = cogs.map((c) => round((c * 40) / 365));
  const deferredRevenue = pct(0.1);
  const otherCurrentAssets = pct(0.03);
  const otherCurrentLiabilities = pct(0.03);
  const goodwill = revenue.map(() => 1400);
  const otherLtLiabilities = revenue.map(() => 60);

  // Debt flows: revolver draws are borrowings; revolver paydowns and term loan amortization are repayments.
  const borrowings = YEARS.map((_, i) => (i === 0 ? 0 : Math.max(revolver[i] - revolver[i - 1], 0)));
  const repayments = YEARS.map((_, i) => (i === 0 ? 0 : Math.max(revolver[i - 1] - revolver[i], 0) + (termLoan[i - 1] - termLoan[i])));

  const otherLtAssets: number[] = [];
  const apic: number[] = [];
  const cash: number[] = [];
  const retainedEarnings: number[] = [];
  for (let i = 0; i < n; i++) {
    if (i === 0) {
      otherLtAssets.push(120);
      apic.push(400);
      cash.push(120);
      const assets = cash[0] + ar[0] + otherCurrentAssets[0] + goodwill[0] + otherLtAssets[0];
      const liabilities = ap[0] + deferredRevenue[0] + otherCurrentLiabilities[0] + totalDebt[0] + otherLtLiabilities[0];
      retainedEarnings.push(round(assets - liabilities - apic[0]));
      continue;
    }
    otherLtAssets.push(otherLtAssets[i - 1]);
    apic.push(apic[i - 1]);
    retainedEarnings.push(round(retainedEarnings[i - 1] + netIncome[i] - dividends[i]));
    const changeInNwc = ap[i] - ap[i - 1] + (deferredRevenue[i] - deferredRevenue[i - 1]) - (ar[i] - ar[i - 1]);
    const cfo = netIncome[i] + da[i] + changeInNwc;
    cash.push(round(cash[i - 1] + cfo - capex[i] + borrowings[i] - repayments[i] - dividends[i]));
  }

  const r = (values: number[]) => values.map(round);
  return [
    { section: 'Income Statement', name: 'Revenue', values: r(revenue) },
    { section: 'Income Statement', name: 'Cost of Revenue', values: r(cogs) },
    { section: 'Income Statement', name: 'Sales & Marketing', values: r(sm) },
    { section: 'Income Statement', name: 'Research & Development', values: r(rnd) },
    { section: 'Income Statement', name: 'General & Administrative', values: r(ga) },
    { section: 'Income Statement', name: 'Depreciation & Amortization', values: r(da) },
    { section: 'Income Statement', name: 'Net Interest Expense', values: r(interest) },
    { section: 'Income Statement', name: 'Income Tax Expense', values: r(tax) },

    { section: 'Balance Sheet', name: 'Cash & Equivalents', values: r(cash) },
    { section: 'Balance Sheet', name: 'Accounts Receivable', values: r(ar) },
    { section: 'Balance Sheet', name: 'Other Current Assets', values: r(otherCurrentAssets) },
    { section: 'Balance Sheet', name: 'Goodwill & Intangibles', values: r(goodwill) },
    { section: 'Balance Sheet', name: 'Other Long Term Assets', values: r(otherLtAssets) },
    { section: 'Balance Sheet', name: 'Accounts Payable', values: r(ap) },
    { section: 'Balance Sheet', name: 'Deferred Revenue', values: r(deferredRevenue) },
    { section: 'Balance Sheet', name: 'Other Current Liabilities', values: r(otherCurrentLiabilities) },
    { section: 'Balance Sheet', group: 'Debt', name: DUMMY_TRANCHE_ROWS.revolver, values: r(revolver) },
    { section: 'Balance Sheet', group: 'Debt', name: DUMMY_TRANCHE_ROWS.termLoan, values: r(termLoan) },
    { section: 'Balance Sheet', group: 'Debt', name: DUMMY_TRANCHE_ROWS.secondLien, values: r(secondLien) },
    { section: 'Balance Sheet', group: 'Debt', name: DUMMY_TRANCHE_ROWS.notes, values: r(notes) },
    { section: 'Balance Sheet', name: 'Other Long Term Liabilities', values: r(otherLtLiabilities) },
    { section: 'Balance Sheet', name: 'Common Stock & APIC', values: r(apic) },
    { section: 'Balance Sheet', name: 'Retained Earnings', values: r(retainedEarnings) },

    // Present but zero: Cash Flow from Operations adds it with `+`, so a blank would null the whole cash flow.
    { section: 'Cash Flow Statement', name: 'Stock Based Compensation', values: YEARS.map(() => 0) },
    { section: 'Cash Flow Statement', name: 'Capital Expenditures', values: r(capex) },
    { section: 'Cash Flow Statement', name: 'Debt Borrowings', values: r(borrowings) },
    { section: 'Cash Flow Statement', name: 'Debt Repayments', values: r(repayments) },
    { section: 'Cash Flow Statement', name: 'Dividends Paid', values: r(dividends) },

    { section: 'EBITDA', name: 'Restructuring & Severance', values: [12, 8, 5, 3, 0] },
    { section: 'EBITDA', name: 'Transaction & Integration Costs', values: [0, 15, 4, 0, 6] },

    { section: 'Working Capital', name: 'Days Sales Outstanding', values: YEARS.map(() => 45) },
    { section: 'Working Capital', name: 'Days Payable Outstanding', values: YEARS.map(() => 40) },
  ];
}

/** The sheet as an array of rows, ready for XLSX.utils.aoa_to_sheet. */
export function buildDummyWorkbookGrid(): (string | number)[][] {
  const grid: (string | number)[][] = [
    ['', '', '', ...YEARS.map(() => 'FY')],
    ['', '', '', ...YEARS.map((y) => `${y}-12-31`)],
    ['', '', '', ...YEARS.map((y) => `FY ${y}`)],
  ];
  let lastSection = '';
  for (const row of buildRows()) {
    grid.push([row.section === lastSection ? '' : row.section, row.group ?? '', row.name, ...row.values]);
    lastSection = row.section;
  }
  return grid;
}
