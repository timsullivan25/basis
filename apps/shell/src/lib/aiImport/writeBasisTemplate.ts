import type { ParsedWorkbook } from '../../data';

/**
 * Renders parsed periods and lines as a "Basis Template" workbook — the exact layout `parseBasisTemplate`
 * reads (A = section, B = group, C = line name, D+ = periods; rows 1-3 = type / date / name), so an AI-extracted file
 * flows through the normal import untouched and can be downloaded and inspected by a human.
 */
export async function writeBasisTemplate(workbook: ParsedWorkbook): Promise<Blob> {
  const XLSX = await import('xlsx');
  const dateOnly = (iso: string) => (iso ? iso.slice(0, 10) : '');

  const rows: (string | number | null)[][] = [
    ['', '', 'Type', ...workbook.periods.map((p) => p.type)],
    ['', '', 'Date', ...workbook.periods.map((p) => dateOnly(p.date))],
    ['', '', 'Period', ...workbook.periods.map((p) => p.name)],
  ];
  let previousSection = '';
  for (const line of workbook.lines) {
    rows.push([line.section === previousSection ? '' : line.section, line.group ?? '', line.name, ...line.values]);
    previousSection = line.section;
  }

  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), 'Basis Template');
  const bytes = XLSX.write(book, { type: 'array', bookType: 'xlsx' });
  return new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
