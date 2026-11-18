/**
 * Pure derivations for live screener rows (no server deps — unit tested).
 */
import type { Estimates, FinancialStatementRow, GicsSector, InsiderTxn, WhyNow } from '@/lib/data/types';

// ───────────────────────────── sectors ─────────────────────────────

/** Label used for ETFs / funds (FMP files them under "Financial Services"). */
export const FUND_SECTOR = 'Fund / ETF';
export const UNKNOWN_SECTOR = 'Unclassified';

const FMP_TO_GICS: Record<string, GicsSector> = {
  'technology': 'Information Technology',
  'information technology': 'Information Technology',
  'communication services': 'Communication Services',
  'communications': 'Communication Services',
  'consumer cyclical': 'Consumer Discretionary',
  'consumer discretionary': 'Consumer Discretionary',
  'consumer defensive': 'Consumer Staples',
  'consumer staples': 'Consumer Staples',
  'energy': 'Energy',
  'financial services': 'Financials',
  'financial': 'Financials',
  'financials': 'Financials',
  'healthcare': 'Health Care',
  'health care': 'Health Care',
  'industrials': 'Industrials',
  'basic materials': 'Materials',
  'materials': 'Materials',
  'real estate': 'Real Estate',
  'utilities': 'Utilities',
};

/** Map an FMP (Morningstar-style) sector name to GICS. ETFs → "Fund / ETF"; unknown/blank → "Unclassified". */
export function mapFmpSector(sector: string | null | undefined, isEtf = false): GicsSector | typeof FUND_SECTOR | typeof UNKNOWN_SECTOR {
  if (isEtf) return FUND_SECTOR;
  const k = (sector ?? '').trim().toLowerCase();
  return FMP_TO_GICS[k] ?? UNKNOWN_SECTOR;
}

// ───────────────────────────── revenue growth ─────────────────────────────

const DAY = 86_400_000;
const gapDays = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / DAY;
const ok = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/**
 * YoY revenue growth in percent. Prefers TTM vs prior TTM (last 8 consecutive quarters), else latest FY vs prior FY.
 * Rows are oldest first (as served by getFinancials). Null when there isn't a clean comparison.
 */
export function revenueGrowthFrom(annual: FinancialStatementRow[], quarterly: FinancialStatementRow[]): { value: number | null; basis: string } {
  const q = quarterly.filter((r) => r.periodEnd && ok(r.revenue));
  if (q.length >= 8) {
    const last8 = q.slice(-8);
    const consecutive = last8.every((r, i) => i === 0 || (gapDays(last8[i - 1].periodEnd, r.periodEnd) >= 70 && gapDays(last8[i - 1].periodEnd, r.periodEnd) <= 110));
    if (consecutive) {
      const prior = last8.slice(0, 4).reduce((s, r) => s + r.revenue, 0);
      const ttm = last8.slice(4).reduce((s, r) => s + r.revenue, 0);
      if (prior > 0 && ttm > 0) return { value: ((ttm - prior) / prior) * 100, basis: `TTM to ${last8[7].periodEnd} vs prior TTM` };
    }
  }
  const a = annual.filter((r) => r.periodEnd && ok(r.revenue) && r.revenue > 0);
  if (a.length >= 2) {
    const [prev, last] = a.slice(-2);
    const g = gapDays(prev.periodEnd, last.periodEnd);
    if (g >= 330 && g <= 400) return { value: ((last.revenue - prev.revenue) / prev.revenue) * 100, basis: `FY${last.fiscalYear} vs FY${prev.fiscalYear}` };
  }
  return { value: null, basis: 'Not enough reported revenue history' };
}

// ───────────────────────────── insiders / estimates ─────────────────────────────

/** Net open-market insider dollars over `days` (Buy − Sell). Options/gifts ignored. 0 when there were no trades. */
export function netInsiderDollars(txns: InsiderTxn[], today: Date = new Date(), days = 90): number {
  const cutoff = today.getTime() - days * DAY;
  let net = 0;
  for (const t of txns) {
    const at = Date.parse(t.date);
    if (!Number.isFinite(at) || at < cutoff) continue;
    const v = Math.abs(ok(t.value) && t.value ? t.value : (t.shares || 0) * (t.price || 0));
    if (t.type === 'Buy') net += v;
    else if (t.type === 'Sell') net -= v;
  }
  return Math.round(net);
}

/** % change in the nearest FY EPS consensus over ~30 days, from the estimate revision history. Null if unavailable. */
export function epsRevision30dFrom(est: Estimates | null | undefined, today: Date = new Date()): number | null {
  const p = est?.periods.find((x) => x.metric === 'eps' && /^FY/.test(x.period) && x.revisions.length >= 2) ?? est?.periods.find((x) => x.metric === 'eps' && x.revisions.length >= 2);
  if (!p) return null;
  const revs = [...p.revisions].sort((a, b) => a.date.localeCompare(b.date));
  const last = revs[revs.length - 1];
  const target = today.getTime() - 30 * DAY;
  let base = revs[0];
  for (const r of revs) if (Date.parse(r.date) <= target) base = r;
  if (base === last || !ok(base.value) || base.value === 0 || !ok(last.value)) return null;
  return ((last.value - base.value) / Math.abs(base.value)) * 100;
}

