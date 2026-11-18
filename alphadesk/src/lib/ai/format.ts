// Number formatting shared by tools, the mock writer and the UI (pure).

export function usdB(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return 'n/a';
  const b = n / 1e9;
  if (Math.abs(b) >= 1000) return `$${(b / 1000).toFixed(2)}T`;
  if (Math.abs(b) >= 1) return `$${b.toFixed(digits)}B`;
  return `$${(n / 1e6).toFixed(0)}M`;
}

export function pct(n: number | null | undefined, digits = 1, signed = false): string {
  if (n == null || !Number.isFinite(n)) return 'n/a';
  const s = n.toFixed(digits);
  return `${signed && n > 0 ? '+' : ''}${s}%`;
}

export function mult(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return 'n/a';
  return `${n.toFixed(1)}x`;
}

export function round(n: number, d = 1): number {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

/** Compound annual growth rate in percent. */
export function cagr(first: number, last: number, years: number): number | null {
  if (!(first > 0) || !(last > 0) || years <= 0) return null;
  return round((Math.pow(last / first, 1 / years) - 1) * 100, 1);
}

export function formatCell(v: string | number | null | undefined, format?: string): string {
  if (v == null) return '—';
  if (typeof v === 'string') return v;
  switch (format) {
    case 'pct': return pct(v);
    case 'usd': return `$${v.toFixed(2)}`;
    case 'usdB': return v >= 1000 ? `$${(v / 1000).toFixed(2)}T` : `$${v.toFixed(1)}B`;
    case 'x': return mult(v);
    case 'num': return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
    default: return String(v);
  }
}
