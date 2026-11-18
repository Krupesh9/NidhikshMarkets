import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 });
export const fmt = {
  /** $1.23T / $456.7B */
  money: (n: number | null | undefined) => (n == null || !isFinite(n) ? '—' : `${n < 0 ? '-' : ''}$${compact.format(Math.abs(n))}`),
  price: (n: number | null | undefined) => (n == null || !isFinite(n) ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })),
  pct: (n: number | null | undefined, dp = 2, sign = true) => (n == null || !isFinite(n) ? '—' : `${sign && n > 0 ? '+' : ''}${n.toFixed(dp)}%`),
  num: (n: number | null | undefined, dp = 0) => (n == null || !isFinite(n) ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: dp, minimumFractionDigits: dp })),
  compact: (n: number | null | undefined) => (n == null || !isFinite(n) ? '—' : compact.format(n)),
  multiple: (n: number | null | undefined) => (n == null || !isFinite(n) || n <= 0 ? '—' : `${n.toFixed(1)}x`),
  date: (s: string | Date | null | undefined) => (!s ? '—' : new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })),
};
