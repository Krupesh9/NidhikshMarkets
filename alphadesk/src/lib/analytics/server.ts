import 'server-only';
/**
 * Server-side loaders: fetch market data (quotes, ~1Y daily history, universe metadata), then run the pure analytics.
 * History is fetched once per ticker and cached 30 min here (plus the provider cache) to respect API rate limits.
 *   const r = await getPortfolioAnalytics(scope, portfolioId, { benchmark: 'SPY', period: '1Y' });
 */
import { getMarketData, type Quote, type SourceRef, type UniverseItem } from '@/lib/data';
import { mockProvider } from '@/lib/data/mock';
import { MOCK_BY_TICKER, MOCK_UNIVERSE } from '@/lib/data/mock/universe';
import { portfolioRepo, type BasketDTO, type PortfolioDTO, type Scope } from '@/lib/repos';
import { cache } from '@/lib/cache';
import { jobs } from '@/lib/jobs';
import { log } from '@/lib/log';
import { analyzePortfolio, type PortfolioAnalytics } from './portfolio';
import { BENCHMARKS, asBenchmark, asPeriod, type BenchmarkId, type PeriodId } from './benchmarks';
import { seedFromString } from './prng';
import { strikeShares, suggestRebalance, type RebalanceResult } from './rebalance';
import type { PricePoint } from './stats';
import type { HoldingInput } from './exposure';

const HIST_TTL = 30 * 60_000;
const ANALYTICS_TTL = 5 * 60_000;
/** Above this many positions the full analytics run as a background job. */
export const LARGE_PORTFOLIO = 150;

export interface DataProvenance { isMock: boolean; providers: string[]; sources: SourceRef[]; asOf: string; mockTickers: string[] }

async function loadHistory(ticker: string): Promise<{ points: PricePoint[]; isMock: boolean; provider?: string; source: SourceRef[] }> {
  return cache.wrap(`an:hist:${ticker}:1Y`, async () => {
    const r = await getMarketData().getHistory(ticker, '1Y');
    return { points: r.data.map((b) => ({ date: b.date, close: b.close })), isMock: r.meta.isMock, provider: r.meta.provider, source: r.meta.source.slice(0, 1) };
  }, HIST_TTL);
}

async function loadUniverse(): Promise<Map<string, UniverseItem>> {
  const u = await cache.wrap('an:universe', async () => (await getMarketData().getUniverse()).data, 60 * 60_000);
  return new Map(u.map((x) => [x.ticker.toUpperCase(), x]));
}

/** Prices, history and classification for a ticker set. */
export async function loadMarketInputs(tickers: string[], extraHistory: string[] = []) {
  const uniq = Array.from(new Set(tickers.map((t) => t.toUpperCase())));
  const md = getMarketData();
  const [quoteRes, universe, histories] = await Promise.all([
    Promise.all(uniq.map(async (t) => [t, await md.getQuote(t)] as const)),
    loadUniverse(),
    Promise.all(Array.from(new Set([...uniq, ...extraHistory])).map(async (t) => [t, await loadHistory(t)] as const)),
  ]);
  const hist = Object.fromEntries(histories);
  const q = new Map<string, Quote>();
  const mockQuote = new Set<string>();
  for (const [t, r] of quoteRes) {
    const h = hist[t];
    // Prefer real history over a simulated quote so valuation and returns come from the same source.
    if ((!r.data || r.meta.isMock) && h && !h.isMock && h.points.length > 1) {
      const last = h.points[h.points.length - 1].close;
      const prev = h.points[h.points.length - 2].close;
      q.set(t, { ticker: t, price: last, prevClose: prev, change: last - prev, changePct: ((last - prev) / prev) * 100, open: last, high: last, low: last, volume: 0, marketCap: 0, ts: h.points[h.points.length - 1].date });
      continue;
    }
    if (r.data) q.set(t, r.data);
    if (r.meta.isMock) mockQuote.add(t);
  }
  const mockTickers = Array.from(new Set([...histories.filter(([, h]) => h.isMock || !h.points.length).map(([t]) => t), ...mockQuote]));
  const providers = Array.from(new Set([...quoteRes.map(([, r]) => r.meta.provider), ...histories.map(([, h]) => h.provider)].flatMap((p) => (p ? p.split(' + ') : [])).filter((p) => p && p !== 'none')));
  const seen = new Set<string>();
  const sources = [...quoteRes.flatMap(([, r]) => r.meta.source.slice(0, 1)), ...histories.flatMap(([, h]) => h.source)].filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true))).slice(0, 16);
  const prov: DataProvenance = { isMock: mockTickers.length > 0, providers, sources, asOf: new Date().toISOString(), mockTickers };
  return { quotes: q, universe, hist, prov };
}

