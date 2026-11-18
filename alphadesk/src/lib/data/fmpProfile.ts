import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import { cacheDir } from '../cache-dir';
import { log } from '../log';
import { fmpEnabled, fmpGet } from './fmp';

/**
 * FMP company profile + TTM fallback metrics with a memory + on-disk cache, because the free plan allows
 * ~250 calls/day. Every request goes through the shared budgeted `fmpGet` (src/lib/data/fmp.ts).
 * Profiles are cached 7 days, metrics 24h, "unknown symbol" answers 24h, failures 10 min.
 * The key is only sent as the documented `apikey` query param and never logged.
 */
const DAY = 24 * 3600_000;
const PROFILE_TTL = 7 * DAY;
const METRICS_TTL = DAY;
const MISS_TTL = DAY;
const FAIL_TTL = 10 * 60_000;
const FILE = cacheDir('fmp-screener.json');
export const FMP_PROFILE_URL = (t: string) => `https://site.financialmodelingprep.com/financial-summary/${encodeURIComponent(t)}`;

export interface FmpProfile {
  symbol: string;
  companyName: string;
  sector: string;
  industry: string;
  country: string;
  marketCap: number | null;
  price: number | null;
  isEtf: boolean;
  isFund: boolean;
  exchange: string;
}

export interface FmpMetrics { pe: number | null; evEbitda: number | null; revenueGrowth: number | null }

type Entry = { at: number; ttl: number; v: unknown };
let store: Record<string, Entry> | null = null;
let saveTimer: NodeJS.Timeout | null = null;
const inflight = new Map<string, Promise<unknown>>();
let calls = { day: '', n: 0 };

function load(): Record<string, Entry> {
  if (store) return store;
  try {
    store = fs.existsSync(FILE) ? (JSON.parse(fs.readFileSync(FILE, 'utf8')) as Record<string, Entry>) : {};
  } catch {
    store = {};
  }
  return store;
}
function persist() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      const s = load();
      const now = Date.now();
      for (const [k, e] of Object.entries(s)) if (now - e.at > e.ttl) delete s[k];
      fs.mkdirSync(path.dirname(FILE), { recursive: true });
      fs.writeFileSync(FILE, JSON.stringify(s));
    } catch (e) {
      log.debug('fmp_profile.cache_write_failed', { err: (e as Error).message });
    }
  }, 500);
}

/** Calls made to FMP by this module today (process-local; for diagnostics). */
export function fmpScreenerCallsToday(): number {
  return calls.day === new Date().toISOString().slice(0, 10) ? calls.n : 0;
}

/** Cached-only read (no network). `undefined` = not cached. */
function peek<T>(key: string): T | null | undefined {
  const e = load()[key];
  if (!e || Date.now() - e.at > e.ttl) return undefined;
  return e.v as T | null;
}

/**
 * One FMP request through the shared, budgeted `fmpGet` (adds the key, counts against FMP_DAILY_LIMIT, serves the
 * last good body when over budget / on errors). null = failure or budget exhausted; `[]` = unknown symbol.
 */
async function fetchJson(pathQ: string): Promise<{ ok: boolean; body: unknown }> {
  if (!process.env.FMP_API_KEY) return { ok: false, body: null };
  const day = new Date().toISOString().slice(0, 10);
  calls = calls.day === day ? { day, n: calls.n + 1 } : { day, n: 1 };
  // our own disk cache (below) decides freshness; fmpGet's memory TTL just dedupes bursts
  const body = await fmpGet<unknown>(pathQ, 10 * 60_000);
  return body == null ? { ok: false, body: null } : { ok: true, body };
}

/** Memoised, disk-cached fetch. `map` turns the body into a value (null = symbol unknown). */
async function cached<T>(key: string, pathQ: string, ttl: number, map: (body: unknown) => T | null): Promise<T | null> {
  const hit = peek<T>(key);
  if (hit !== undefined) return hit;
  const pending = inflight.get(key);
  if (pending) return pending as Promise<T | null>;
  const p = (async () => {
    const r = await fetchJson(pathQ);
    const v = r.ok ? map(r.body) : null;
    load()[key] = { at: Date.now(), ttl: r.ok ? (v == null ? MISS_TTL : ttl) : FAIL_TTL, v };
    persist();
    return v;
  })().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const first = (b: unknown): Record<string, unknown> | null => (Array.isArray(b) && b[0] && typeof b[0] === 'object' ? (b[0] as Record<string, unknown>) : null);

/** Company/ETF profile (name, sector, industry, country, market cap). Null = unknown symbol or FMP unavailable. */
export async function getFmpProfile(ticker: string): Promise<FmpProfile | null> {
  if (!fmpEnabled()) return null;
  const T = ticker.toUpperCase();
  return cached<FmpProfile>(`profile:${T}`, `profile?symbol=${encodeURIComponent(T)}`, PROFILE_TTL, (b) => {
    const p = first(b);
    if (!p) return null;
    return {
      symbol: str(p.symbol) || T,
      companyName: str(p.companyName),
      sector: str(p.sector),
      industry: str(p.industry),
      country: str(p.country),
      marketCap: num(p.marketCap),
      price: num(p.price),
      isEtf: p.isEtf === true,
      isFund: p.isFund === true,
      exchange: str(p.exchange),
    };
  });
}

/** True when the profile is cached (or known-missing) — used to estimate FMP quota spend. */
export function fmpProfileCached(ticker: string): boolean {
  return peek(`profile:${ticker.toUpperCase()}`) !== undefined;
}

function fmpRevenueGrowth(T: string): Promise<number | null> {
  return cached<number>(`financial-growth:${T}`, `financial-growth?symbol=${T}&limit=1`, METRICS_TTL, (b) => {
    const g = num(first(b)?.revenueGrowth);
    return g == null ? null : g * 100;
  });
}

/** Latest-FY revenue growth (%) from FMP financial-growth — 1 call, cached 24h. For filers whose SEC revenue tags don't map (e.g. banks). */
export async function getFmpRevenueGrowth(ticker: string): Promise<number | null> {
  if (!fmpEnabled()) return null;
  return fmpRevenueGrowth(encodeURIComponent(ticker.toUpperCase()));
}

/**
 * Fallback valuation/growth when SEC financials are missing: ratios-ttm (P/E), key-metrics-ttm (EV/EBITDA),
 * financial-growth (latest FY revenue growth). 3 calls per ticker, each cached 24h.
 */
export async function getFmpMetrics(ticker: string): Promise<FmpMetrics | null> {
  if (!fmpEnabled()) return null;
  const T = encodeURIComponent(ticker.toUpperCase());
  const [ratios, km, growth] = await Promise.all([
    cached<number>(`ratios-ttm:${T}`, `ratios-ttm?symbol=${T}`, METRICS_TTL, (b) => num(first(b)?.priceToEarningsRatioTTM)),
    cached<number>(`key-metrics-ttm:${T}`, `key-metrics-ttm?symbol=${T}`, METRICS_TTL, (b) => num(first(b)?.evToEBITDATTM)),
    fmpRevenueGrowth(T),
  ]);
  if (ratios == null && km == null && growth == null) return null;
  return { pe: ratios != null && ratios > 0 ? ratios : null, evEbitda: km != null && km > 0 ? km : null, revenueGrowth: growth };
}
