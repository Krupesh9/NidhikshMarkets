// Pure valuation formulas for the "Fundamental values" section. No server deps: shared by the server loader,
// the API route and the client (live DCF recalculation). Rates/growth are PERCENT numbers (8.5 = 8.5%) unless noted.

/** Growth cap applied before any formula uses an estimate (percent). */
export const GROWTH_CAP = { min: -10, max: 25 } as const;
/** Default equity risk premium (percent). */
export const DEFAULT_ERP = 5.0;
/** Default terminal (perpetual) growth after year 3 (percent). */
export const DEFAULT_TERMINAL_GROWTH = 2.5;
/** Projection horizon of the DCF (years). */
export const DCF_YEARS = 3;

export const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Clamp a growth estimate to GROWTH_CAP. Returns { value, capped } (capped = the raw value was outside the range). */
export function capGrowth(raw: number, cap: { min: number; max: number } = GROWTH_CAP): { value: number; capped: boolean } {
  const value = clamp(raw, cap.min, cap.max);
  return { value, capped: value !== raw };
}

/**
 * Compound annual growth rate in percent from `start` to `end` over `years`. Null unless both are positive and years > 0
 * (CAGR across a sign change is undefined).
 */
export function cagr(start: number | null | undefined, end: number | null | undefined, years: number): number | null {
  if (!isNum(start) || !isNum(end) || start <= 0 || end <= 0 || !(years > 0)) return null;
  return (Math.pow(end / start, 1 / years) - 1) * 100;
}

// ------------------------------------------------------------------ Graham

/**
 * Benjamin Graham's revised (1974) intrinsic value: V = EPS × (8.5 + 2g) × 4.4 / Y.
 * g = expected annual growth (percent, 7–10y horizon), Y = current AAA corporate bond yield (percent).
 * 8.5 = P/E for a no-growth company; 4.4 = the average AAA yield when Graham published.
 * Null when EPS ≤ 0, Y ≤ 0 or inputs missing (formula is not meaningful for loss-makers).
 */
export function grahamValue(eps: number | null | undefined, gPct: number | null | undefined, yPct: number | null | undefined): number | null {
  if (!isNum(eps) || !isNum(gPct) || !isNum(yPct) || eps <= 0 || yPct <= 0) return null;
  const v = (eps * (8.5 + 2 * gPct) * 4.4) / yPct;
  return v > 0 ? v : null;
}

/** Graham Number √(22.5 × EPS × BVPS) — the max price for a defensive investor (P/E 15 × P/B 1.5). Null when either ≤ 0. */
export function grahamNumber(eps: number | null | undefined, bvps: number | null | undefined): number | null {
  if (!isNum(eps) || !isNum(bvps) || eps <= 0 || bvps <= 0) return null;
  return Math.sqrt(22.5 * eps * bvps);
}

/** Margin of safety (percent) = (value − price) / value. Positive = price below the estimate. */
export function marginOfSafety(value: number | null | undefined, price: number | null | undefined): number | null {
  if (!isNum(value) || !isNum(price) || value <= 0) return null;
  return ((value - price) / value) * 100;
}

/** Upside (percent) of an estimate vs the current price = (value − price) / price. */
export function upsidePct(value: number | null | undefined, price: number | null | undefined): number | null {
  if (!isNum(value) || !isNum(price) || price <= 0) return null;
  return ((value - price) / price) * 100;
}

// ------------------------------------------------------------------ CAPM / beta

/** CAPM cost of equity (percent): rf + β × ERP. */
export function capmCostOfEquity(rfPct: number, beta: number, erpPct = DEFAULT_ERP): number {
  return rfPct + beta * erpPct;
}

/**
 * OLS beta of asset vs market from aligned closing prices (same dates, oldest first): cov(rA, rM) / var(rM)
 * on simple period returns. Null with fewer than `minObs` returns or zero market variance.
 */
export function regressionBeta(asset: number[], market: number[], minObs = 30): number | null {
  const n = Math.min(asset.length, market.length);
  const ra: number[] = [];
  const rm: number[] = [];
  for (let i = 1; i < n; i++) {
    if (asset[i - 1] > 0 && market[i - 1] > 0 && isNum(asset[i]) && isNum(market[i])) {
      ra.push(asset[i] / asset[i - 1] - 1);
      rm.push(market[i] / market[i - 1] - 1);
    }
  }
  if (rm.length < minObs) return null;
  const ma = ra.reduce((s, v) => s + v, 0) / ra.length;
  const mm = rm.reduce((s, v) => s + v, 0) / rm.length;
  let cov = 0;
  let varM = 0;
  for (let i = 0; i < rm.length; i++) {
    cov += (ra[i] - ma) * (rm[i] - mm);
    varM += (rm[i] - mm) ** 2;
  }
  return varM > 0 ? cov / varM : null;
}

// ------------------------------------------------------------------ DCF

export interface DcfInputs {
  /** Base-year (TTM) free cash flow, USD */
  baseFcf: number;
  cash: number;
  totalDebt: number;
  /** Diluted shares */
  shares: number;
  price: number | null;
}
export interface DcfParams {
  /** FCF growth in years 1–3 (percent) */
  growth: number;
  /** discount rate (percent) */
  discount: number;
  /** terminal growth after year 3 (percent) */
  terminal: number;
}
export interface DcfYear { year: number; fcf: number; discountFactor: number; pv: number }
export type DcfResult =
  | {
      ok: true;
      years: DcfYear[];
      sumPvFcf: number;
      terminalValue: number;
      pvTerminal: number;
      enterpriseValue: number;
      netCash: number;
      equityValue: number;
      perShare: number;
      upsidePct: number | null;
      /** share of (PV FCF + PV TV) that comes from the terminal value, percent */
      terminalSharePct: number;
    }
  | { ok: false; reason: string };

