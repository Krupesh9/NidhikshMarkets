/** Formatting helpers for portfolio screens (fractions in, display strings out). */
export const usd = (n: number | null | undefined, dp = 0) =>
  n == null || !isFinite(n) ? '—' : `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
export const usdCompact = (n: number | null | undefined) => {
  if (n == null || !isFinite(n)) return '—';
  const a = Math.abs(n);
  const s = a >= 1e9 ? `${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `${(a / 1e6).toFixed(2)}M` : a >= 1e3 ? `${(a / 1e3).toFixed(1)}K` : a.toFixed(0);
  return `${n < 0 ? '-' : ''}$${s}`;
};
export const signedUsd = (n: number | null | undefined) => (n == null || !isFinite(n) ? '—' : `${n > 0 ? '+' : ''}${usdCompact(n)}`);
/** fraction → "12.3%" */
export const pct = (f: number | null | undefined, dp = 1, sign = false) =>
  f == null || !isFinite(f) ? '—' : `${sign && f > 0 ? '+' : ''}${(f * 100).toFixed(dp)}%`;
export const num = (n: number | null | undefined, dp = 2) => (n == null || !isFinite(n) ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp }));
export const tone = (n: number | null | undefined) => (n == null || !isFinite(n) || Math.abs(n) < 1e-12 ? 'text-muted' : n > 0 ? 'text-up' : 'text-down');

export const BENCHMARK_OPTIONS = [
  { id: 'SPY', label: 'S&P 500 (SPY)' },
  { id: 'QQQ', label: 'Nasdaq 100 (QQQ)' },
  { id: 'IWM', label: 'Russell 2000 (IWM)' },
] as const;
export const PERIOD_OPTIONS = ['1M', '3M', '6M', 'YTD', '1Y'] as const;

/** fetch JSON; throws Error with the API's message on failure (and attaches `status`/`details`). */
export async function api<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const r = await fetch(url, {
    ...init,
    headers: { ...(init?.json !== undefined ? { 'content-type': 'application/json' } : {}), ...(init?.headers ?? {}) },
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
    cache: 'no-store',
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(j?.error?.message ?? `Request failed (${r.status})`) as Error & { status?: number; details?: unknown };
    e.status = r.status;
    e.details = j?.error?.details;
    throw e;
  }
  return j as T;
}