function holdingsFrom(positions: { id?: string; ticker: string; quantity: number; costBasis: number; sector?: string | null; country?: string | null; targetWeight?: number | null }[], m: Awaited<ReturnType<typeof loadMarketInputs>>): HoldingInput[] {
  return positions.map((p) => {
    const T = p.ticker.toUpperCase();
    const q = m.quotes.get(T);
    const h = m.hist[T]?.points ?? [];
    const u = m.universe.get(T);
    const price = q?.price ?? h[h.length - 1]?.close ?? p.costBasis;
    const prev = q?.prevClose ?? h[h.length - 2]?.close ?? price;
    return {
      id: p.id, ticker: T, quantity: p.quantity, costBasis: p.costBasis, price, prevClose: prev,
      sector: u?.sector ?? p.sector ?? MOCK_BY_TICKER[T]?.sector ?? null,
      country: u?.country ?? p.country ?? MOCK_BY_TICKER[T]?.country ?? null,
      beta: MOCK_BY_TICKER[T]?.beta ?? null, targetWeight: p.targetWeight ?? null, name: u?.name ?? MOCK_BY_TICKER[T]?.name ?? null,
    };
  });
}

/** Simulated benchmark constituent proxies (no network): app universe names, cap- or equal-weighted, by sector. */
async function benchmarkProxy(id: BenchmarkId) {
  return cache.wrap(`an:proxy:${id}`, async () => {
    const def = BENCHMARKS[id];
    const members = MOCK_UNIVERSE.filter((m) => def.constituentFilter({ exchange: m.exchange, marketCap: m.mcapB, country: m.country }));
    const constituents = members.map((m) => ({ ticker: m.ticker, sector: m.sector as string, weight: def.weighting === 'cap' ? m.mcapB : 1 }));
    const history: Record<string, PricePoint[]> = {};
    for (const m of members) history[m.ticker] = (await mockProvider.getHistory(m.ticker, '1Y')).data.map((b) => ({ date: b.date, close: b.close }));
    return { constituents, history };
  }, 60 * 60_000);
}

export interface PortfolioAnalyticsResponse {
  status: 'ready';
  portfolio: { id: string; name: string; description: string | null; benchmark: string; updatedAt: string; positionCount: number };
  benchmark: { id: BenchmarkId; label: string; proxy: string };
  period: PeriodId;
  analytics: PortfolioAnalytics;
  meta: DataProvenance & { computedAt: string; attributionProxyIsMock: boolean; benchmarkIsMock: boolean };
}
export type AnalyticsPending = { status: 'computing'; jobId: string; message: string };

function analyticsKey(p: PortfolioDTO, b: BenchmarkId, period: PeriodId) {
  const sig = p.positions.map((x) => `${x.ticker}:${x.quantity}:${x.costBasis}`).join('|');
  return `an:pf:${p.id}:${b}:${period}:${seedFromString(sig)}`;
}

async function computeAnalytics(p: PortfolioDTO, b: BenchmarkId, period: PeriodId): Promise<PortfolioAnalyticsResponse> {
  const def = BENCHMARKS[b];
  const m = await loadMarketInputs(p.positions.map((x) => x.ticker), [def.proxy]);
  const bench = m.hist[def.proxy];
  const proxy = await benchmarkProxy(b);
  const analytics = analyzePortfolio({
    holdings: holdingsFrom(p.positions, m),
    history: Object.fromEntries(p.positions.map((x) => [x.ticker.toUpperCase(), m.hist[x.ticker.toUpperCase()]?.points ?? []])),
    benchmark: { id: b, label: def.label, history: bench?.points ?? [], sectorWeights: def.sectorWeights },
    benchmarkProxy: proxy,
    period,
    seed: `pf:${p.id}`,
    referenceBetaFor: p.positions.map((x) => x.ticker.toUpperCase()).filter((t) => !!m.hist[t] && !!bench && m.hist[t].isMock !== bench.isMock),
  });
  return {
    status: 'ready',
    portfolio: { id: p.id, name: p.name, description: p.description, benchmark: p.benchmark, updatedAt: new Date(p.updatedAt).toISOString(), positionCount: p.positions.length },
    benchmark: { id: b, label: def.label, proxy: def.proxy },
    period,
    analytics,
    meta: { ...m.prov, computedAt: new Date().toISOString(), attributionProxyIsMock: true, benchmarkIsMock: !!bench?.isMock || !bench?.points.length },
  };
}

