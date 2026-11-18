/**
 * Brinson–Hood–Beebower performance attribution by sector, buy-and-hold over the period.
 *   allocation_j  = (wp_j − wb_j)(rb_j − Rb)
 *   selection_j   = wb_j (rp_j − rb_j)
 *   interaction_j = (wp_j − wb_j)(rp_j − rb_j)
 * Σ_j (allocation + selection + interaction) = Rp − Rb exactly. Net weights of a long/short book need not sum to 1, so the
 * residual (1 − Σwp) is treated as a "Cash / financing" segment earning 0%.
 */

export interface AttributionHolding { sector: string; /** start-of-period weight (signed, fraction of NAV) */ weight: number; /** period return */ ret: number }
export interface AttributionSegment {
  sector: string;
  wp: number; wb: number; rp: number; rb: number;
  /** wp·rp — contribution to portfolio return */
  contribution: number;
  allocation: number; selection: number; interaction: number; total: number;
}
export interface AttributionResult {
  segments: AttributionSegment[];
  portfolioReturn: number;
  benchmarkReturn: number;
  active: number;
  allocation: number; selection: number; interaction: number;
}

export const CASH_SEGMENT = 'Cash / financing';

function aggregate(rows: AttributionHolding[]) {
  const m = new Map<string, { w: number; c: number }>();
  for (const r of rows) {
    const s = m.get(r.sector) ?? { w: 0, c: 0 };
    s.w += r.weight; s.c += r.weight * r.ret;
    m.set(r.sector, s);
  }
  return m;
}

export function brinsonAttribution(portfolio: AttributionHolding[], benchmark: AttributionHolding[]): AttributionResult {
  const P = aggregate(portfolio);
  const B = aggregate(benchmark);
  const bwSum = Array.from(B.values()).reduce((a, b) => a + b.w, 0) || 1;
  // normalise benchmark weights to 1
  for (const v of B.values()) { v.w /= bwSum; v.c /= bwSum; }
  const Rb = Array.from(B.values()).reduce((a, b) => a + b.c, 0);
  const pw = Array.from(P.values()).reduce((a, b) => a + b.w, 0);
  if (Math.abs(1 - pw) > 1e-12) P.set(CASH_SEGMENT, { w: 1 - pw + (P.get(CASH_SEGMENT)?.w ?? 0), c: P.get(CASH_SEGMENT)?.c ?? 0 });
  const keys = Array.from(new Set([...P.keys(), ...B.keys()]));
  const segments: AttributionSegment[] = keys.map((k) => {
    const p = P.get(k) ?? { w: 0, c: 0 };
    const b = B.get(k) ?? { w: 0, c: 0 };
    const rb = Math.abs(b.w) > 1e-12 ? b.c / b.w : Rb; // no benchmark exposure → compare against total benchmark
    const rp = Math.abs(p.w) > 1e-12 ? p.c / p.w : 0;
    const allocation = (p.w - b.w) * (rb - Rb);
    let selection: number, interaction: number;
    if (Math.abs(p.w) > 1e-12) {
      selection = b.w * (rp - rb);
      interaction = (p.w - b.w) * (rp - rb);
    } else {
      // net-zero sector weight (offsetting long/short) — all residual contribution is stock selection
      selection = p.c - p.w * rb;
      interaction = 0;
    }
    return { sector: k, wp: p.w, wb: b.w, rp, rb, contribution: p.c, allocation, selection, interaction, total: allocation + selection + interaction };
  }).sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
  const Rp = Array.from(P.values()).reduce((a, b) => a + b.c, 0);
  return {
    segments, portfolioReturn: Rp, benchmarkReturn: Rb, active: Rp - Rb,
    allocation: segments.reduce((a, s) => a + s.allocation, 0),
    selection: segments.reduce((a, s) => a + s.selection, 0),
    interaction: segments.reduce((a, s) => a + s.interaction, 0),
  };
}
