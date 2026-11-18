/** Period performance helpers: buy-and-hold portfolio value series, start-of-period weights, period returns. */

export interface PerfHolding { ticker: string; quantity: number; costBasis: number; sector: string }

/**
 * Buy-and-hold value of current holdings across aligned dates, plus the period's start weights.
 * NAV_t = NAV_now − Σ q_i (P_now,i − P_t,i) — i.e. the book's capital base minus P&L earned after t (cash earns 0).
 */
export function buyAndHoldSeries(holdings: PerfHolding[], closes: Record<string, number[]>, navNow: number): { nav: number[]; returns: number[] } {
  const T = holdings.length ? Math.min(...holdings.map((h) => closes[h.ticker]?.length ?? 0)) : 0;
  const nav: number[] = [];
  for (let t = 0; t < T; t++) {
    let pnlAfter = 0;
    for (const h of holdings) {
      const s = closes[h.ticker];
      pnlAfter += h.quantity * (s[s.length - 1] - s[s.length - T + t]);
    }
    nav.push(navNow - pnlAfter);
  }
  const returns = nav.map((v, i) => (i === 0 || nav[i - 1] === 0 ? 0 : v / nav[i - 1] - 1)).slice(1);
  return { nav, returns };
}

/** Start-of-period weights (signed, fraction of start NAV) and period returns per holding. */
export function periodWeightsAndReturns(holdings: PerfHolding[], startPrices: Record<string, number>, endPrices: Record<string, number>, navNow: number) {
  const pnl = holdings.reduce((a, h) => a + h.quantity * ((endPrices[h.ticker] ?? 0) - (startPrices[h.ticker] ?? 0)), 0);
  const navStart = navNow - pnl;
  const rows = holdings.map((h) => {
    const p0 = startPrices[h.ticker] ?? 0;
    const p1 = endPrices[h.ticker] ?? p0;
    return { ticker: h.ticker, sector: h.sector, weight: navStart ? (h.quantity * p0) / navStart : 0, ret: p0 > 0 ? p1 / p0 - 1 : 0 };
  });
  return { rows, navStart, periodPnl: pnl, periodReturn: navStart ? pnl / navStart : 0 };
}

/** Cumulative return series from simple returns, starting at 0. */
export function cumulative(returns: number[]): number[] {
  const out = [0];
  let v = 1;
  for (const r of returns) { v *= 1 + r; out.push(v - 1); }
  return out;
}
