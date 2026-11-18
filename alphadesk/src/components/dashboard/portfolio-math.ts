/** Pure portfolio summary math (used by the dashboard cards and portfolio share snapshots). */
import type { Quote } from '@/lib/data/types';

export interface PosIn { ticker: string; quantity: number; costBasis: number; sector?: string | null }
export interface PosOut { ticker: string; quantity: number; costBasis: number; price: number | null; marketValue: number; weight: number; changePct: number | null; dayPnl: number; pnl: number; sector: string | null }
export interface PortfolioSummary {
  rows: PosOut[];
  positions: number;
  long: number;
  short: number;
  gross: number;
  net: number;
  dayPnl: number;
  /** day P&L as % of gross exposure at prior close */
  dayPnlPct: number | null;
  unrealized: number;
  unrealizedPct: number | null;
  /** positions with no quote (valued at cost) */
  missingQuotes: string[];
}

export function summarizePortfolio(positions: PosIn[], quotes: Record<string, Pick<Quote, 'price' | 'change' | 'changePct'>>): PortfolioSummary {
  const missing: string[] = [];
  const base = positions.map((p) => {
    const q = quotes[p.ticker.toUpperCase()];
    if (!q) missing.push(p.ticker);
    const price = q?.price ?? null;
    const px = price ?? p.costBasis;
    const mv = p.quantity * px;
    return {
      ticker: p.ticker.toUpperCase(), quantity: p.quantity, costBasis: p.costBasis, price, marketValue: mv, weight: 0,
      changePct: q?.changePct ?? null, dayPnl: q ? p.quantity * q.change : 0, pnl: p.quantity * (px - p.costBasis), sector: p.sector ?? null,
    };
  });
  const long = base.filter((r) => r.marketValue > 0).reduce((a, r) => a + r.marketValue, 0);
  const short = base.filter((r) => r.marketValue < 0).reduce((a, r) => a + r.marketValue, 0);
  const gross = long - short;
  const net = long + short;
  const rows = base.map((r) => ({ ...r, weight: gross ? r.marketValue / gross : 0 })).sort((a, b) => Math.abs(b.marketValue) - Math.abs(a.marketValue));
  const dayPnl = rows.reduce((a, r) => a + r.dayPnl, 0);
  // gross exposure at prior close
  const prior = rows.reduce((a, r) => a + Math.abs(r.marketValue - r.dayPnl), 0);
  const unrealized = rows.reduce((a, r) => a + r.pnl, 0);
  const costGross = rows.reduce((a, r) => a + Math.abs(r.quantity * r.costBasis), 0);
  return {
    rows, positions: rows.length, long, short, gross, net, dayPnl,
    dayPnlPct: prior ? (dayPnl / prior) * 100 : null,
    unrealized, unrealizedPct: costGross ? (unrealized / costGross) * 100 : null,
    missingQuotes: missing,
  };
}

export function fmtUsd(n: number | null | undefined, opts: { compact?: boolean; sign?: boolean } = {}): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const sign = opts.sign && n > 0 ? '+' : '';
  if (opts.compact) {
    const a = Math.abs(n);
    const s = a >= 1e12 ? `${(a / 1e12).toFixed(2)}T` : a >= 1e9 ? `${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `${(a / 1e6).toFixed(2)}M` : a >= 1e3 ? `${(a / 1e3).toFixed(1)}K` : a.toFixed(0);
    return `${n < 0 ? '-' : sign}$${s}`;
  }
  return `${sign}${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
}
