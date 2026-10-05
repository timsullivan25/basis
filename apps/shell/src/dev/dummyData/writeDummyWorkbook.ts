// TEMPORARY — see ./README.md. Regenerates dummy-test-co.xlsx next to this file:
//   node apps/shell/src/dev/dummyData/writeDummyWorkbook.ts
// Never imported by the app.
import * as XLSX from 'xlsx';
import { buildDummyWorkbookGrid, DUMMY_WORKBOOK_FILE_NAME } from './dummyWorkbook.ts';

const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(buildDummyWorkbookGrid()), 'Basis Template');
const outPath = new URL(`./${DUMMY_WORKBOOK_FILE_NAME}`, import.meta.url).pathname;
XLSX.writeFile(workbook, outPath);
console.log(`Wrote ${outPath}`);
