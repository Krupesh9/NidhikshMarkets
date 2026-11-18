import 'server-only';
import type { AnalystAction, Estimates } from './types';
import { cache } from '../cache';
import fs from 'node:fs';
import path from 'node:path';
import { log } from '../log';
import { cacheDir } from '../cache-dir';

/**
 * Financial Modeling Prep (FMP) adapter — analyst ratings, price targets and firm-by-firm grade changes.
 * Enabled when FMP_API_KEY is set. Endpoints used (all on the free/basic plan): grades-consensus,
 * price-target-consensus, grades. Per-analyst price targets with article links (price-target-news) need a paid plan.
 * Quotes are cached 10 min in market hours (60 min otherwise), analyst data 60 min, all under a daily call budget; the key is only sent as the documented `apikey` query param and never logged.
 */
const BASE = 'https://financialmodelingprep.com/stable';
const TTL = 10 * 60_000;
export const FMP_SITE = 'https://site.financialmodelingprep.com';

export function fmpEnabled(): boolean {
  return !!process.env.FMP_API_KEY && process.env.ALPHADESK_FORCE_MOCK !== '1';
}

/**
 * Daily call budget. FMP's free plan allows ~250 calls/day; we stop at FMP_DAILY_LIMIT (default 240) and keep
 * serving the last good response, so the app never goes blank. Usage is persisted so restarts don't reset it.
 */
const DAILY_LIMIT = Number(process.env.FMP_DAILY_LIMIT || 240);
const USAGE_FILE = cacheDir('fmp-usage.json');
let usage: { day: string; calls: number } | null = null;
const lastGood = new Map<string, unknown>();

const etDay = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
function loadUsage() {
  if (usage && usage.day === etDay()) return usage;
  try {
    const u = JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8')) as { day: string; calls: number };
    usage = u.day === etDay() ? u : { day: etDay(), calls: 0 };
  } catch { usage = { day: etDay(), calls: 0 }; }
  return usage;
}
function countCall() {
  const u = loadUsage();
  u.calls += 1;
  try { fs.mkdirSync(path.dirname(USAGE_FILE), { recursive: true }); fs.writeFileSync(USAGE_FILE, JSON.stringify(u)); } catch { /* best effort */ }
}
/** Calls used today (US Eastern day) and the configured limit. */
export function fmpUsage() { const u = loadUsage(); return { day: u.day, calls: u.calls, limit: DAILY_LIMIT }; }

/** True during regular US market hours (Mon–Fri 9:30–16:00 ET). */
export function usMarketOpen(now = new Date()): boolean {
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const d = et.getDay(), m = et.getHours() * 60 + et.getMinutes();
  return d >= 1 && d <= 5 && m >= 9 * 60 + 30 && m < 16 * 60;
}