const pending = (globalThis as unknown as { __ndAnPending?: Map<string, string> }).__ndAnPending ??= new Map<string, string>();
jobs.register<{ key: string; p: PortfolioDTO; b: BenchmarkId; period: PeriodId }>('analytics.portfolio', async (job) => {
  try {
    const r = await computeAnalytics(job.data.p, job.data.b, job.data.period);
    cache.set(job.data.key, r, ANALYTICS_TTL);
  } finally {
    pending.delete(job.data.key);
  }
});

/** Portfolio analytics (cached 5 min). Large books (> LARGE_PORTFOLIO positions) compute in the background job queue. */
export async function getPortfolioAnalytics(scope: Scope, id: string, opts: { benchmark?: string; period?: string } = {}): Promise<PortfolioAnalyticsResponse | AnalyticsPending | null> {
  const p = await portfolioRepo.get(scope, id);
  if (!p) return null;
  return analyticsForPortfolio(p, opts);
}

export async function analyticsForPortfolio(p: PortfolioDTO, opts: { benchmark?: string; period?: string } = {}): Promise<PortfolioAnalyticsResponse | AnalyticsPending> {
  const b = asBenchmark(opts.benchmark ?? p.benchmark);
  const period = asPeriod(opts.period);
  const key = analyticsKey(p, b, period);
  if (p.positions.length > LARGE_PORTFOLIO) {
    const hit = cache.get<PortfolioAnalyticsResponse>(key);
    if (hit) return hit;
    let jobId = pending.get(key);
    if (!jobId) {
      jobId = jobs.enqueue('analytics.portfolio', { key, p, b, period }, { maxAttempts: 1 });
      pending.set(key, jobId);
      log.info('analytics.enqueued', { portfolioId: p.id, positions: p.positions.length });
    }
    return { status: 'computing', jobId, message: `Running 5,000-path Monte Carlo on ${p.positions.length} positions…` };
  }
  return cache.wrap(key, () => computeAnalytics(p, b, period), ANALYTICS_TTL);
}

export interface PortfolioSummary {
  id: string; name: string; description: string | null; benchmark: string; positionCount: number; updatedAt: string;
  value: number; dayPnl: number; dayPct: number; grossPct: number; netPct: number; unrealizedPnl: number; sparkline: number[]; isMock: boolean;
}

/** Light summary for portfolio cards: value, day change, 30-day buy-and-hold sparkline. */
export async function summarizePortfolios(list: PortfolioDTO[]): Promise<{ items: PortfolioSummary[]; meta: DataProvenance }> {
  const m = await loadMarketInputs(list.flatMap((p) => p.positions.map((x) => x.ticker)));
  const { valuePortfolio } = await import('./exposure');
  const items = list.map((p) => {
    const hs = holdingsFrom(p.positions, m);
    const v = valuePortfolio(hs);
    const days = 30;
    const spark: number[] = [];
    for (let k = days; k >= 1; k--) {
      let pnl = 0;
      for (const h of hs) {
        const pts = m.hist[h.ticker]?.points ?? [];
        const past = pts[pts.length - k]?.close;
        const last = pts[pts.length - 1]?.close;
        if (past != null && last != null) pnl += h.quantity * (last - past);
      }
      spark.push(v.nav - pnl);
    }
    return {
      id: p.id, name: p.name, description: p.description, benchmark: p.benchmark, positionCount: p.positions.length, updatedAt: new Date(p.updatedAt).toISOString(),
      value: v.nav, dayPnl: v.dayPnl, dayPct: v.dayPct, grossPct: v.grossPct, netPct: v.netPct, unrealizedPnl: v.unrealizedPnl, sparkline: p.positions.length ? spark : [],
      isMock: p.positions.some((x) => m.prov.mockTickers.includes(x.ticker.toUpperCase())),
    };
  });
  return { items, meta: m.prov };
}

export type RebalanceSince = '1M' | '3M' | '6M' | '1Y' | 'inception';
export interface BasketRebalanceResponse {
  basket: { id: string; name: string; description: string | null; thesis: string | null };
  since: RebalanceSince; rebalanceDate: string | null; notional: number;
  result: RebalanceResult;
  holdings: { ticker: string; name: string | null; sector: string | null; rationale: string | null; targetWeight: number; strikePrice: number; price: number; sinceReturn: number; sparkline: number[] }[];
  performance: { date: string; value: number }[];
  basketReturn: number;
  meta: DataProvenance;
}

