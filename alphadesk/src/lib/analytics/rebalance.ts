/**
 * Basket drift vs target weights and rebalancing suggestions (research output only — no orders are placed).
 * A basket is a synthetic long-only ETF: shares are struck at `notional × target / price` on the last rebalance date
 * and then drift with prices.
 */

export interface BasketPositionInput { ticker: string; targetWeight: number; shares: number; price: number }
export interface DriftRow {
  ticker: string;
  targetWeight: number;
  currentWeight: number;
  /** current − target */
  drift: number;
  /** drift / target */
  relativeDrift: number;
  value: number;
  price: number;
  shares: number;
  breach: boolean;
}
export interface RebalanceTrade {
  ticker: string;
  action: 'BUY' | 'SELL';
  shares: number;
  notional: number;
  fromWeight: number;
  toWeight: number;
  /** 'drift' = outside tolerance band; 'funding' = pro-rata trade in an in-band name to keep the basket fully invested; 'full' = full rebalance */
  reason: 'drift' | 'funding' | 'full';
}
export interface RebalanceResult {
  totalValue: number;
  tolerance: number;
  rows: DriftRow[];
  trades: RebalanceTrade[];
  /** Σ|trade notional| / 2 / total value (one-way turnover) */
  turnover: number;
  /** cash left over after whole-share rounding (+ = unspent) */
  cashResidual: number;
  maxAbsDrift: number;
  breaches: number;
  postTradeWeights: Record<string, number>;
}

/** Strike share counts at a rebalance date: shares_i = notional × w_i / p_i. */
export function strikeShares(targets: { ticker: string; targetWeight: number; price: number }[], notional: number, wholeShares = false): Record<string, number> {
  const tw = targets.reduce((a, t) => a + t.targetWeight, 0) || 1;
  return Object.fromEntries(targets.map((t) => {
    const raw = t.price > 0 ? (notional * (t.targetWeight / tw)) / t.price : 0;
    return [t.ticker.toUpperCase(), wholeShares ? Math.floor(raw) : raw];
  }));
}

export function computeDrift(positions: BasketPositionInput[], tolerance = 0.02): { rows: DriftRow[]; totalValue: number } {
  const tw = positions.reduce((a, p) => a + p.targetWeight, 0) || 1;
  const totalValue = positions.reduce((a, p) => a + p.shares * p.price, 0);
  const rows = positions.map((p) => {
    const value = p.shares * p.price;
    const target = p.targetWeight / tw;
    const current = totalValue ? value / totalValue : 0;
    const drift = current - target;
    return { ticker: p.ticker.toUpperCase(), targetWeight: target, currentWeight: current, drift, relativeDrift: target ? drift / target : 0, value, price: p.price, shares: p.shares, breach: Math.abs(drift) > tolerance };
  }).sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift));
  return { rows, totalValue };
}

/**
 * Suggest trades restoring target weights.
 *  - mode 'band' (default): trade only names whose |drift| exceeds `tolerance`; the trades are funded against each other
 *    (net cash ~0) by scaling so the basket stays fully invested.
 *  - mode 'full': trade every name back to target.
 * `wholeShares` rounds share counts toward zero.
 */
export function suggestRebalance(positions: BasketPositionInput[], opts: { tolerance?: number; mode?: 'band' | 'full'; wholeShares?: boolean; minTradeNotional?: number; selfFunding?: boolean } = {}): RebalanceResult {
  const tolerance = opts.tolerance ?? 0.02;
  const mode = opts.mode ?? 'band';
  const { rows, totalValue } = computeDrift(positions, tolerance);
  const anyBreach = rows.some((r) => r.breach);
  const trades: RebalanceTrade[] = [];
  const post: Record<string, number> = {};
  const minN = opts.minTradeNotional ?? 0.01;
  const round = (x: number) => (opts.wholeShares ? Math.trunc(x) : x);
  let spent = 0;
  const traded = new Set<string>();
  const push = (r: DriftRow, dShares: number, reason: RebalanceTrade['reason']) => {
    const notional = dShares * r.price;
    if (dShares === 0 || Math.abs(notional) < minN) return;
    trades.push({ ticker: r.ticker, action: dShares > 0 ? 'BUY' : 'SELL', shares: Math.abs(dShares), notional: Math.abs(notional), fromWeight: r.currentWeight, toWeight: totalValue ? (r.value + notional) / totalValue : 0, reason });
    spent += notional;
    post[r.ticker] = totalValue ? (r.value + notional) / totalValue : 0;
    traded.add(r.ticker);
  };
  for (const r of rows) {
    post[r.ticker] = r.currentWeight;
    const shouldTrade = mode === 'full' ? true : anyBreach && r.breach;
    if (shouldTrade && r.price > 0) push(r, round((r.targetWeight * totalValue - r.value) / r.price), mode === 'full' ? 'full' : 'drift');
  }
  // Band mode: fund the net cash flow pro-rata across in-band names so the basket stays fully invested.
  if (mode === 'band' && (opts.selfFunding ?? true) && Math.abs(spent) >= minN) {
    const pool = rows.filter((r) => !traded.has(r.ticker) && r.price > 0);
    const poolValue = pool.reduce((a, r) => a + r.value, 0);
    const need = -spent;
    if (poolValue > 0) for (const r of pool) push(r, round((need * (r.value / poolValue)) / r.price), 'funding');
  }
  const turnover = totalValue ? trades.reduce((a, t) => a + t.notional, 0) / 2 / totalValue : 0;
  return {
    totalValue, tolerance, rows, trades: trades.sort((a, b) => b.notional - a.notional), turnover, cashResidual: -spent,
    maxAbsDrift: rows.reduce((a, r) => Math.max(a, Math.abs(r.drift)), 0), breaches: rows.filter((r) => r.breach).length, postTradeWeights: post,
  };
}

/** Validate that target weights sum to 100% (± tol) and are non-negative. */
export function validateTargetWeights(weights: number[], tol = 1e-4): { ok: boolean; sum: number; message?: string } {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (weights.some((w) => !isFinite(w) || w < 0)) return { ok: false, sum, message: 'Target weights must be non-negative numbers.' };
  if (Math.abs(sum - 1) > tol) return { ok: false, sum, message: `Target weights sum to ${(sum * 100).toFixed(2)}% — they must sum to 100%.` };
  return { ok: true, sum };
}
