// Pure helpers for the Company Deep Dive. No server-only imports: safe for client components and Vitest.
import type {
  Bar, Catalyst, EstimatePeriod, EstimateRevision, Filing, FinancialPeriod, FinancialStatementRow, InsiderTxn, NewsItem, SourceRef,
} from '@/lib/data/types';

// ---------------------------------------------------------------- events / annotations

export type ChartEventKind = 'earnings' | 'filing' | 'insider' | 'news';

export interface ChartEvent {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  kind: ChartEventKind;
  title: string;
  detail?: string;
  source: SourceRef;
}

export const EVENT_KIND_LABEL: Record<ChartEventKind, string> = {
  earnings: 'Earnings / periodic report',
  filing: '8-K filing',
  insider: 'Insider buy',
  news: 'Major news',
};

const day = (s: string) => (s ?? '').slice(0, 10);

/** 10-K / 10-Q become "earnings" markers; 8-K become "filing" markers. Other forms are ignored. */
export function filingsToEvents(filings: Filing[]): ChartEvent[] {
  const out: ChartEvent[] = [];
  for (const f of filings) {
    const form = f.form.toUpperCase();
    const isPeriodic = form === '10-K' || form === '10-Q' || form === '20-F';
    const is8k = form === '8-K';
    if (!isPeriodic && !is8k) continue;
    const ex = f.excerpts?.[0];
    out.push({
      id: `evt:${f.id}`,
      date: day(f.filedAt),
      kind: isPeriodic ? 'earnings' : 'filing',
      title: `${f.form}: ${f.title}`,
      detail: f.periodOfReport ? `Period of report ${f.periodOfReport}` : undefined,
      source: { id: f.id, name: `${f.ticker} ${f.form} filed ${day(f.filedAt)}`, url: f.url, kind: 'filing', excerpt: ex?.text ?? `${f.form} — ${f.title}. Filed ${day(f.filedAt)}${f.accession ? ` (accession ${f.accession})` : ''}.`, locator: ex?.locator },
    });
  }
  return out;
}

/** Only open-market buys are annotated (sells are routine/10b5-1 noise). */
export function insidersToEvents(txns: InsiderTxn[]): ChartEvent[] {
  return txns
    .filter((t) => t.type === 'Buy')
    .map((t) => ({
      id: `evt:${t.id}`,
      date: day(t.date),
      kind: 'insider' as const,
      title: `${t.insider} (${t.title}) bought ${t.shares.toLocaleString('en-US')} sh`,
      detail: `~$${Math.round(t.value).toLocaleString('en-US')} at $${t.price.toFixed(2)}`,
      source: {
        id: t.id, name: `Form 4 — ${t.insider}, ${day(t.date)}`, url: t.filingUrl, kind: 'ownership',
        excerpt: `${t.insider} (${t.title}) reported a purchase of ${t.shares.toLocaleString('en-US')} shares at $${t.price.toFixed(2)} on ${day(t.date)}; holds ${t.sharesOwnedAfter.toLocaleString('en-US')} shares after the transaction.`,
        locator: 'Form 4, Table I',
      },
    }));
}

/**
 * "Major" news: prefer items with a non-neutral sentiment, at most one per day, capped at `max` (most recent first).
 */
export function newsToEvents(news: NewsItem[], max = 12): ChartEvent[] {
  const sorted = [...news].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  const major = sorted.filter((n) => n.sentiment && n.sentiment !== 'neutral');
  const pool = major.length >= Math.min(3, sorted.length) ? major : sorted;
  const seen = new Set<string>();
  const out: ChartEvent[] = [];
  for (const n of pool) {
    const d = day(n.publishedAt);
    if (seen.has(d)) continue;
    seen.add(d);
    out.push({
      id: `evt:${n.id}`, date: d, kind: 'news', title: n.title, detail: n.publisher,
      source: { id: n.id, name: `${n.publisher}: ${n.title}`, url: n.url, kind: 'news', excerpt: n.summary ?? n.title },
    });
    if (out.length >= max) break;
  }
  return out;
}

/** Concatenate, de-duplicate by id, sort oldest first (stable by kind order). */
export function mergeEvents(...lists: ChartEvent[][]): ChartEvent[] {
  const order: Record<ChartEventKind, number> = { earnings: 0, filing: 1, insider: 2, news: 3 };
  const byId = new Map<string, ChartEvent>();
  for (const l of lists) for (const e of l) if (e.date && !byId.has(e.id)) byId.set(e.id, e);
  return Array.from(byId.values()).sort((a, b) => a.date.localeCompare(b.date) || order[a.kind] - order[b.kind]);
}

/**
 * Snap events onto chart bar dates. An event maps to the first bar dated on/after it (weekends → next session).
 * Events before the first bar or more than `graceDays` after the last bar are dropped. Returns a map barDate → events.
 */
