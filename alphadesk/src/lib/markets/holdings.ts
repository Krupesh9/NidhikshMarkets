import 'server-only';
import { cache } from '@/lib/cache';
import { log } from '@/lib/log';
import { meteredFetch } from '@/lib/usage-meter';

/**
 * Index constituents from free, daily, public sources (no keys):
 *  - S&P 500 / Dow: State Street SPDR daily holdings XLSX for SPY / DIA (fund weights ≈ index weights).
 *  - Nasdaq 100: Nasdaq.com list-type API (no weights → approximate weight by market cap).
 *  - Nasdaq Composite: Nasdaq.com stock screener for Nasdaq-listed companies, sorted by market cap.
 *  - S&P 100: no free file; top names ranked by their S&P 500 weight (labelled).
 * Sector weights use Nasdaq.com's sector classification (one screener download, cached 12h).
 * Everything is cached 12h; failures return null and are retried after 10 minutes. Never throws.
 */

export interface Holding {
  ticker: string;
  name: string;
  /** 0-1 */
  weight: number;
  sector?: string;
  /** other share classes merged into this company (e.g. GOOG for GOOGL) */
  classes?: string[];
}

export interface IndexHoldings {
  slug: string;
  asOf: string | null;
  source: { name: string; url: string };
  /** how the list / weights were produced (shown in the UI footer) */
  method: string;
  /** column label for `weight` */
  weightLabel: string;
  top10: Holding[];
  sectors: { sector: string; weight: number }[];
  sectorSource?: { name: string; url: string; coverage: number };
  /** constituents in the source file */
  count: number;
}

const TTL = 12 * 60 * 60_000;
const FAIL_TTL = 10 * 60_000;
const TIMEOUT = 15_000;
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export const SSGA_XLSX = (etf: string) => `https://www.ssga.com/library-content/products/fund-data/etfs/us/holdings-daily-us-en-${etf.toLowerCase()}.xlsx`;
export const SSGA_PAGE = (etf: string) => `https://www.ssga.com/us/en/intermediary/etfs/funds/${etf.toLowerCase()}`;
const NASDAQ100_API = 'https://api.nasdaq.com/api/quote/list-type/nasdaq100';
const NASDAQ_SCREENER_API = 'https://api.nasdaq.com/api/screener/stocks?tableonly=true&exchange=NASDAQ&limit=25&download=false';
const NASDAQ_ALL_API = 'https://api.nasdaq.com/api/screener/stocks?tableonly=true&download=true';

/* --------------------------------- parsing --------------------------------- */

/** Plain text of an exceljs cell value (string, number, rich text, hyperlink, formula result). */
export function cellText(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const o = v as { richText?: { text: string }[]; text?: unknown; result?: unknown };
    if (Array.isArray(o.richText)) return o.richText.map((r) => r.text).join('').trim();
    if (o.text != null) return cellText(o.text);
    if (o.result != null) return cellText(o.result);
  }
  return '';
}

/** "1,234.5" / "$352.78" / "-0.98%" / 8.04 → number (NaN when not numeric). */
export function toNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  const s = cellText(v).replace(/[$,%\s]/g, '');
  if (!s || s === '-' || s.toUpperCase() === 'NA') return NaN;
  return Number(s);
}

const MONTHS: Record<string, string> = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
/** "As of 16-Nov-2026" / "Nov 16, 2026" → "2026-11-16" (null when not found). */
export function parseAsOf(s: string): string | null {
  let m = /(\d{1,2})-([A-Za-z]{3})-(\d{4})/.exec(s);
  if (m && MONTHS[m[2].toLowerCase()]) return `${m[3]}-${MONTHS[m[2].toLowerCase()]}-${m[1].padStart(2, '0')}`;
  m = /([A-Za-z]{3})[a-z]*\.? (\d{1,2}), (\d{4})/.exec(s);
  if (m && MONTHS[m[1].toLowerCase()]) return `${m[3]}-${MONTHS[m[1].toLowerCase()]}-${m[2].padStart(2, '0')}`;
  m = /(\d{4}-\d{2}-\d{2})/.exec(s);
  return m ? m[1] : null;
}

