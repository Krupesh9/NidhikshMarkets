import { compactUsd } from '@/components/company/lib/helpers';

export const fmtUsd = (v: number | null | undefined, dp = 2) => (v == null || !isFinite(v) ? '—' : `${v < 0 ? '−' : ''}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`);
export const fmtBig = (v: number | null | undefined) => (v == null || !isFinite(v) ? '—' : compactUsd(v).replace('-', '−'));
export const fmtPct = (v: number | null | undefined, dp = 1, sign = false) => (v == null || !isFinite(v) ? '—' : `${sign && v > 0 ? '+' : ''}${v < 0 ? '−' : ''}${Math.abs(v).toFixed(dp)}%`);
export const fmtX = (v: number | null | undefined, dp = 2) => (v == null || !isFinite(v) ? '—' : `${v.toFixed(dp)}x`);
export const fmtShares = (v: number | null | undefined) => (v == null || !isFinite(v) ? '—' : v >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : `${(v / 1e6).toFixed(0)}M`);

export const TOOLTIP_STYLE = { background: 'rgb(var(--panel-2))', border: '1px solid rgb(var(--border))', borderRadius: 6, fontSize: 12 } as const;
export const AXIS_TICK = { fill: 'rgb(var(--muted))', fontSize: 10 } as const;
