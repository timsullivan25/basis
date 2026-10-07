# Dummy test data (temporary)

A synthetic issuer, **Dummy Test Co**, for exercising every analysis without a real file.

In the app, open **Portfolio → Test data**:

- **Create dummy issuer** builds a complete issuer in one click: Basis Default template, FY2021–FY2025 actuals, four debt tranches (Revolver and Term Loan B under 1L, a Second Lien Term Loan, Senior Unsecured Notes), EBITDA adjustments, 5 projected years, a Downside scenario, and DCF, LBO and Recovery Waterfall switched on with inputs filled in. Balance sheet and cash flow checks tie to 0.0% in every period. It also adds an Effective Tax Rate line, so the tax rate starts out Linked. Switch it to Input on an analysis's Lines used card to try the flat-rate path.
- **Download dummy workbook** gives you the same data as a Basis Template `.xlsx` for testing the upload and mapping flow by hand. A committed copy is in this folder as `dummy-test-co.xlsx`.
- **Remove all dummy issuers** deletes every issuer named "Dummy Test Co…" along with its model, mapping, scenarios, analyses and cached results.

Starting assumptions: 7% → 4% revenue growth (the Downside scenario uses −5% → 2%), $75 minimum cash, 9% WACC and 2.5% terminal growth, and recovery at 3.0x FY2025 EBITDA with admin claims at 2.5% of value. At those numbers the unsecured notes are the fulcrum.

## Files

- `dummyWorkbook.ts` holds the numbers. They're derived so the statements tie, not typed in.
- `seedDummyIssuer.ts` creates and removes the issuer.
- `DummyDataControls.tsx` is the Test data menu.
- `writeDummyWorkbook.ts` regenerates the `.xlsx`. Run `node apps/shell/src/dev/dummyData/writeDummyWorkbook.ts`.

## Removing it

1. Delete this folder.
2. In `src/screens/PortfolioScreen.tsx`, delete the `DummyDataControls` import (marked "TEMPORARY test data") and the `<DummyDataControls … />` line.
