import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { titleCase, cleanCompanyName, companyKey, dedupeShareClasses, parseAsOf, parseNasdaqRows, parseSsgaRows, parseSsgaXlsx, sectorWeights, toNumber } from '../holdings';

async function ssgaWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('holdings');
  ws.addRow(['Fund Name:', 'SPDR S&P 500 ETF Trust']);
  ws.addRow(['Ticker Symbol:', 'SPY']);
  ws.addRow(['Holdings:', 'As of 16-Nov-2026']);
  ws.addRow([]);
  ws.addRow(['Name', 'Ticker', 'Identifier', 'SEDOL', 'Weight', 'Sector', 'Shares Held', 'Local Currency']);
  ws.addRow(['APPLE INC', 'AAPL', '037833100', '2046251', 8.041495, '-', 180526549, 'USD']);
  ws.addRow(['MICROSOFT CORP', 'MSFT', '594918104', '2588173', 6.007583, '-', 91851588, 'USD']);
  ws.addRow(['ALPHABET INC CL A', 'GOOGL', '02079K305', 'BYVY8G0', 2.600561, '-', 72591434, 'USD']);
  ws.addRow(['ALPHABET INC CL C', 'GOOG', '02079K107', 'BYY88Y7', 2.08821, '-', 58799602, 'USD']);
  ws.addRow(['BERKSHIRE HATHAWAY INC CL B', 'BRK.B', 'x', 'y', 1.5, 'Financials', 1, 'USD']);
  ws.addRow(['US DOLLAR', 'CASH_USD', '', '', 0.1, '-', 1, 'USD']);
  ws.addRow([]);
  ws.addRow([{ richText: [{ text: 'Before investing in a fund, consider its investment objectives…' }] }]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('SSGA holdings XLSX', () => {
  it('finds the header row, the as-of date and parses rows until the blank line', async () => {
    const p = await parseSsgaXlsx(await ssgaWorkbook());
    expect(p.asOf).toBe('2026-11-16');
    expect(p.fund).toBe('SPDR S&P 500 ETF Trust');
    expect(p.holdings.map((h) => h.ticker)).toEqual(['AAPL', 'MSFT', 'GOOGL', 'GOOG', 'BRK.B']);
    expect(p.holdings[0].weight).toBeCloseTo(0.08041495, 8);
    expect(p.holdings[0].sector).toBeUndefined(); // "-" is not a sector
    expect(p.holdings[4].sector).toBe('Financials');
  });

  it('works when the header sits in a different column / row', () => {
    const rows = [[], ['', 'Holdings:', 'As of 02-Jan-2026'], [], ['', '', 'Ticker', 'Name', 'Weight (%)'], ['', '', 'GS', 'GOLDMAN SACHS', '10.25']];
    const p = parseSsgaRows(rows);
    expect(p.asOf).toBe('2026-01-02');
    expect(p.holdings).toEqual([{ ticker: 'GS', name: 'Goldman Sachs', weight: 0.1025 }]);
  });

  it('returns no holdings when there is no header', () => {
    expect(parseSsgaRows([['foo'], ['bar']]).holdings).toEqual([]);
  });
});

describe('Nasdaq API rows', () => {
  const ndx = {
    data: {
      date: 'Nov 16, 2026',
      data: {
        rows: [
          { symbol: 'AAPL', sector: '', companyName: 'Apple Inc. Common Stock', marketCap: '5,126,663,165,960', lastSalePrice: '$352.78', netChange: '$3.49', percentageChange: '-0.98%' },
          { symbol: 'GOOGL', sector: '', companyName: 'Alphabet Inc. Class A Common Stock', marketCap: '3,488,053,680,000', lastSalePrice: '$283.72', netChange: '-12.05', percentageChange: '-4.074%' },
          { symbol: 'GOOG', sector: '', companyName: 'Alphabet Inc. Class C Capital Stock', marketCap: '3,457,810,440,000', lastSalePrice: '$281.26', netChange: '-11.26', percentageChange: '-3.849%' },
          { symbol: 'BAD', companyName: 'No Cap Inc.', marketCap: 'NA' },
        ],
      },
    },
  };

  it('parses list-type rows (numbers with commas, $ and %)', () => {
    const p = parseNasdaqRows(ndx);
    expect(p.asOf).toBe('2026-11-16');
    expect(p.rows).toHaveLength(3);
    expect(p.rows[0]).toMatchObject({ ticker: 'AAPL', name: 'Apple Inc.', marketCap: 5126663165960, price: 352.78, changePct: -0.98 });
  });

  it('parses screener rows (table.rows, lastsale/pctchange, BRK/B)', () => {
    const p = parseNasdaqRows({ data: { table: { rows: [{ symbol: 'BRK/B', name: 'Berkshire Hathaway Inc.', lastsale: '$593.17', pctchange: '0.039%', marketCap: '1308717715936.00', sector: 'Finance' }] } } });
    expect(p.rows[0]).toMatchObject({ ticker: 'BRK.B', marketCap: 1308717715936, changePct: 0.039, sector: 'Finance' });
  });

  it('merges share classes using max market cap (each class reports the whole company)', () => {
    const rows = parseNasdaqRows(ndx).rows;
    const merged = dedupeShareClasses(rows, (r) => r.marketCap, (r, v) => ({ ...r, marketCap: v }), 'max');
    expect(merged.map((r) => r.ticker)).toEqual(['AAPL', 'GOOGL']);
    expect(merged[1].classes).toEqual(['GOOG']);
    expect(merged[1].marketCap).toBe(3488053680000);
  });
});

describe('share-class dedupe and helpers', () => {
  it('sums fund weights across classes and keeps the larger ticker', () => {
    const merged = dedupeShareClasses(
      [{ ticker: 'GOOG', name: 'ALPHABET INC CL C', weight: 0.02 } as { ticker: string; name: string; weight: number; classes?: string[] }, { ticker: 'AAPL', name: 'APPLE INC', weight: 0.08 }, { ticker: 'GOOGL', name: 'ALPHABET INC CL A', weight: 0.026 }],
      (h) => h.weight, (h, v) => ({ ...h, weight: v }), 'sum');
    expect(merged.map((h) => h.ticker)).toEqual(['AAPL', 'GOOGL']);
    expect(merged[1].weight).toBeCloseTo(0.046, 6);
    expect(merged[1].classes).toEqual(['GOOG']);
  });

  it('does not merge different companies', () => {
    expect(companyKey('META PLATFORMS INC CLASS A')).toBe('meta platforms');
    expect(companyKey('Microsoft Corporation Common Stock')).not.toBe(companyKey('Meta Platforms, Inc. Class A Common Stock'));
    expect(companyKey('News Corp Class A Common Stock')).toBe(companyKey('NEWS CORP CL B'));
  });

  it('title-cases all-caps fund names only', () => {
    expect(titleCase('ELI LILLY + CO')).toBe('Eli Lilly + Co');
    expect(titleCase('TRAVELERS COS INC/THE')).toBe('Travelers Cos Inc/The');
    expect(titleCase('Apple Inc.')).toBe('Apple Inc.');
  });

  it('cleans names, numbers and dates', () => {
    expect(cleanCompanyName('Alphabet Inc. Class C Capital Stock')).toBe('Alphabet Inc.');
    expect(toNumber('5,126,663,165,960')).toBe(5126663165960);
    expect(toNumber('-')).toBeNaN();
    expect(parseAsOf('As of 16-Nov-2026')).toBe('2026-11-16');
    expect(parseAsOf('Nov 6, 2026')).toBe('2026-11-06');
  });

  it('sector weights normalise and put Unclassified last', () => {
    const { sectors, coverage } = sectorWeights(
      [{ ticker: 'A', weight: 0.5 }, { ticker: 'B', weight: 0.3 }, { ticker: 'C', weight: 0.2 }],
      (t) => ({ A: 'Technology', C: 'Finance' } as Record<string, string>)[t]);
    expect(sectors.map((s) => s.sector)).toEqual(['Technology', 'Finance', 'Unclassified']);
    expect(coverage).toBeCloseTo(0.7);
  });
});