export function snapEventsToBars(events: ChartEvent[], barDates: string[], graceDays = 4): Map<string, ChartEvent[]> {
  const out = new Map<string, ChartEvent[]>();
  if (!barDates.length) return out;
  const first = barDates[0];
  const last = barDates[barDates.length - 1];
  // events a few days after the last bar (e.g. today's news before today's bar exists) snap onto the last bar
  const lastGrace = new Date(Date.parse(last) + graceDays * 86_400_000).toISOString().slice(0, 10);
  for (const e of events) {
    if (e.date < first || e.date > lastGrace) continue;
    if (e.date > last) {
      const arr = out.get(last) ?? [];
      arr.push(e);
      out.set(last, arr);
      continue;
    }
    // binary search first index with date >= e.date
    let lo = 0;
    let hi = barDates.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (barDates[mid] < e.date) lo = mid + 1;
      else hi = mid;
    }
    const key = barDates[lo];
    const arr = out.get(key) ?? [];
    arr.push(e);
    out.set(key, arr);
  }
  return out;
}

/** Aggregate consecutive bars into buckets so long ranges stay fast to render. Bucket keeps the LAST date. */
export function downsampleBars(bars: Bar[], maxPoints = 1200): Bar[] {
  if (bars.length <= maxPoints || maxPoints < 2) return bars;
  const k = Math.ceil(bars.length / maxPoints);
  const out: Bar[] = [];
  for (let i = 0; i < bars.length; i += k) {
    const chunk = bars.slice(i, i + k);
    out.push({
      date: chunk[chunk.length - 1].date,
      open: chunk[0].open,
      close: chunk[chunk.length - 1].close,
      high: Math.max(...chunk.map((b) => b.high)),
      low: Math.min(...chunk.map((b) => b.low)),
      volume: chunk.reduce((s, b) => s + b.volume, 0),
    });
  }
  return out;
}

// ---------------------------------------------------------------- growth / statements

/** Percent change cur vs prev; null when either is missing/non-finite or prev is 0. */
export function pctChange(cur: number | null | undefined, prev: number | null | undefined): number | null {
  if (cur == null || prev == null || !isFinite(cur) || !isFinite(prev) || prev === 0) return null;
  return ((cur - prev) / Math.abs(prev)) * 100;
}

/** YoY growth series aligned to `values`. lag = 1 for annual, 4 for quarterly. */
export function yoyGrowth(values: (number | null | undefined)[], lag = 1): (number | null)[] {
  return values.map((v, i) => (i - lag >= 0 ? pctChange(v, values[i - lag]) : null));
}

/** Difference in percentage points (for margin rows). */
export function ppChange(values: (number | null | undefined)[], lag = 1): (number | null)[] {
  return values.map((v, i) => {
    const p = i - lag >= 0 ? values[i - lag] : null;
    return v == null || p == null || !isFinite(v) || !isFinite(p) ? null : v - p;
  });
}

export const yoyLag = (period: FinancialPeriod) => (period === 'annual' ? 1 : 4);

export function periodLabel(row: Pick<FinancialStatementRow, 'fiscalYear' | 'fiscalPeriod'>): string {
  return row.fiscalPeriod === 'FY' ? `FY${row.fiscalYear}` : `${row.fiscalPeriod} '${String(row.fiscalYear).slice(-2)}`;
}

const daysBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000;

/**
 * Best-matching source filing for a statement period:
 *  1) filing whose periodOfReport is within 10 days of periodEnd and form matches (10-K for FY/Q4, 10-Q otherwise)
 *  2) otherwise the first matching-form filing filed 0–120 days after periodEnd
 * Returns null when nothing matches.
 */
export function matchFilingForPeriod(row: Pick<FinancialStatementRow, 'fiscalPeriod' | 'periodEnd'>, filings: Filing[]): Filing | null {
  const wantK = row.fiscalPeriod === 'FY' || row.fiscalPeriod === 'Q4';
  const forms = wantK ? ['10-K', '10-K/A', '20-F'] : ['10-Q', '10-Q/A'];
  const cands = filings.filter((f) => forms.includes(f.form.toUpperCase()));
  const byPeriod = cands.find((f) => f.periodOfReport && Math.abs(daysBetween(f.periodOfReport, row.periodEnd)) <= 10);
  if (byPeriod) return byPeriod;
  const byFiled = cands
    .filter((f) => { const d = daysBetween(row.periodEnd, day(f.filedAt)); return d >= 0 && d <= 120; })
    .sort((a, b) => a.filedAt.localeCompare(b.filedAt));
  return byFiled[0] ?? null;
}

/** EDGAR filing index for a company as of a date (fallback when the exact filing isn't in the feed). */
export function edgarIndexUrl(cikOrTicker: string, form: string, asOf: string): string {
  const dateb = asOf.replace(/-/g, '').slice(0, 8);
  return `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${encodeURIComponent(cikOrTicker)}&type=${encodeURIComponent(form)}&dateb=${dateb}&owner=include&count=40`;
}