// ───────────────────────────── why now ─────────────────────────────

export interface WhyNowInput {
  ticker: string;
  isEtf?: boolean;
  changePct: number | null;
  revenueGrowth: number | null;
  revenueBasis?: string;
  insiderBuying90d: number | null;
  nextEarnings: string;
  /** days from today to nextEarnings (NaN when unknown) */
  earningsInDays: number;
  pe: number | null;
  epsRevision30d: number | null;
}

const money = (v: number) => {
  const a = Math.abs(v);
  return a >= 1e9 ? `$${(a / 1e9).toFixed(1)}B` : a >= 1e6 ? `$${(a / 1e6).toFixed(1)}M` : a >= 1e3 ? `$${(a / 1e3).toFixed(0)}K` : `$${a.toFixed(0)}`;
};

/**
 * Factual "why now" from real fields, most notable signal first. No recommendations — just what changed.
 * `sourceIds` are filled by the caller.
 */
export function buildWhyNow(x: WhyNowInput): Omit<WhyNow, 'sourceIds'> {
  const signals: { score: number; text: string }[] = [];
  if (ok(x.changePct) && Math.abs(x.changePct) >= 3) signals.push({ score: Math.abs(x.changePct) * 1.5, text: `${x.changePct > 0 ? 'Up' : 'Down'} ${Math.abs(x.changePct).toFixed(1)}% today` });
  if (ok(x.earningsInDays) && x.earningsInDays >= 0 && x.earningsInDays <= 30) signals.push({ score: 8 - x.earningsInDays / 5, text: x.earningsInDays === 0 ? 'Reports earnings today' : `Earnings in ${x.earningsInDays}d (${x.nextEarnings})` });
  if (ok(x.insiderBuying90d) && x.insiderBuying90d > 0) signals.push({ score: 7, text: `Net insider buying ${money(x.insiderBuying90d)} (90d, Form 4)` });
  if (ok(x.insiderBuying90d) && x.insiderBuying90d < -50e6) signals.push({ score: 3, text: `Net insider selling ${money(x.insiderBuying90d)} (90d, Form 4)` });
  if (ok(x.revenueGrowth) && Math.abs(x.revenueGrowth) >= 20) signals.push({ score: Math.abs(x.revenueGrowth) / 8, text: `Revenue ${x.revenueGrowth > 0 ? '+' : ''}${x.revenueGrowth.toFixed(0)}% YoY${x.revenueBasis ? ` (${x.revenueBasis})` : ''}` });
  if (ok(x.changePct) && Math.abs(x.changePct) >= 1.5 && Math.abs(x.changePct) < 3) signals.push({ score: 1, text: `${x.changePct > 0 ? '+' : ''}${x.changePct.toFixed(1)}% today` });
  signals.sort((a, b) => b.score - a.score);
  const headline = signals.length
    ? signals.slice(0, 2).map((s) => s.text).join(' · ')
    : x.isEtf ? 'Index fund — tracks its benchmark; no single-company catalyst' : 'No notable change in price, insiders, earnings timing or growth';

  const estimateChange = ok(x.epsRevision30d)
    ? `FY EPS consensus ${x.epsRevision30d >= 0 ? '+' : ''}${x.epsRevision30d.toFixed(1)}% over 30 days (Alpha Vantage).`
    : ok(x.revenueGrowth)
      ? `Reported revenue ${x.revenueGrowth >= 0 ? 'grew' : 'fell'} ${Math.abs(x.revenueGrowth).toFixed(1)}% YoY${x.revenueBasis ? ` (${x.revenueBasis})` : ''} ${x.revenueBasis?.includes('FMP') ? '' : ' per SEC filings'}; consensus revisions not loaded.`
      : x.isEtf ? 'Funds have no earnings estimates.' : 'No estimate or revenue history available.';

  const risks: string[] = [];
  if (ok(x.earningsInDays) && x.earningsInDays >= 0 && x.earningsInDays <= 14) risks.push('event risk around the upcoming earnings report');
  if (ok(x.pe) && x.pe > 50) risks.push(`rich trailing P/E of ${x.pe.toFixed(0)}x`);
  if (ok(x.revenueGrowth) && x.revenueGrowth < 0) risks.push('shrinking revenue');
  if (ok(x.insiderBuying90d) && x.insiderBuying90d < -50e6) risks.push('heavy insider selling');
  if (ok(x.changePct) && Math.abs(x.changePct) >= 5) risks.push('elevated day-to-day volatility');
  const risk = risks.length ? `Watch: ${risks.join('; ')}.` : x.isEtf ? 'Market risk of the underlying index.' : 'No flagged risk in the live data; review filings for company-specific risks.';
  return { headline, estimateChange, risk };
}