const KEEP_UPPER = new Set(['AG', 'NV', 'SA', 'PLC', 'ETF', 'REIT', 'II', 'III', 'US', 'USA', 'AT&T', 'IBM', 'CL', 'LLC', 'LP']);
/** "ELI LILLY + CO" → "Eli Lilly + Co"; leaves mixed-case names alone. */
export function titleCase(name: string): string {
  if (name !== name.toUpperCase()) return name;
  return name.split(/(\s+)/).map((w) => (KEEP_UPPER.has(w.replace(/[.,]/g, '')) ? w : w.toLowerCase().replace(/(^|[-/.&'(])([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase()))).join('');
}

/** Normalise exchange-specific share-class tickers: "BRK/B" → "BRK.B". */
export const normTicker = (t: string) => t.trim().toUpperCase().replace(/\//g, '.');

/**
 * Parse SSGA holdings rows (each row = array of cell values). Finds the header row containing
 * Name / Ticker / Weight, reads the "As of" line above it, then reads holdings until the first blank row.
 * Weights in the file are percents (8.04) → returned as fractions (0.0804).
 */
export function parseSsgaRows(rows: unknown[][]): { asOf: string | null; fund: string | null; holdings: Holding[] } {
  let asOf: string | null = null;
  let fund: string | null = null;
  let header = -1;
  let col = { name: -1, ticker: -1, weight: -1, sector: -1 };
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const cells = (rows[i] ?? []).map(cellText);
    const lower = cells.map((c) => c.toLowerCase());
    const joined = cells.join(' ');
    if (!asOf && /as of/i.test(joined)) asOf = parseAsOf(joined);
    if (!fund && /^fund name/i.test(lower.find((c) => c) ?? '')) fund = cells.filter(Boolean)[1] ?? null;
    const name = lower.indexOf('name');
    const ticker = lower.indexOf('ticker');
    const weight = lower.findIndex((c) => c.startsWith('weight'));
    if (name >= 0 && ticker >= 0 && weight >= 0) {
      header = i;
      col = { name, ticker, weight, sector: lower.indexOf('sector') };
      break;
    }
  }
  if (header < 0) return { asOf, fund, holdings: [] };
  const holdings: Holding[] = [];
  for (let i = header + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const name = cellText(r[col.name]);
    const ticker = cellText(r[col.ticker]);
    if (!name && !ticker) break; // blank row ends the table (disclaimer text follows)
    const w = toNumber(r[col.weight]);
    if (!Number.isFinite(w) || !/^[A-Z][A-Z0-9./-]{0,9}$/i.test(ticker) || /^CASH|^-$/i.test(ticker)) continue;
    const sector = col.sector >= 0 ? cellText(r[col.sector]) : '';
    holdings.push({ ticker: normTicker(ticker), name: titleCase(name), weight: w / 100, ...(sector && sector !== '-' ? { sector } : {}) });
  }
  return { asOf, fund, holdings };
}

/** Read an SSGA XLSX buffer with exceljs and parse its first worksheet. */
export async function parseSsgaXlsx(buf: ArrayBuffer | Buffer): Promise<ReturnType<typeof parseSsgaRows>> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return { asOf: null, fund: null, holdings: [] };
  const rows: unknown[][] = [];
  ws.eachRow({ includeEmpty: true }, (row, n) => {
    const vals = Array.isArray(row.values) ? (row.values as unknown[]).slice(1) : [];
    rows[n - 1] = vals;
  });
  for (let i = 0; i < rows.length; i++) rows[i] = rows[i] ?? [];
  return parseSsgaRows(rows);
}

export interface NasdaqRow { ticker: string; name: string; marketCap: number; price: number; changePct: number; sector?: string; classes?: string[] }

/** Rows from api.nasdaq.com list-type (nasdaq100) or screener responses. */
export function parseNasdaqRows(json: unknown): { asOf: string | null; rows: NasdaqRow[] } {
  const d = (json as { data?: { date?: string; data?: { rows?: unknown[] }; table?: { rows?: unknown[] }; rows?: unknown[] } } | null)?.data;
  const raw = (d?.data?.rows ?? d?.table?.rows ?? d?.rows ?? []) as Record<string, unknown>[];
  const rows: NasdaqRow[] = [];
  for (const r of raw) {
    const ticker = normTicker(String(r.symbol ?? ''));
    const marketCap = toNumber(r.marketCap);
    if (!ticker || !Number.isFinite(marketCap) || marketCap <= 0) continue;
    const sector = cellText(r.sector);
    rows.push({
      ticker,
      name: cleanCompanyName(String(r.companyName ?? r.name ?? ticker)),
      marketCap,
      price: toNumber(r.lastSalePrice ?? r.lastsale),
      changePct: toNumber(r.percentageChange ?? r.pctchange),
      ...(sector ? { sector } : {}),
    });
  }
  return { asOf: d?.date ? parseAsOf(d.date) : null, rows };
}

/** "Apple Inc. Common Stock" → "Apple Inc."; "Alphabet Inc. Class C Capital Stock" → "Alphabet Inc." */
export function cleanCompanyName(name: string): string {
  return name
    .replace(/\s+(Class|Cl\.?|Series)\s+[A-Z]\b.*$/i, '')
    .replace(/\s+(Common Stock|Common Shares|Ordinary Shares|Capital Stock|American Depositary Shares).*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Company identity used to merge share classes: "ALPHABET INC CL A" and "Alphabet Inc. Class C" → "alphabet". */
export function companyKey(name: string): string {
  return cleanCompanyName(name)
    .toLowerCase()
    .replace(/[.,/&+'’()-]/g, ' ')
    .replace(/\b(inc|incorporated|corp|corporation|co|company|ltd|plc|holdings?|group|the|new|sa|nv|ag)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Merge share classes of the same company (GOOGL + GOOG, FOXA + FOX, NWSA + NWS). The first (largest) row keeps
 * its ticker; others go to `classes`. `mode` decides how values combine: 'sum' for fund weights,
 * 'max' for market caps (Nasdaq quotes each class with the whole company's market cap).
 */
export function dedupeShareClasses<T extends { ticker: string; name: string; classes?: string[] }>(rows: T[], value: (r: T) => number, set: (r: T, v: number) => T, mode: 'sum' | 'max'): T[] {
  const out: T[] = [];
  const byKey = new Map<string, number>();
  for (const r of [...rows].sort((a, b) => value(b) - value(a))) {
    const key = companyKey(r.name) || r.ticker;
    const idx = byKey.get(key);
    if (idx == null) {
      byKey.set(key, out.length);
      out.push({ ...r });
      continue;
    }
    const cur = out[idx];
    const v = mode === 'sum' ? value(cur) + value(r) : Math.max(value(cur), value(r));
    out[idx] = set({ ...cur, classes: [...(cur.classes ?? []), r.ticker] }, v);
  }
  return out.sort((a, b) => value(b) - value(a));
}

/** Sum weights by sector; unknown sectors grouped as "Unclassified". `coverage` = weight share with a sector. */
export function sectorWeights(holdings: { ticker: string; weight: number }[], sectorOf: (t: string) => string | undefined): { sectors: { sector: string; weight: number }[]; coverage: number } {
  const total = holdings.reduce((s, h) => s + h.weight, 0) || 1;
  const m = new Map<string, number>();
  let known = 0;
  for (const h of holdings) {
    const s = sectorOf(h.ticker);
    if (s) known += h.weight;
    m.set(s || 'Unclassified', (m.get(s || 'Unclassified') ?? 0) + h.weight / total);
  }
  const sectors = [...m.entries()].map(([sector, weight]) => ({ sector, weight })).sort((a, b) => (a.sector === 'Unclassified' ? 1 : b.sector === 'Unclassified' ? -1 : b.weight - a.weight));
  return { sectors, coverage: known / total };
}

/* --------------------------------- fetching -------------------------------- */

async function fetchOk(url: string, accept: string): Promise<Response> {
  const r = await meteredFetch('holdings', url, { headers: { 'user-agent': BROWSER_UA, accept, 'accept-language': 'en-US,en;q=0.9' }, cache: 'no-store', redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r;
}

/** Cache successes for 12h and failures (null) for 10 minutes. */
async function cached<T>(key: string, fn: () => Promise<T | null>): Promise<T | null> {
  const hit = cache.get<{ v: T | null }>(key);
  if (hit) return hit.v;
  return cache.wrap(`${key}:inflight`, async () => {
    let v: T | null = null;
    try { v = await fn(); } catch (e) { log.debug('holdings.failed', { key, err: (e as Error).message }); }
    cache.set(key, { v }, v ? TTL : FAIL_TTL);
    return v;
  }, 1_000);
}

const ssga = (etf: string) => cached(`holdings:v2:ssga:${etf}`, async () => {
  const r = await fetchOk(SSGA_XLSX(etf), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,*/*');
  const parsed = await parseSsgaXlsx(Buffer.from(await r.arrayBuffer()));
  return parsed.holdings.length ? parsed : null;
});

const nasdaqJson = (key: string, url: string) => cached(`holdings:nasdaq:${key}`, async () => {
  const r = await fetchOk(url, 'application/json, text/plain, */*');
  const parsed = parseNasdaqRows(await r.json());
  return parsed.rows.length ? parsed : null;
});

/** Ticker → Nasdaq.com sector for every US-listed stock (≈7k rows, one ~2 MB download per 12h). */
async function sectorMap(): Promise<Map<string, string> | null> {
  const all = await nasdaqJson('all', NASDAQ_ALL_API);
  if (!all) return null;
  return new Map(all.rows.filter((r) => r.sector).map((r) => [r.ticker, r.sector!]));
}

const NASDAQ_SECTORS = { name: 'Nasdaq.com sector classification', url: 'https://www.nasdaq.com/market-activity/stocks/screener' };

async function withSectors(base: Omit<IndexHoldings, 'sectors' | 'sectorSource'>, all: Holding[]): Promise<IndexHoldings> {
  const map = await sectorMap();
  if (!map) return { ...base, sectors: [] };
  const { sectors, coverage } = sectorWeights(all, (t) => map.get(t) ?? map.get(t.replace('.', '/')));
  const top10 = base.top10.map((h) => ({ ...h, sector: h.sector ?? map.get(h.ticker) }));
  // Only show the breakdown when most of the index weight could be classified.
  return coverage >= 0.7 ? { ...base, top10, sectors, sectorSource: { ...NASDAQ_SECTORS, coverage } } : { ...base, top10, sectors: [] };
}

const byWeight = (rows: Holding[]) => dedupeShareClasses(rows, (h) => h.weight, (h, v) => ({ ...h, weight: v }), 'sum');

async function fromSsga(slug: string, etf: string, indexName: string): Promise<IndexHoldings | null> {
  const p = await ssga(etf);
  if (!p) return null;
  const merged = byWeight(p.holdings);
  return withSectors({
    slug,
    asOf: p.asOf,
    source: { name: `State Street ${etf} daily holdings`, url: SSGA_PAGE(etf) },
    method: `${etf} ETF weights (tracks the ${indexName}); share classes merged`,
    weightLabel: 'Weight',
    top10: merged.slice(0, 10),
    count: p.holdings.length,
  }, merged);
}

async function nasdaq100(): Promise<IndexHoldings | null> {
  const p = await nasdaqJson('ndx', NASDAQ100_API);
  if (!p) return null;
  const merged = dedupeShareClasses(p.rows, (r) => r.marketCap, (r, v) => ({ ...r, marketCap: v }), 'max');
  const total = merged.reduce((s, r) => s + r.marketCap, 0) || 1;
  const all: Holding[] = merged.map((r) => ({ ticker: r.ticker, name: r.name, weight: r.marketCap / total, ...(r.classes ? { classes: r.classes } : {}) }));
  return withSectors({
    slug: 'nasdaq100',
    asOf: p.asOf,
    source: { name: 'Nasdaq.com Nasdaq-100 constituents', url: 'https://www.nasdaq.com/market-activity/quotes/nasdaq-ndx-index' },
    method: '≈ weight by market cap (the index uses modified cap weighting); share classes merged',
    weightLabel: '≈ Weight',
    top10: all.slice(0, 10),
    count: p.rows.length,
  }, all);
}

async function nasdaqComposite(): Promise<IndexHoldings | null> {
  const [top, all] = await Promise.all([nasdaqJson('comp', NASDAQ_SCREENER_API), nasdaqJson('all-nasdaq', NASDAQ_SCREENER_API.replace('limit=25&download=false', 'download=true'))]);
  const src = top ?? all;
  if (!src) return null;
  const rowsAll = all?.rows ?? src.rows;
  const merged = dedupeShareClasses(rowsAll, (r) => r.marketCap, (r, v) => ({ ...r, marketCap: v }), 'max');
  const total = merged.reduce((s, r) => s + r.marketCap, 0) || 1;
  const holdings: Holding[] = merged.map((r) => ({ ticker: r.ticker, name: r.name, weight: r.marketCap / total, ...(r.sector ? { sector: r.sector } : {}), ...(r.classes ? { classes: r.classes } : {}) }));
  const base = {
    slug: 'nasdaq',
    asOf: src.asOf ?? new Date().toISOString().slice(0, 10),
    source: { name: 'Nasdaq.com stock screener (Nasdaq-listed)', url: 'https://www.nasdaq.com/market-activity/stocks/screener?exchange=NASDAQ' },
    method: all ? 'Largest Nasdaq-listed companies by market cap; ≈ weight = market cap ÷ all Nasdaq-listed market cap' : 'Largest Nasdaq-listed companies by market cap (share of the top 25 shown)',
    weightLabel: '≈ Weight',
    top10: holdings.slice(0, 10),
    count: all ? all.rows.length : src.rows.length,
  };
  if (!all) return { ...base, sectors: [] };
  const { sectors, coverage } = sectorWeights(holdings, (t) => holdings.find((h) => h.ticker === t)?.sector);
  return coverage >= 0.7 ? { ...base, sectors, sectorSource: { ...NASDAQ_SECTORS, coverage } } : { ...base, sectors: [] };
}

async function sp100(): Promise<IndexHoldings | null> {
  const spx = await fromSsga('sp500', 'SPY', 'S&P 500');
  if (!spx) return null;
  return {
    ...spx,
    slug: 'sp100',
    method: 'Ranked by S&P 500 weight (the S&P 100 holds the same mega-caps; its own constituent file needs a paid feed)',
    weightLabel: 'S&P 500 wt',
    sectors: [],
    sectorSource: undefined,
    count: 101,
  };
}

/** Top-10 holdings + sector weights for an index slug. Null when the slug has no source or the source failed. */
export async function getIndexHoldings(slug: string): Promise<IndexHoldings | null> {
  try {
    switch (slug) {
      case 'sp500': return await fromSsga('sp500', 'SPY', 'S&P 500');
      case 'dow': return await fromSsga('dow', 'DIA', 'Dow Jones Industrial Average');
      case 'nasdaq100': return await nasdaq100();
      case 'nasdaq': return await nasdaqComposite();
      case 'sp100': return await sp100();
      default: return null;
    }
  } catch (e) {
    log.warn('holdings.unexpected', { slug, err: (e as Error).message });
    return null;
  }
}