/**
 * 3-year equity DCF on free cash flow:
 *   FCF_t = FCF_0 × (1+g)^t, DF_t = 1/(1+r)^t, TV = FCF_3 × (1+gT)/(r − gT), PV(TV) = TV × DF_3,
 *   equity = Σ PV(FCF_t) + PV(TV) + cash − debt, value/share = equity ÷ diluted shares.
 */
export function dcf(inputs: DcfInputs, params: DcfParams, years = DCF_YEARS): DcfResult {
  const { baseFcf, cash, totalDebt, shares, price } = inputs;
  const g = params.growth / 100;
  const r = params.discount / 100;
  const gT = params.terminal / 100;
  if (!isNum(baseFcf) || baseFcf <= 0) return { ok: false, reason: 'Base free cash flow is zero or negative, so a cash-flow DCF is not meaningful.' };
  if (!isNum(shares) || shares <= 0) return { ok: false, reason: 'Diluted share count unavailable.' };
  if (![g, r, gT].every(isNum)) return { ok: false, reason: 'Assumptions are incomplete.' };
  if (r <= -1 || g <= -1) return { ok: false, reason: 'Assumptions out of range.' };
  if (r <= gT) return { ok: false, reason: `Discount rate (${params.discount.toFixed(1)}%) must exceed terminal growth (${params.terminal.toFixed(1)}%), otherwise the terminal value is infinite.` };
  const out: DcfYear[] = [];
  let fcf = baseFcf;
  for (let t = 1; t <= years; t++) {
    fcf = fcf * (1 + g);
    const df = 1 / Math.pow(1 + r, t);
    out.push({ year: t, fcf, discountFactor: df, pv: fcf * df });
  }
  const last = out[out.length - 1];
  const sumPvFcf = out.reduce((s, y) => s + y.pv, 0);
  const terminalValue = (last.fcf * (1 + gT)) / (r - gT);
  const pvTerminal = terminalValue * last.discountFactor;
  const enterpriseValue = sumPvFcf + pvTerminal;
  const netCash = (cash || 0) - (totalDebt || 0);
  const equityValue = enterpriseValue + netCash;
  const perShare = equityValue / shares;
  return {
    ok: true, years: out, sumPvFcf, terminalValue, pvTerminal, enterpriseValue, netCash, equityValue, perShare,
    upsidePct: upsidePct(perShare, price),
    terminalSharePct: enterpriseValue > 0 ? (pvTerminal / enterpriseValue) * 100 : 0,
  };
}

// ------------------------------------------------------------------ ratios

export type PegBand = 'below1' | 'fair' | 'rich';
/** PEG = P/E ÷ EPS growth (percent). Null when P/E ≤ 0 or growth ≤ 0. */
export function peg(pe: number | null | undefined, growthPct: number | null | undefined): number | null {
  if (!isNum(pe) || !isNum(growthPct) || pe <= 0 || growthPct <= 0) return null;
  return pe / growthPct;
}
export function pegBand(v: number): PegBand {
  return v < 1 ? 'below1' : v <= 2 ? 'fair' : 'rich';
}
export const PEG_BAND_TEXT: Record<PegBand, string> = {
  below1: 'Below 1 — the multiple looks low relative to expected growth (potentially undervalued vs growth).',
  fair: '1–2 — the multiple is broadly in line with expected growth.',
  rich: 'Above 2 — the multiple is rich relative to expected growth.',
};

/** Book value per share = total equity ÷ shares. Null when shares ≤ 0. Can be negative. */
export function bookValuePerShare(equity: number | null | undefined, shares: number | null | undefined): number | null {
  if (!isNum(equity) || !isNum(shares) || shares <= 0) return null;
  return equity / shares;
}

/** Price-to-book = price ÷ BVPS. Null when BVPS ≤ 0 (negative book makes the ratio meaningless). */
export function priceToBook(price: number | null | undefined, bvps: number | null | undefined): number | null {
  if (!isNum(price) || !isNum(bvps) || bvps <= 0 || price <= 0) return null;
  return price / bvps;
}

export type DebtToEquity = { kind: 'ratio'; value: number } | { kind: 'negative-equity' } | { kind: 'missing' };
/** Debt-to-equity = total debt ÷ total equity. Negative/zero equity → 'negative-equity' (no ratio). */
export function debtToEquity(debt: number | null | undefined, equity: number | null | undefined): DebtToEquity {
  if (!isNum(debt) || !isNum(equity)) return { kind: 'missing' };
  if (equity <= 0) return { kind: 'negative-equity' };
  return { kind: 'ratio', value: Math.max(0, debt) / equity };
}

// ------------------------------------------------------------------ classification

const FINANCIAL_INDUSTRY = /\bbank|banking|insurance|insurer|reinsurance|capital markets|security brokers|brokerage|savings institution|thrift|asset management|investment bank|financial conglomerate|mortgage finance/i;

/**
 * Banks, insurers, brokers, asset managers: debt is operating funding (deposits, float, repo), so FCF-based DCF and
 * D/E are not meaningful. Decided by the industry / SIC description when one is known; the sector ("Financials" /
 * "Financial Services") is only used when no industry is available, because those sectors also contain payment
 * networks and data vendors (Visa, Mastercard, S&P Global) for which DCF and D/E work fine.
 */
export function isFinancialCompany(input: { sector?: string | null; industries?: (string | null | undefined)[] }): boolean {
  const inds = (input.industries ?? []).filter((s): s is string => !!s && !!s.trim());
  if (inds.length) return inds.some((s) => FINANCIAL_INDUSTRY.test(s));
  return /^financial(s| services)$/i.test((input.sector ?? '').trim());
}
