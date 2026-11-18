import 'server-only';
import type { AnalystAction, Estimates } from './types';
import { cache } from '../cache';
import { log } from '../log';

/**
 * Financial Modeling Prep (FMP) adapter — analyst ratings, price targets and firm-by-firm grade changes.
 * Enabled when FMP_API_KEY is set. Endpoints used (all on the free/basic plan): grades-consensus,
 * price-target-consensus, grades. Per-analyst price targets with article links (price-target-news) need a paid plan.
 * Responses are cached 10 minutes; the key is only sent as the documented `apikey` query param and never logged.
 */
const BASE = 'https://financialmodelingprep.com/stable';
const TTL = 10 * 60_000;
export const FMP_SITE = 'https://site.financialmodelingprep.com';

export function fmpEnabled(): boolean {
  return !!process.env.FMP_API_KEY && process.env.ALPHADESK_FORCE_MOCK !== '1';
}

async function get<T>(path: string): Promise<T | null> {
  const key = process.env.FMP_API_KEY;
  if (!key) return null;
  return cache.wrap(`fmp:${path}`, async () => {
    try {
      const sep = path.includes('?') ? '&' : '?';
      const r = await fetch(`${BASE}/${path}${sep}apikey=${encodeURIComponent(key)}`, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
      if (!r.ok) { log.debug('fmp.http', { path: path.split('?')[0], status: r.status }); return null; }
      return (await r.json()) as T;
    } catch (e) {
      log.debug('fmp.failed', { path: path.split('?')[0], err: (e as Error).message });
      return null;
    }
  }, TTL);
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
    get<{ strongBuy: number; buy: number; hold: number; sell: number; strongSell: number }[]>(`grades-consensus?symbol=${T}`),
    get<{ targetHigh: number; targetLow: number; targetConsensus: number; targetMedian: number }[]>(`price-target-consensus?symbol=${T}`),
    get<{ date: string; gradingCompany: string; previousGrade?: string; newGrade: string; action: string }[]>(`grades?symbol=${T}&limit=40`),
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