/** Source for one statement column: matched filing, else an EDGAR index link (mock-labelled if data is mock). */
export function periodSource(row: FinancialStatementRow, filings: Filing[], ticker: string, opts: { isMock: boolean; cik?: string; provider?: string }): SourceRef {
  const label = periodLabel(row);
  const f = matchFilingForPeriod(row, filings);
  if (f) {
    return {
      id: f.id, name: `${ticker} ${f.form} · ${label}`, url: f.url, kind: 'filing',
      excerpt: f.excerpts?.[0]?.text ?? `${f.form} for the period ended ${row.periodEnd}, filed ${day(f.filedAt)}.`,
      locator: f.excerpts?.[0]?.locator ?? 'Financial statements',
    };
  }
  const form = row.fiscalPeriod === 'FY' || row.fiscalPeriod === 'Q4' ? '10-K' : '10-Q';
  const asOf = new Date(Date.parse(row.periodEnd) + 150 * 86_400_000).toISOString().slice(0, 10);
  const prefix = opts.isMock ? 'mock:' : '';
  return {
    id: row.sourceId ?? `${prefix}period:${ticker}:${label}`,
    name: `${ticker} ${form} · ${label}${opts.isMock ? ' (simulated)' : ''}`,
    url: edgarIndexUrl(opts.cik ?? ticker, form, asOf),
    kind: opts.isMock ? 'mock' : 'filing',
    excerpt: `${form} for the period ended ${row.periodEnd}${opts.provider ? ` — figures via ${opts.provider}` : ''}.`,
    locator: 'EDGAR filing index',
  };
}

/** Sum of the last n non-null values of `key` (TTM). Null if fewer than n rows. */
export function sumLast(rows: FinancialStatementRow[], key: keyof FinancialStatementRow, n = 4): number | null {
  if (rows.length < n) return null;
  const vals = rows.slice(-n).map((r) => r[key] as number);
  if (vals.some((v) => typeof v !== 'number' || !isFinite(v))) return null;
  return vals.reduce((s, v) => s + v, 0);
}

export interface Valuation {
  pe: number | null;
  peBasis: string;
  evEbitda: number | null;
  evBasis: string;
  ev: number | null;
}

/**
 * P/E = price / TTM diluted EPS (sum of last 4 quarters, else latest FY).
 * EV/EBITDA = (market cap + debt − cash) / TTM EBITDA. Falls back to provider-reported multiples.
 */
export function deriveValuation(input: {
  price: number | null; marketCap: number | null; annual: FinancialStatementRow[]; quarterly: FinancialStatementRow[];
  fallbackPe?: number; fallbackEvEbitda?: number;
}): Valuation {
  const { price, marketCap, annual, quarterly } = input;
  const qEps = sumLast(quarterly, 'eps');
  const lastFy = annual[annual.length - 1];
  const eps = qEps && qEps > 0 ? qEps : lastFy?.eps;
  const epsBasis = qEps && qEps > 0 ? `TTM diluted EPS $${qEps.toFixed(2)} (last 4 quarters)` : lastFy ? `FY${lastFy.fiscalYear} diluted EPS $${(lastFy.eps ?? 0).toFixed(2)}` : '';
  let pe: number | null = null;
  let peBasis = '';
  if (price && eps && eps > 0) {
    pe = price / eps;
    peBasis = `Price $${price.toFixed(2)} ÷ ${epsBasis} = ${pe.toFixed(1)}x`;
  } else if (input.fallbackPe && input.fallbackPe > 0) {
    pe = input.fallbackPe;
    peBasis = `Provider-reported P/E ${pe.toFixed(1)}x`;
  } else peBasis = 'Not meaningful (negative or missing earnings)';

  const qE = sumLast(quarterly, 'ebitda');
  const ebitda = qE && qE > 0 ? qE : lastFy?.ebitda;
  const bs = quarterly[quarterly.length - 1] ?? lastFy;
  let ev: number | null = null;
  let evEbitda: number | null = null;
  let evBasis = '';
  if (marketCap && bs) {
    ev = marketCap + (bs.totalDebt || 0) - (bs.cash || 0);
    if (ebitda && ebitda > 0) {
      evEbitda = ev / ebitda;
      evBasis = `EV ${compactUsd(ev)} (mkt cap ${compactUsd(marketCap)} + debt ${compactUsd(bs.totalDebt || 0)} − cash ${compactUsd(bs.cash || 0)}) ÷ ${qE && qE > 0 ? 'TTM' : `FY${lastFy?.fiscalYear}`} EBITDA ${compactUsd(ebitda)} = ${evEbitda.toFixed(1)}x`;
    }
  }
  if (evEbitda == null) {
    if (input.fallbackEvEbitda && input.fallbackEvEbitda > 0) {
      evEbitda = input.fallbackEvEbitda;
      evBasis = `Provider-reported EV/EBITDA ${evEbitda.toFixed(1)}x`;
    } else evBasis = 'Not meaningful (negative or missing EBITDA)';
  }
  return { pe, peBasis, evEbitda, evBasis, ev };
}