async function get<T>(path: string, ttlMs = TTL): Promise<T | null> {
  const key = process.env.FMP_API_KEY;
  if (!key) return null;
  return cache.wrap(`fmp:${path}`, async () => {
    if (loadUsage().calls >= DAILY_LIMIT) {
      log.info('fmp.budget_exhausted', { path: path.split('?')[0], limit: DAILY_LIMIT });
      return (lastGood.get(path) as T | undefined) ?? null;
    }
    try {
      countCall();
      const sep = path.includes('?') ? '&' : '?';
      const r = await fetch(`${BASE}/${path}${sep}apikey=${encodeURIComponent(key)}`, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
      if (!r.ok) { log.debug('fmp.http', { path: path.split('?')[0], status: r.status }); return (lastGood.get(path) as T | undefined) ?? null; }
      const body = (await r.json()) as T;
      lastGood.set(path, body);
      return body;
    } catch (e) {
      log.debug('fmp.failed', { path: path.split('?')[0], err: (e as Error).message });
      return (lastGood.get(path) as T | undefined) ?? null;
    }
  }, ttlMs);
}

const BUY = /strong buy|buy|outperform|overweight|positive|accumulate|add|top pick|conviction/i;
const SELL = /sell|underperform|underweight|negative|reduce/i;
/** Map a broker's own rating wording to buy / hold / sell. */
export function bucketGrade(grade: string): AnalystAction['rating'] {
  if (SELL.test(grade)) return 'sell';
  if (BUY.test(grade)) return 'buy';
  return 'hold';
}

export function mapGradeAction(a: string): AnalystAction['action'] {
  const s = a.toLowerCase();
  if (s.startsWith('up')) return 'upgraded';
  if (s.startsWith('down')) return 'downgraded';
  if (s.startsWith('init')) return 'initiated';
  if (s.startsWith('reit')) return 'reiterated';
  return 'maintained';
}

export interface AnalystView {
  rating: Estimates['rating'] | null;
  priceTarget: (Estimates['priceTarget'] & { median?: number }) | null;
  actions: AnalystAction[];
  asOf: string;
  source: { name: string; url: string };
}

/** Ratings, targets and the most recent grade changes for one ticker (null when FMP is off or has nothing). */
export async function getAnalystView(ticker: string): Promise<AnalystView | null> {
  if (!fmpEnabled()) return null;
  const T = encodeURIComponent(ticker.toUpperCase());
  const [cons, pt, grades] = await Promise.all([
    get<{ strongBuy: number; buy: number; hold: number; sell: number; strongSell: number }[]>(`grades-consensus?symbol=${T}`, 60 * 60_000),
    get<{ targetHigh: number; targetLow: number; targetConsensus: number; targetMedian: number }[]>(`price-target-consensus?symbol=${T}`, 60 * 60_000),
    get<{ date: string; gradingCompany: string; previousGrade?: string; newGrade: string; action: string }[]>(`grades?symbol=${T}&limit=40`, 60 * 60_000),
  ]);
  const c = cons?.[0];
  const p = pt?.[0];
  const actions: AnalystAction[] = (grades ?? []).slice(0, 25).map((g) => ({
    firm: g.gradingCompany,
    rating: bucketGrade(g.newGrade),
    ratingLabel: g.newGrade,
    previousLabel: g.previousGrade && g.previousGrade !== g.newGrade ? g.previousGrade : undefined,
    action: mapGradeAction(g.action),
    date: g.date,
    // FMP's free plan has no article link for grade changes; link a news search for the call instead.
    url: `https://news.google.com/search?q=${encodeURIComponent(`${g.gradingCompany} ${ticker.toUpperCase()} ${g.newGrade}`)}`,
  }));
  if (!c && !p && !actions.length) return null;
  return {
    rating: c ? { buy: c.strongBuy + c.buy, hold: c.hold, sell: c.sell + c.strongSell } : null,
    priceTarget: p && p.targetConsensus ? { mean: p.targetConsensus, high: p.targetHigh, low: p.targetLow, median: p.targetMedian } : null,
    actions,
    asOf: new Date().toISOString(),
    source: { name: 'Financial Modeling Prep', url: FMP_SITE },
  };
}

export interface IndexQuote { symbol: string; name: string; price: number; change: number; changePct: number; ts: string }

/** Live index level from FMP (e.g. ^GSPC, ^IXIC, ^DJI). Cached 60s. Null when unavailable on the plan. */
export async function getIndexQuote(symbol: string): Promise<IndexQuote | null> {
  if (!fmpEnabled()) return null;
  const rows = await get<{ symbol: string; name: string; price: number; change: number; changePercentage: number; timestamp?: number }[]>(`quote?symbol=${encodeURIComponent(symbol)}`, usMarketOpen() ? 10 * 60_000 : 60 * 60_000);
  const q = rows?.[0];
  if (!q || !Number.isFinite(q.price)) return null;
  return { symbol, name: q.name, price: q.price, change: q.change, changePct: q.changePercentage, ts: q.timestamp ? new Date(q.timestamp * 1000).toISOString() : new Date().toISOString() };
}

/** Daily closes (oldest → newest) for an index such as ^GSPC from FMP's EOD endpoint. Cached 10 min. */
export async function getIndexHistory(symbol: string, days = 45): Promise<{ date: string; close: number }[]> {
  if (!fmpEnabled()) return [];
  const from = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const rows = await get<{ date: string; price: number }[]>(`historical-price-eod/light?symbol=${encodeURIComponent(symbol)}&from=${from}`, 60 * 60_000);
  return (rows ?? []).map((r) => ({ date: r.date, close: r.price })).filter((r) => Number.isFinite(r.close)).reverse();
}

/** Shared, budgeted FMP GET for other modules (e.g. screener profiles): `fmpGet<T>(path, ttlMs)`. */
export const fmpGet = get;
