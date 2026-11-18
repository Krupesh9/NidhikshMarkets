import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import type { EstimatePeriod, Estimates, PartialProvider, SourceRef, WithMeta } from './types';
import { fiscalYearLabel } from './secFinancials';
import { log } from '../log';
import { cacheDir } from '../cache-dir';
import { meteredFetch, recordLimitError } from '../usage-meter';

/**
 * Alpha Vantage adapter — analyst consensus (EARNINGS_ESTIMATES) and, on premium keys, OVERVIEW
 * (ForwardPE, ratings, price target). Enabled when ALPHA_VANTAGE_API_KEY is set and ALPHADESK_FORCE_MOCK !== '1'.
 *
 * Quota: the free tier allows 25 calls/day and 1 call/second, so every response is cached per ticker for 24h in
 * memory AND on disk (`.cache/alphavantage.json`, git-ignored) so dev restarts don't burn quota; calls are spaced
 * ≥1.2s apart; "premium endpoint" answers are remembered for 7 days (no further calls for that function); rate-limit
 * answers back off for 1h in memory. The key is sent only as the documented `apikey` query param and never logged.
 */
const NAME = 'Alpha Vantage';
const DAY_MS = 24 * 3600_000;
const TIMEOUT_MS = 10_000;
const CACHE_FILE = cacheDir('alphavantage.json');

export function alphaVantageEnabled(): boolean {
  return !!process.env.ALPHA_VANTAGE_API_KEY && process.env.ALPHADESK_FORCE_MOCK !== '1';
}

type Entry = { at: number; body: Record<string, unknown> };
let store: Record<string, Entry> | null = null;
let backoffUntil = 0;
let queue: Promise<unknown> = Promise.resolve();
let lastCall = 0;

function load(): Record<string, Entry> {
  if (store) return store;
  try {
    store = fs.existsSync(CACHE_FILE) ? (JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) as Record<string, Entry>) : {};
  } catch {
    store = {};
  }
  return store;
}
function save(key: string, body: Record<string, unknown>) {
  const s = load();
  s[key] = { at: Date.now(), body };
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(s));
  } catch (e) {
    log.debug('alphavantage.cache_write_failed', { err: (e as Error).message });
  }
}

/** One AV call (cached 24h). Returns null for "no data"/premium/rate-limited — never throws for those. */
async function av(fn: 'OVERVIEW' | 'EARNINGS_ESTIMATES', symbol: string): Promise<Record<string, unknown> | null> {
  const key = `${fn}:${symbol}`;
  const s = load();
  const premium = s[`${fn}:__premium`];
  if (premium && Date.now() - premium.at < 7 * DAY_MS) return null;
  const hit = s[key];
  if (hit && Date.now() - hit.at < DAY_MS) return hit.body['Error Message'] || hit.body.Information ? null : hit.body;
  if (Date.now() < backoffUntil) return null;

  const run = async () => {
    const wait = lastCall + 1200 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    const url = `https://www.alphavantage.co/query?function=${fn}&symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(process.env.ALPHA_VANTAGE_API_KEY ?? '')}`;
    const res = await meteredFetch('alphavantage', url, { signal: AbortSignal.timeout(TIMEOUT_MS), cache: 'no-store' });
    if (!res.ok) throw new Error(`alphavantage: HTTP ${res.status}`);
    return (await res.json()) as Record<string, unknown>;
  };
  const p = queue.then(run, run);
  queue = p.catch(() => undefined);
  const body = await p;
  const info = String(body.Information ?? body.Note ?? '');
  if (/premium endpoint/i.test(info)) {
    log.info('alphavantage.premium_only', { fn });
    save(`${fn}:__premium`, { Information: 'premium endpoint' });
    return null;
  }
  if (info) {
    log.warn('alphavantage.rate_limited', { fn, symbol });
    recordLimitError('alphavantage', { status: 200, endpoint: `www.alphavantage.co/query (${fn})`, message: 'rate limit notice' });
    backoffUntil = Date.now() + 3600_000;
    return null;
  }
  save(key, body); // includes {"Error Message"} for unknown symbols so they don't cost quota again today
  return body['Error Message'] ? null : body;
}

// ------------------------------------------------------------------ mapping (pure; exported for tests)

const num = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && v !== 'None' && v !== '-' ? Number(v) : NaN;
  return isFinite(n) ? n : undefined;
};
const r2 = (n: number) => Math.round(n * 100) / 100;
const DAY = 86_400_000;
const isoDaysAgo = (now: Date, d: number) => new Date(now.getTime() - d * DAY).toISOString().slice(0, 10);

interface AvEstimateRow { date?: string; horizon?: string; [k: string]: unknown }

