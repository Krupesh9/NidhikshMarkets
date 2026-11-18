import 'server-only';
import Papa from 'papaparse';
import ExcelJS from 'exceljs';
import { csvSafe } from '@/lib/sanitize';
import type { DataMeta } from '@/lib/data/types';
import type { LiveScreenRow } from './types';
import { COLUMN_BY_ID, DEFAULT_COLUMNS, type ColumnDef } from './columns';
import { describeFilter, type FilterKey, type FilterState } from './engine';

/** Exportable columns (sparkline is visual-only). Unknown ids are ignored. */
export function exportColumns(ids: string[] | undefined): ColumnDef[] {
  const list = (ids?.length ? ids : DEFAULT_COLUMNS).filter((id) => id !== 'sparkline' && COLUMN_BY_ID[id]);
  if (!list.includes('ticker')) list.unshift('ticker');
  return list.map((id) => COLUMN_BY_ID[id]);
}

export function toCsv(rows: LiveScreenRow[], cols: ColumnDef[]): string {
  const data = rows.map((r) => cols.map((c) => {
    const v = c.get(r);
    // unavailable values export as empty cells (never 0)
    return typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'number' ? '' : csvSafe(v ?? '');
  }));
  return Papa.unparse({ fields: cols.map((c) => c.label), data });
}

export async function toXlsx(rows: LiveScreenRow[], cols: ColumnDef[], ctx: { title: string; filters: FilterState; meta: DataMeta }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Nidhiksh Pulse';
  wb.created = new Date();
  const ws = wb.addWorksheet('Screen', { views: [{ state: 'frozen', xSplit: 1, ySplit: 1 }] });
  ws.columns = cols.map((c) => ({
    header: c.label,
    key: c.id,
    width: c.id === 'name' ? 28 : c.id === 'whyNow' ? 60 : c.format === 'text' || c.format === 'list' ? 18 : 13,
    style: c.numFmt ? { numFmt: c.numFmt } : {},
  }));
  rows.forEach((r) => {
    const rec: Record<string, unknown> = {};
    cols.forEach((c) => {
      const v = c.get(r);
      rec[c.id] = c.format === 'date' && typeof v === 'string' ? new Date(`${v}T00:00:00Z`) : typeof v === 'string' ? csvSafe(v) : typeof v === 'number' && Number.isFinite(v) ? v : null;
    });
    ws.addRow(rec);
  });
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF171B21' } };
  header.alignment = { vertical: 'middle' };
  header.height = 20;
  header.eachCell((cell) => { cell.border = { bottom: { style: 'thin', color: { argb: 'FFFF8A1F' } } }; });
  cols.forEach((c, i) => {
    if (c.format === 'date') ws.getColumn(i + 1).numFmt = 'yyyy-mm-dd';
    if (c.signed) {
      ws.getColumn(i + 1).eachCell((cell, rowNo) => {
        if (rowNo === 1 || typeof cell.value !== 'number') return;
        if (cell.value !== 0) cell.font = { color: { argb: cell.value > 0 ? 'FF15803D' : 'FFB91C1C' } };
      });
    }
  });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };

  const info = wb.addWorksheet('About');
  info.columns = [{ width: 22 }, { width: 80 }];
  info.addRows([
    ['Screen', ctx.title],
    ['Exported', new Date().toISOString()],
    ['Data as of', ctx.meta.asOf],
    ['Provider', `${ctx.meta.provider ?? 'unknown'}${ctx.meta.isMock ? ' (includes simulated demo data)' : ''}`],
    ['Filters', Object.keys(ctx.filters).map((k) => describeFilter(k as FilterKey, ctx.filters)).join('; ') || 'None'],
    ['Sources', ctx.meta.isMock ? 'Demo data' : 'Alpaca (prices), SEC EDGAR (financials, Form 4), Financial Modeling Prep (profiles), Alpha Vantage (earnings calendar)'],
    ['Blank cells', 'Not available from a free source (e.g. short interest, ESG; P/E for funds)'],
    ['Disclaimer', 'Research only — not investment advice.'],
  ]);
  info.getColumn(1).font = { bold: true };
  return Buffer.from(await wb.xlsx.writeBuffer());
}
