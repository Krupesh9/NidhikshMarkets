/**
 * Editable screener ticker lists. Pure (client + server + tests).
 *   addTickers(list, 'pltr, AMD  nvda', { group: 'Tech' })  → validated, upper-cased, de-duplicated, capped at 100
 */

export const MAX_LIST = 120;
export const MAX_GROUP_LEN = 30;
export const TICKER_RE = /^[A-Z][A-Z0-9.\-]{0,9}$/;

/**
 * Fallback when the S&P 500 holdings file is unavailable or only exposes its top 10: 25 of the largest S&P 500
 * constituents by index weight (late 2026). Only used to top up a short watchlist, so exact ordering doesn't matter.
 */
export const SP500_TOP25 = [
  'NVDA', 'MSFT', 'AAPL', 'AMZN', 'GOOGL', 'META', 'AVGO', 'TSLA', 'BRK.B', 'JPM', 'LLY', 'V', 'WMT', 'ORCL', 'XOM',
  'MA', 'NFLX', 'COST', 'JNJ', 'PG', 'HD', 'ABBV', 'BAC', 'UNH', 'KO',
] as const;

/** A watchlist with at least this many names is used as the default list on its own. */
export const WATCHLIST_ONLY_MIN = 10;

export function normalizeTicker(raw: string): string {
  return raw.trim().toUpperCase().replace(/\//g, '.');
}
export const isValidTicker = (t: string) => TICKER_RE.test(t);

/** Split pasted text ("AAPL, msft  NVDA\nTSLA") into normalised candidate tickers (validity not checked). */
export function splitTickerInput(input: string): string[] {
  return input.split(/[\s,;]+/).map(normalizeTicker).filter(Boolean);
}

export interface AddResult {
  list: string[];
  added: string[];
  invalid: string[];
  duplicates: string[];
  /** valid tickers dropped because the list hit MAX_LIST */
  overCap: string[];
}

/** Append tickers from user input. Keeps existing order, rejects invalid ones, ignores duplicates, caps the list. */
export function addTickers(list: string[], input: string | string[], max = MAX_LIST): AddResult {
  const out = [...list];
  const seen = new Set(out);
  const res: AddResult = { list: out, added: [], invalid: [], duplicates: [], overCap: [] };
  for (const t of Array.isArray(input) ? input.map(normalizeTicker).filter(Boolean) : splitTickerInput(input)) {
    if (!isValidTicker(t)) { res.invalid.push(t); continue; }
    if (seen.has(t)) { res.duplicates.push(t); continue; }
    if (out.length >= max) { res.overCap.push(t); continue; }
    out.push(t);
    seen.add(t);
    res.added.push(t);
  }
  return res;
}

export function removeTicker(list: string[], ticker: string): string[] {
  const t = normalizeTicker(ticker);
  return list.filter((x) => x !== t);
}

/** Validate + de-dupe + cap any incoming list (API input, saved JSON). Invalid entries are dropped. */
export function sanitizeTickers(input: unknown, max = MAX_LIST): string[] {
  if (!Array.isArray(input)) return [];
  return addTickers([], input.filter((x): x is string => typeof x === 'string'), max).list;
}

/** Keep only groups for tickers in the list, trimmed and length-limited; empty labels dropped. */
export function sanitizeGroups(input: unknown, tickers?: string[]): Record<string, string> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const allow = tickers ? new Set(tickers) : null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    const t = normalizeTicker(k);
    if (typeof v !== 'string' || !isValidTicker(t) || (allow && !allow.has(t))) continue;
    const g = v.replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, MAX_GROUP_LEN);
    if (g) out[t] = g;
  }
  return out;
}

/**
 * S&P 100 constituents (OEX). Static list — S&P rebalances it rarely; review it when the index changes.
 * GOOG and GOOGL are both members (two share classes).
 */
export const SP100 = ['AAPL', 'ABBV', 'ABT', 'ACN', 'ADBE', 'AIG', 'AMD', 'AMGN', 'AMT', 'AMZN', 'AVGO', 'AXP', 'BA', 'BAC', 'BK', 'BKNG', 'BLK', 'BMY', 'BRK.B', 'C', 'CAT', 'CHTR', 'CL', 'CMCSA', 'COF', 'COP', 'COST', 'CRM', 'CSCO', 'CVS', 'CVX', 'DE', 'DHR', 'DIS', 'DUK', 'EMR', 'F', 'FDX', 'GD', 'GE', 'GILD', 'GM', 'GOOG', 'GOOGL', 'GS', 'HD', 'HON', 'IBM', 'INTC', 'INTU', 'ISRG', 'JNJ', 'JPM', 'KO', 'LIN', 'LLY', 'LMT', 'LOW', 'MA', 'MCD', 'MDLZ', 'MDT', 'MET', 'META', 'MMM', 'MO', 'MRK', 'MS', 'MSFT', 'NEE', 'NFLX', 'NKE', 'NOW', 'NVDA', 'ORCL', 'PEP', 'PFE', 'PG', 'PLTR', 'PM', 'PYPL', 'QCOM', 'RTX', 'SBUX', 'SCHW', 'SO', 'SPG', 'T', 'TGT', 'TMO', 'TMUS', 'TSLA', 'TXN', 'UBER', 'UNH', 'UNP', 'UPS', 'USB', 'V', 'VZ', 'WFC', 'WMT', 'XOM'] as const;

/** Default list: the watchlist alone when it has ≥ 10 names, else the watchlist followed by the S&P 100 (deduped, capped). */
export function defaultList(watchlist: string[], base: readonly string[] = SP100): string[] {
  const wl = sanitizeTickers(watchlist);
  if (wl.length >= WATCHLIST_ONLY_MIN) return wl;
  return addTickers(wl, [...base]).list;
}

export function sameList(a: string[] | null | undefined, b: string[] | null | undefined): boolean {
  if (!a || !b) return a == b;
  return a.length === b.length && a.every((x, i) => x === b[i]);
}
export function sameGroups(a: Record<string, string>, b: Record<string, string>): boolean {
  const ka = Object.keys(a).filter((k) => a[k]);
  const kb = Object.keys(b).filter((k) => b[k]);
  return ka.length === kb.length && ka.every((k) => a[k] === b[k]);
}