/** Map AV OVERVIEW + EARNINGS_ESTIMATES into our Estimates shape. Only future fiscal periods are kept. */
export function mapAlphaVantage(ticker: string, overview: Record<string, unknown> | null, est: Record<string, unknown> | null, now = new Date()): Estimates | null {
  const today = now.toISOString().slice(0, 10);
  const rows = ((est?.estimates as AvEstimateRow[] | undefined) ?? []).filter((r) => typeof r.date === 'string');
  const fyRows = rows.filter((r) => /fiscal year/i.test(r.horizon ?? '')).sort((a, b) => a.date!.localeCompare(b.date!));
  const qRows = rows.filter((r) => /fiscal quarter/i.test(r.horizon ?? '') && !/historical/i.test(r.horizon ?? '')).sort((a, b) => a.date!.localeCompare(b.date!));
  const fyEnds = fyRows.map((r) => r.date!);

  const fyEndFor = (date: string): string => {
    const e = fyEnds.find((d) => d >= date);
    if (e) return e;
    const base = fyEnds[fyEnds.length - 1] ?? date;
    const d = new Date(base + 'T00:00:00Z');
    while (d.toISOString().slice(0, 10) < date) d.setUTCFullYear(d.getUTCFullYear() + 1);
    return d.toISOString().slice(0, 10);
  };

  const periods: EstimatePeriod[] = [];
  const mk = (label: string, metric: 'eps' | 'revenue', r: AvEstimateRow): EstimatePeriod | null => {
    const pre = metric === 'eps' ? 'eps_estimate' : 'revenue_estimate';
    const avg = num(r[`${pre}_average`]);
    if (avg == null) return null;
    const hist: [number, number | undefined][] = [[90, num(r[`${pre}_average_90_days_ago`])], [60, num(r[`${pre}_average_60_days_ago`])], [30, num(r[`${pre}_average_30_days_ago`])], [7, num(r[`${pre}_average_7_days_ago`])]];
    const revisions = [...hist.filter(([, v]) => v != null).map(([d, v]) => ({ date: isoDaysAgo(now, d), value: v! })), { date: today, value: avg }];
    const chg = (v?: number) => (v ? r2(((avg - v) / Math.abs(v)) * 100) : 0);
    return {
      period: label, metric, consensus: avg, high: num(r[`${pre}_high`]) ?? avg, low: num(r[`${pre}_low`]) ?? avg,
      numAnalysts: Math.round(num(r[`${pre}_analyst_count`]) ?? 0), revisions, change30dPct: chg(hist[2][1]), change90dPct: chg(hist[0][1]),
    };
  };
  const push = (label: string, r: AvEstimateRow) => {
    for (const m of ['eps', 'revenue'] as const) { const p = mk(label, m, r); if (p) periods.push(p); }
  };
  const futureFy = fyRows.filter((r) => r.date! > today);
  for (const r of futureFy) push(`FY${fiscalYearLabel(r.date!)}`, r);
  for (const r of qRows.filter((x) => x.date! > today).slice(0, 2)) {
    const fyEnd = fyEndFor(r.date!);
    const q = Math.min(4, Math.max(1, 4 - Math.round((Date.parse(fyEnd) - Date.parse(r.date!)) / DAY / 91.3)));
    push(`Q${q} FY${fiscalYearLabel(fyEnd)}`, r);
  }

  const o = overview ?? {};
  // "Next fiscal year" = the FY after the one in progress (futureFy[0] is the in-progress FY); else the nearest future FY.
  const fwdRow = futureFy[1] ?? futureFy[0];
  const forwardEps = fwdRow ? num(fwdRow.eps_estimate_average) : undefined;
  const forwardPe = num(o.ForwardPE);
  const buy = (num(o.AnalystRatingStrongBuy) ?? 0) + (num(o.AnalystRatingBuy) ?? 0);
  const hold = num(o.AnalystRatingHold) ?? 0;
  const sell = (num(o.AnalystRatingSell) ?? 0) + (num(o.AnalystRatingStrongSell) ?? 0);
  const target = num(o.AnalystTargetPrice) ?? 0;
  if (!periods.length && forwardPe == null && !target && !(buy + hold + sell)) return null;
  return {
    ticker: ticker.toUpperCase(),
    rating: { buy, hold, sell },
    // AV only publishes a mean target; high/low are not available (0 = unknown)
    priceTarget: { mean: target, high: 0, low: 0 },
    periods,
    forwardEps: forwardEps != null && forwardEps !== 0 ? forwardEps : undefined,
    forwardPe: forwardPe && forwardPe > 0 ? forwardPe : undefined,
    trailingEps: num(o.DilutedEPSTTM) ?? num(o.EPS),
    forwardBasis: fwdRow
      ? `next fiscal year FY${fiscalYearLabel(fwdRow.date!)} (ending ${fwdRow.date}) mean EPS estimate of ${Math.round(num(fwdRow.eps_estimate_analyst_count) ?? 0)} analysts; consensus EPS is typically on an analyst-adjusted (non-GAAP) basis`
      : forwardPe ? 'Alpha Vantage reported forward P/E' : undefined,
  };
}

// ------------------------------------------------------------------ provider

export const alphaVantageProvider: PartialProvider = {
  name: NAME,
  async getEstimates(t: string): Promise<WithMeta<Estimates | null>> {
    const T = t.toUpperCase();
    const est = await av('EARNINGS_ESTIMATES', T);
    const overview = await av('OVERVIEW', T);
    const data = mapAlphaVantage(T, overview, est);
    const s = load();
    const fetchedAt = s[`EARNINGS_ESTIMATES:${T}`]?.at ?? s[`OVERVIEW:${T}`]?.at ?? Date.now();
    const asOf = new Date(fetchedAt).toISOString();
    const src: SourceRef[] = data ? [{
      id: `alphavantage:estimates:${T}`, name: `${T} analyst consensus (Alpha Vantage)`, kind: 'estimate',
      url: `https://www.alphavantage.co/documentation/#earnings-estimates`,
      excerpt: `Alpha Vantage consensus, as of ${asOf.slice(0, 10)}${data.forwardBasis ? `: ${data.forwardBasis}` : ''}.`,
      locator: 'EARNINGS_ESTIMATES',
    }] : [];
    return { data, meta: { source: src, isMock: false, asOf, provider: NAME } };
  },
};