export function compactUsd(n: number): string {
  const a = Math.abs(n);
  const s = a >= 1e12 ? `${(a / 1e12).toFixed(2)}T` : a >= 1e9 ? `${(a / 1e9).toFixed(1)}B` : a >= 1e6 ? `${(a / 1e6).toFixed(1)}M` : a >= 1e3 ? `${(a / 1e3).toFixed(1)}K` : a.toFixed(0);
  return `${n < 0 ? '-' : ''}$${s}`;
}

// ---------------------------------------------------------------- estimates

/** Consensus value at or before `date` (revisions oldest first). */
export function valueAtOrBefore(revs: EstimateRevision[], date: string): number | null {
  let v: number | null = null;
  for (const r of revs) {
    if (r.date <= date) v = r.value;
    else break;
  }
  return v;
}

/** % change of consensus over the trailing `days` (relative to the latest revision date). */
export function revisionChange(revs: EstimateRevision[], days: number): number | null {
  if (revs.length < 2) return null;
  const last = revs[revs.length - 1];
  const cutoff = new Date(Date.parse(last.date) - days * 86_400_000).toISOString().slice(0, 10);
  const then = valueAtOrBefore(revs, cutoff) ?? revs[0].value;
  return pctChange(last.value, then);
}

/** Count consensus moves up/down between consecutive revision points within the trailing window. */
export function revisionCounts(revs: EstimateRevision[], days = 90): { up: number; down: number; flat: number } {
  const out = { up: 0, down: 0, flat: 0 };
  if (revs.length < 2) return out;
  const last = revs[revs.length - 1];
  const cutoff = new Date(Date.parse(last.date) - days * 86_400_000).toISOString().slice(0, 10);
  for (let i = 1; i < revs.length; i++) {
    if (revs[i].date < cutoff) continue;
    const d = revs[i].value - revs[i - 1].value;
    if (Math.abs(d) <= Math.abs(revs[i - 1].value) * 1e-6) out.flat++;
    else if (d > 0) out.up++;
    else out.down++;
  }
  return out;
}

const fyNum = (p: string) => { const m = /FY\s?(\d{4})/i.exec(p); return m ? Number(m[1]) : NaN; };

/** Next fiscal-year and next-quarter estimate for a metric. FY = earliest FY >= current calendar year. */
export function pickNextEstimates(periods: EstimatePeriod[], metric: EstimatePeriod['metric'], now = new Date()): { fy: EstimatePeriod | null; q: EstimatePeriod | null } {
  const ofMetric = periods.filter((p) => p.metric === metric);
  const fys = ofMetric.filter((p) => /^FY\s?\d{4}$/i.test(p.period.trim())).sort((a, b) => fyNum(a.period) - fyNum(b.period));
  const y = now.getUTCFullYear();
  const fy = fys.find((p) => fyNum(p.period) >= y) ?? fys[fys.length - 1] ?? null;
  const q = ofMetric.find((p) => /^Q[1-4]\b/i.test(p.period.trim())) ?? null;
  return { fy, q };
}

// ---------------------------------------------------------------- misc

/** Position (0–100) of v within [lo, hi], clamped. */
export function rangePosition(v: number, lo: number, hi: number): number {
  if (!isFinite(v) || !isFinite(lo) || !isFinite(hi) || hi <= lo) return 50;
  return Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
}

/** Two-letter monogram from the company name (skipping corporate suffixes), else ticker. */
export function monogram(name: string | undefined, ticker: string): string {
  const stop = new Set(['inc', 'inc.', 'corp', 'corp.', 'corporation', 'co', 'co.', 'company', 'plc', 'ltd', 'the', '&', 'and', 'holdings', 'group', 'n.v.', 'sa', 'ag']);
  const words = (name ?? '').split(/[\s,]+/).filter((w) => w && !stop.has(w.toLowerCase()) && /[A-Za-z]/.test(w[0]));
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return ticker.slice(0, 2).toUpperCase();
}

/** Upcoming catalysts (today or later), soonest first. */
export function upcomingCatalysts(cats: Catalyst[], now = new Date()): Catalyst[] {
  const today = now.toISOString().slice(0, 10);
  return cats.filter((c) => c.date >= today).sort((a, b) => a.date.localeCompare(b.date));
}

export function daysUntil(date: string, now = new Date()): number {
  const t = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((Date.parse(date.slice(0, 10)) - t) / 86_400_000);
}