/** Drift since the last (assumed) rebalance + suggested trades back to target. */
export async function basketRebalance(b: BasketDTO, opts: { since?: string; notional?: number; tolerance?: number; mode?: 'band' | 'full'; wholeShares?: boolean } = {}): Promise<BasketRebalanceResponse> {
  const since = (['1M', '3M', '6M', '1Y', 'inception'] as const).find((s) => s === opts.since) ?? '3M';
  const notional = opts.notional && opts.notional > 0 ? opts.notional : 1_000_000;
  const m = await loadMarketInputs(b.holdings.map((h) => h.ticker));
  const anyHist = b.holdings.map((h) => m.hist[h.ticker.toUpperCase()]?.points ?? []).find((x) => x.length) ?? [];
  const lastDate = anyHist[anyHist.length - 1]?.date ?? new Date().toISOString().slice(0, 10);
  const dayMs = 86400000;
  const back: Record<RebalanceSince, number> = { '1M': 31, '3M': 92, '6M': 183, '1Y': 365, inception: 0 };
  const fromDate = since === 'inception' ? new Date(b.createdAt).toISOString().slice(0, 10) : new Date(new Date(lastDate + 'T00:00:00Z').getTime() - back[since] * dayMs).toISOString().slice(0, 10);
  const strikePx: Record<string, number> = {};
  const nowPx: Record<string, number> = {};
  for (const h of b.holdings) {
    const T = h.ticker.toUpperCase();
    const pts = m.hist[T]?.points ?? [];
    const bar = pts.find((x) => x.date >= fromDate) ?? pts[pts.length - 1];
    nowPx[T] = m.quotes.get(T)?.price ?? pts[pts.length - 1]?.close ?? 0;
    strikePx[T] = bar?.close ?? nowPx[T];
  }
  const shares = strikeShares(b.holdings.map((h) => ({ ticker: h.ticker, targetWeight: h.targetWeight, price: strikePx[h.ticker.toUpperCase()] })), notional, false);
  const result = suggestRebalance(b.holdings.map((h) => ({ ticker: h.ticker, targetWeight: h.targetWeight, shares: shares[h.ticker.toUpperCase()] ?? 0, price: nowPx[h.ticker.toUpperCase()] })), { tolerance: opts.tolerance ?? 0.02, mode: opts.mode ?? 'band', wholeShares: opts.wholeShares ?? true });
  // performance path of the struck basket
  const dates = (anyHist.filter((x) => x.date >= fromDate)).map((x) => x.date);
  const perf = dates.map((d) => {
    let v = 0;
    for (const h of b.holdings) {
      const T = h.ticker.toUpperCase();
      const pts = m.hist[T]?.points ?? [];
      const bar = pts.find((x) => x.date >= d) ?? pts[pts.length - 1];
      v += (shares[T] ?? 0) * (bar?.close ?? strikePx[T]);
    }
    return { date: d, value: v };
  });
  return {
    basket: { id: b.id, name: b.name, description: b.description, thesis: b.thesis },
    since, rebalanceDate: dates[0] ?? fromDate, notional, result,
    holdings: b.holdings.map((h) => {
      const T = h.ticker.toUpperCase();
      return {
        ticker: T, name: m.universe.get(T)?.name ?? MOCK_BY_TICKER[T]?.name ?? null, sector: h.sector ?? m.universe.get(T)?.sector ?? null, rationale: h.rationale,
        targetWeight: h.targetWeight, strikePrice: strikePx[T], price: nowPx[T], sinceReturn: strikePx[T] ? nowPx[T] / strikePx[T] - 1 : 0,
        sparkline: (m.hist[T]?.points ?? []).slice(-30).map((x) => x.close),
      };
    }),
    performance: perf,
    basketReturn: notional ? result.totalValue / notional - 1 : 0,
    meta: m.prov,
  };
}

export async function getBasketRebalance(scope: Scope, id: string, opts: Parameters<typeof basketRebalance>[1] = {}) {
  const b = await portfolioRepo.getBasket(scope, id);
  if (!b) return null;
  const key = `an:bk:${b.id}:${seedFromString(JSON.stringify([b.holdings.map((h) => [h.ticker, h.targetWeight]), opts]))}`;
  return cache.wrap(key, () => basketRebalance(b, opts), ANALYTICS_TTL);
}
