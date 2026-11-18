/** Position valuation, weights, exposures and concentration. Pure and deterministic. */

export interface HoldingInput {
  id?: string;
  ticker: string;
  /** shares; negative = short */
  quantity: number;
  /** per-share cost basis */
  costBasis: number;
  /** current price */
  price: number;
  /** previous close (for day P&L); defaults to price (no change) */
  prevClose?: number | null;
  sector?: string | null;
  country?: string | null;
  beta?: number | null;
  targetWeight?: number | null;
  name?: string | null;
}

export interface ValuedPosition extends HoldingInput {
  side: 'long' | 'short';
  marketValue: number;
  costValue: number;
  unrealizedPnl: number;
  /** P&L / |cost value| (sign-correct for shorts) */
  unrealizedPct: number;
  dayPnl: number;
  dayPct: number;
  /** signed market value / NAV */
  weight: number;
  /** |market value| / gross exposure */
  grossWeight: number;
  sector: string;
  country: string;
}

export interface Valuation {
  positions: ValuedPosition[];
  longMarketValue: number;
  /** absolute value of short market value (positive number) */
  shortMarketValue: number;
  grossExposure: number;
  netExposure: number;
  /** capital base used for % figures: long MV + short-sale proceeds − short MV (= long MV + short unrealized P&L), unless overridden */
  nav: number;
  costBasisTotal: number;
  unrealizedPnl: number;
  dayPnl: number;
  /** day P&L as % of prior-day NAV */
  dayPct: number;
  grossPct: number;
  netPct: number;
  longPct: number;
  shortPct: number;
  count: number;
}

const UNCLASSIFIED = 'Unclassified';

/** Merge duplicate tickers (summing quantity; quantity-weighted cost basis). */
export function mergeHoldings<T extends HoldingInput>(rows: T[]): T[] {
  const by = new Map<string, T>();
  for (const r of rows) {
    const k = r.ticker.toUpperCase();
    const cur = by.get(k);
    if (!cur) { by.set(k, { ...r, ticker: k }); continue; }
    const q = cur.quantity + r.quantity;
    const cost = Math.abs(cur.quantity) + Math.abs(r.quantity) > 0
      ? (cur.costBasis * Math.abs(cur.quantity) + r.costBasis * Math.abs(r.quantity)) / (Math.abs(cur.quantity) + Math.abs(r.quantity))
      : cur.costBasis;
    by.set(k, { ...cur, quantity: q, costBasis: cost });
  }
  return Array.from(by.values());
}

/**
 * Value a book. `nav` overrides the capital base (e.g. fund NAV incl. cash); otherwise the base is
 * long MV + short unrealized P&L (short-sale proceeds held as collateral). For a long-only book that equals long MV.
 */
export function valuePortfolio(rows: HoldingInput[], opts: { nav?: number } = {}): Valuation {
  let longMV = 0, shortMV = 0, cost = 0, upnl = 0, dayPnl = 0, shortUpnl = 0;
  const pre = rows.map((r) => {
    const mv = r.quantity * r.price;
    const cv = r.quantity * r.costBasis;
    const pnl = mv - cv;
    const prev = r.prevClose && r.prevClose > 0 ? r.prevClose : r.price;
    const dp = r.quantity * (r.price - prev);
    if (mv >= 0) longMV += mv; else { shortMV += -mv; shortUpnl += pnl; }
    cost += cv; upnl += pnl; dayPnl += dp;
    return { r, mv, cv, pnl, dp, prev };
  });
  const gross = longMV + shortMV;
  const net = longMV - shortMV;
  const nav = opts.nav && opts.nav > 0 ? opts.nav : longMV + shortUpnl > 0 ? longMV + shortUpnl : gross;
  const prevNav = nav - dayPnl;
  const positions: ValuedPosition[] = pre.map(({ r, mv, cv, pnl, dp, prev }) => ({
    ...r,
    ticker: r.ticker.toUpperCase(),
    sector: r.sector || UNCLASSIFIED,
    country: r.country || UNCLASSIFIED,
    side: r.quantity < 0 ? 'short' : 'long',
    marketValue: mv,
    costValue: cv,
    unrealizedPnl: pnl,
    unrealizedPct: cv !== 0 ? pnl / Math.abs(cv) : 0,
    dayPnl: dp,
    dayPct: prev > 0 ? r.price / prev - 1 : 0,
    weight: nav ? mv / nav : 0,
    grossWeight: gross ? Math.abs(mv) / gross : 0,
  }));
  return {
    positions, longMarketValue: longMV, shortMarketValue: shortMV, grossExposure: gross, netExposure: net, nav,
    costBasisTotal: cost, unrealizedPnl: upnl, dayPnl, dayPct: prevNav > 0 ? dayPnl / prevNav : 0,
    grossPct: nav ? gross / nav : 0, netPct: nav ? net / nav : 0, longPct: nav ? longMV / nav : 0, shortPct: nav ? shortMV / nav : 0,
    count: positions.length,
  };
}

export interface ExposureBucket {
  key: string;
  long: number;
  /** positive number */
  short: number;
  net: number;
  gross: number;
  /** net / NAV */
  netWeight: number;
  /** gross / total gross */
  grossWeight: number;
  count: number;
}

export interface Concentration {
  buckets: ExposureBucket[];
  /** Herfindahl–Hirschman index on gross weights (0..1). 1 = everything in one bucket. */
  hhi: number;
  /** 1 / HHI — "effective number" of buckets */
  effectiveN: number;
  top: string | null;
}

/** Herfindahl index of a set of (non-negative) weights, normalised to sum to 1. */
export function hhi(weights: number[]): number {
  const s = weights.reduce((a, b) => a + Math.abs(b), 0);
  if (!s) return 0;
  return weights.reduce((a, w) => a + (Math.abs(w) / s) ** 2, 0);
}

export function concentrationBy(v: Valuation, key: 'sector' | 'country' | 'ticker'): Concentration {
  const m = new Map<string, ExposureBucket>();
  for (const p of v.positions) {
    const k = (p[key] as string) || UNCLASSIFIED;
    const b = m.get(k) ?? { key: k, long: 0, short: 0, net: 0, gross: 0, netWeight: 0, grossWeight: 0, count: 0 };
    if (p.marketValue >= 0) b.long += p.marketValue; else b.short += -p.marketValue;
    b.count++;
    m.set(k, b);
  }
  const buckets = Array.from(m.values()).map((b) => {
    const net = b.long - b.short;
    const gross = b.long + b.short;
    return { ...b, net, gross, netWeight: v.nav ? net / v.nav : 0, grossWeight: v.grossExposure ? gross / v.grossExposure : 0 };
  }).sort((a, b) => b.gross - a.gross);
  const h = hhi(buckets.map((b) => b.gross));
  return { buckets, hhi: h, effectiveN: h ? 1 / h : 0, top: buckets[0]?.key ?? null };
}
