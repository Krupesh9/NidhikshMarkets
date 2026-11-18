/** CSV position import parsing + validation (pure; works on server and client). */
import Papa from 'papaparse';

export interface CsvPositionRow { ticker: string; quantity: number; costBasis: number; targetWeight: number | null; line: number }
export interface CsvRowError { line: number; field: string; message: string; value?: string }
export interface CsvParseResult { rows: CsvPositionRow[]; errors: CsvRowError[]; warnings: CsvRowError[]; totalRows: number; headers: string[] }

const ALIASES: Record<'ticker' | 'quantity' | 'cost_basis' | 'target_weight', string[]> = {
  ticker: ['ticker', 'symbol', 'tkr'],
  quantity: ['quantity', 'qty', 'shares', 'position'],
  cost_basis: ['cost_basis', 'costbasis', 'cost', 'avg_cost', 'average_cost', 'price', 'cost_per_share'],
  target_weight: ['target_weight', 'targetweight', 'weight', 'target'],
};
export const CSV_TEMPLATE = 'ticker,quantity,cost_basis,target_weight\nMSFT,100,410.50,0.10\nNVDA,250,120.00,0.12\nTSLA,-50,380.00,-0.03\n';
export const MAX_CSV_ROWS = 5000;
const TICKER_RE = /^[A-Z][A-Z0-9.\-]{0,9}$/;

const norm = (h: string) => h.trim().toLowerCase().replace(/[\s-]+/g, '_');
function num(v: string | undefined): number | null {
  if (v == null) return null;
  const s = v.trim().replace(/[$,\s]/g, '');
  if (!s) return null;
  const neg = /^\(.*\)$/.test(s);
  const n = Number(neg ? s.slice(1, -1) : s);
  return isFinite(n) ? (neg ? -n : n) : NaN;
}

/**
 * Parse `ticker,quantity,cost_basis[,target_weight]`. Header names are case-insensitive with common aliases.
 * target_weight accepts fractions (0.05), percents (5 or "5%"). Duplicate tickers are reported as warnings and kept
 * (merge happens downstream). `line` is the 1-based line number in the file (header = line 1).
 */
export function parsePositionsCsv(text: string, opts: { maxRows?: number; knownTickers?: Set<string> } = {}): CsvParseResult {
  const errors: CsvRowError[] = [];
  const warnings: CsvRowError[] = [];
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^﻿/, '').trim(), { header: true, skipEmptyLines: 'greedy', transformHeader: norm });
  const headers = parsed.meta.fields ?? [];
  const col = (k: keyof typeof ALIASES) => headers.find((h) => ALIASES[k].includes(h));
  const cT = col('ticker'), cQ = col('quantity'), cC = col('cost_basis'), cW = col('target_weight');
  if (!cT || !cQ || !cC) {
    const missing = [!cT && 'ticker', !cQ && 'quantity', !cC && 'cost_basis'].filter(Boolean).join(', ');
    return { rows: [], errors: [{ line: 1, field: 'header', message: `Missing required column(s): ${missing}. Expected header: ticker,quantity,cost_basis[,target_weight]` }], warnings, totalRows: 0, headers };
  }
  for (const e of parsed.errors) if (e.type !== 'FieldMismatch') errors.push({ line: (e.row ?? 0) + 2, field: 'row', message: e.message });
  const max = opts.maxRows ?? MAX_CSV_ROWS;
  const data = parsed.data;
  if (data.length > max) errors.push({ line: max + 2, field: 'file', message: `File has ${data.length} rows; the maximum is ${max}. Extra rows were ignored.` });
  const rows: CsvPositionRow[] = [];
  const seen = new Map<string, number>();
  data.slice(0, max).forEach((r, i) => {
    const line = i + 2;
    const rawT = (r[cT] ?? '').trim().toUpperCase();
    const q = num(r[cQ]);
    const c = num(r[cC]);
    let w = cW ? num(r[cW]?.replace('%', '')) : null;
    let bad = false;
    if (!rawT) { errors.push({ line, field: 'ticker', message: 'Ticker is required' }); bad = true; }
    else if (!TICKER_RE.test(rawT)) { errors.push({ line, field: 'ticker', message: 'Invalid ticker format', value: r[cT] }); bad = true; }
    if (q == null || Number.isNaN(q)) { errors.push({ line, field: 'quantity', message: 'Quantity must be a number', value: r[cQ] }); bad = true; }
    else if (q === 0) { errors.push({ line, field: 'quantity', message: 'Quantity cannot be zero (use a negative number for shorts)', value: r[cQ] }); bad = true; }
    if (c == null || Number.isNaN(c)) { errors.push({ line, field: 'cost_basis', message: 'Cost basis must be a number', value: r[cC] }); bad = true; }
    else if (c < 0) { errors.push({ line, field: 'cost_basis', message: 'Cost basis cannot be negative', value: r[cC] }); bad = true; }
    if (w != null) {
      if (Number.isNaN(w)) { errors.push({ line, field: 'target_weight', message: 'Target weight must be a number', value: r[cW!] }); bad = true; }
      else {
        const isPct = /%/.test(r[cW!] ?? '') || Math.abs(w) > 1;
        if (isPct) w = w / 100;
        if (Math.abs(w) > 1) { errors.push({ line, field: 'target_weight', message: 'Target weight must be between −100% and 100%', value: r[cW!] }); bad = true; }
      }
    }
    if (bad) return;
    if (seen.has(rawT)) warnings.push({ line, field: 'ticker', message: `Duplicate ticker ${rawT} (also on line ${seen.get(rawT)}); rows will be merged`, value: rawT });
    else seen.set(rawT, line);
    if (opts.knownTickers && !opts.knownTickers.has(rawT)) warnings.push({ line, field: 'ticker', message: `${rawT} is not in the coverage universe; pricing may be unavailable`, value: rawT });
    rows.push({ ticker: rawT, quantity: q!, costBasis: c!, targetWeight: w ?? null, line });
  });
  return { rows, errors, warnings, totalRows: data.length, headers };
}

/** Merge duplicate tickers from parsed rows (sum quantity, |qty|-weighted cost). */
export function mergeCsvRows(rows: CsvPositionRow[]): CsvPositionRow[] {
  const by = new Map<string, CsvPositionRow>();
  for (const r of rows) {
    const cur = by.get(r.ticker);
    if (!cur) { by.set(r.ticker, { ...r }); continue; }
    const aq = Math.abs(cur.quantity) + Math.abs(r.quantity);
    cur.costBasis = aq ? (cur.costBasis * Math.abs(cur.quantity) + r.costBasis * Math.abs(r.quantity)) / aq : cur.costBasis;
    cur.quantity += r.quantity;
    cur.targetWeight = r.targetWeight ?? cur.targetWeight;
  }
  return Array.from(by.values()).filter((r) => r.quantity !== 0);
}
