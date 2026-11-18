// Pure model builder for the "Fundamental values" section: raw provider data in, FundamentalsModel out.
// No server deps (the loader in ./load.ts does the I/O), so it is unit-tested with hand-built fixtures.
import type { Bar, Estimates, FinancialStatementRow, SourceRef } from '@/lib/data/types';
import { compactUsd, deriveValuation, sumLast } from '@/components/company/lib/helpers';
import {
  bookValuePerShare, cagr, capGrowth, capmCostOfEquity, dcf, debtToEquity,
  grahamNumber, grahamValue, isNum, marginOfSafety, peg, pegBand, priceToBook, upsidePct, type DcfInputs, type DcfParams,
} from './formulas';
import { FACTORY_VALUATION_DEFAULTS, type ValuationDefaults } from './defaults';
import type {
  DcfModel, DeModel, FundamentalsKind, FundamentalsModel, GrahamModel, GrowthEstimate, PbModel, PegModel, RateInput, RatioPoint,
} from './types';

export interface YieldPoint { value: number; date: string; series: string }

export interface BuildInput {
  ticker: string;
  name?: string | null;
  asOf?: string;
  price: number | null;
  priceSource: SourceRef;
  /** oldest first */
  annual: FinancialStatementRow[];
  /** oldest first */
  quarterly: FinancialStatementRow[];
  /** filing source for a statement row (10-K / 10-Q link) */
  rowSource: (row: FinancialStatementRow) => SourceRef;
  estimates: Estimates | null;
  estimatesSource: SourceRef | null;
  riskFree: YieldPoint | null;
  aaa: YieldPoint | null;
  beta: { value: number; basis: string; source: SourceRef } | null;
  /** daily bars (≈5Y) for the P/B history */
  bars: Bar[];
  isFund: boolean;
  isFinancial: boolean;
  /** set when the profile/statements could not be loaded or would mix demo data into live prices */
  unavailableReason?: string;
  overrides?: Partial<DcfParams>;
  /** owner's valuation defaults (Settings -> Valuation defaults); factory values when omitted */
  defaults?: ValuationDefaults;
  isMock?: boolean;
  providers?: string[];
  /** extra footer sources (provider pages) */
  extraSources?: SourceRef[];
  now?: Date;
}

/** Fallback risk-free rate (percent) when FRED is unavailable. */
export const FALLBACK_RF = 4.5;
const FRED_URL = (s: string) => `https://fred.stlouisfed.org/series/${s}`;
const pct = (v: number | null | undefined, dp = 1) => (isNum(v) ? `${v.toFixed(dp)}%` : '—');
const usd = (v: number | null | undefined) => (isNum(v) ? `$${v.toFixed(2)}` : '—');
const round1 = (v: number) => Math.round(v * 10) / 10;
const fyNum = (p: string) => { const m = /^FY\s?(\d{4})$/i.exec(p.trim()); return m ? Number(m[1]) : NaN; };
const lastOf = <T,>(a: T[]): T | undefined => a[a.length - 1];

function derived(base: SourceRef | undefined, id: string, name: string, excerpt: string, locator: string, mock = false): SourceRef {
  return { id, name, url: base?.url, kind: mock || base?.kind === 'mock' ? 'mock' : base?.kind ?? 'filing', excerpt, locator };
}

/**
 * SEC XBRL share counts and EPS are as-reported, while price bars are split-adjusted. Detect stock splits as a jump of
 * ≥ 2× (or a ≥ 2× drop for reverse splits) in diluted shares between consecutive periods that is within 6% of a whole
 * ratio, and restate earlier rows' shares × factor and EPS ÷ factor so every row is on today's share basis.
 */
export function adjustForSplits(rows: FinancialStatementRow[]): { rows: FinancialStatementRow[]; splits: { before: string; ratio: number }[] } {
  const out = rows.map((r) => ({ ...r }));
  const splits: { before: string; ratio: number }[] = [];
  let factor = 1;
  for (let i = rows.length - 2; i >= 0; i--) {
    const a = rows[i].sharesOutstanding;
    const b = rows[i + 1].sharesOutstanding;
    if (a > 0 && b > 0) {
      const up = b / a;
      const down = a / b;
      const near = (x: number) => x >= 1.9 && Math.abs(x / Math.round(x) - 1) < 0.06;
      if (near(up)) { factor *= Math.round(up); splits.push({ before: rows[i + 1].periodEnd, ratio: Math.round(up) }); }
      else if (near(down)) { factor /= Math.round(down); splits.push({ before: rows[i + 1].periodEnd, ratio: 1 / Math.round(down) }); }
    }
    if (factor !== 1) {
      out[i].sharesOutstanding = rows[i].sharesOutstanding * factor;
      out[i].eps = rows[i].eps / factor;
    }
  }
  return { rows: out, splits };
}

/** TTM FCF = Σ last 4 quarters (operating cash flow − capex) when the quarters span ~1 year, else latest FY FCF. */
export function ttmFreeCashFlow(annual: FinancialStatementRow[], quarterly: FinancialStatementRow[]): { value: number | null; basis: string; row: FinancialStatementRow | null } {
  const q = quarterly.slice(-4);
  if (q.length === 4) {
    const span = (Date.parse(q[3].periodEnd) - Date.parse(q[0].periodEnd)) / 86_400_000;
    const ocf = sumLast(quarterly, 'operatingCashFlow');
    const capex = sumLast(quarterly, 'capex');
    if (span > 240 && span < 310 && isNum(ocf) && isNum(capex) && ocf !== 0) {
      return { value: ocf - Math.abs(capex), basis: `TTM (4 quarters to ${q[3].periodEnd}): operating cash flow ${compactUsd(ocf)} − capex ${compactUsd(Math.abs(capex))}`, row: q[3] };
    }
  }
  const fy = lastOf(annual);
  if (fy && isNum(fy.operatingCashFlow) && (fy.operatingCashFlow !== 0 || fy.freeCashFlow !== 0)) {
    const v = isNum(fy.freeCashFlow) ? fy.freeCashFlow : fy.operatingCashFlow - Math.abs(fy.capex);
    return { value: v, basis: `FY${fy.fiscalYear}: operating cash flow ${compactUsd(fy.operatingCashFlow)} − capex ${compactUsd(Math.abs(fy.capex))}`, row: fy };
  }
  return { value: null, basis: 'No cash-flow statement available', row: null };
}

/** Annual row ~`years` before the last one (by fiscal year), searching 5 → 3 years back; requires positive values. */
function historicalCagr(annual: FinancialStatementRow[], key: 'eps' | 'freeCashFlow'): { value: number; from: FinancialStatementRow; to: FinancialStatementRow; years: number } | null {
  const to = lastOf(annual);
  if (!to || !isNum(to[key]) || to[key] <= 0) return null;
  for (const n of [5, 4, 3]) {
    const from = annual.find((r) => r.fiscalYear === to.fiscalYear - n && r.fiscalPeriod === 'FY');
    const v = from ? cagr(from[key], to[key], n) : null;
    if (from && v != null) return { value: v, from, to, years: n };
  }
  return null;
}

/**
 * Expected EPS growth (percent). Priority:
 *  1) consensus: CAGR from TTM EPS to the furthest consensus FY EPS ≤ 3 years after the last reported FY,
 *     time adjusted when the TTM window already runs past that FY;
 *  2) historical 3–5y EPS CAGR (SEC annual);  3) historical 3–5y FCF CAGR.
 * The raw estimate is capped to GROWTH_CAP before formulas use it.
 */
export function estimateGrowth(input: {
  epsTtm: number | null; annual: FinancialStatementRow[]; quarterly: FinancialStatementRow[];
  estimates: Estimates | null; estimatesSource: SourceRef | null; ticker: string; rowSource: (r: FinancialStatementRow) => SourceRef;
  /** growth cap (percent); factory -10..+25 */
  cap?: { min: number; max: number };
}): GrowthEstimate {
  const { epsTtm, annual, quarterly, estimates, estimatesSource, ticker } = input;
  const cap = input.cap ?? { min: FACTORY_VALUATION_DEFAULTS.dcf.growthCapMin, max: FACTORY_VALUATION_DEFAULTS.dcf.growthCapMax };
  const done = (raw: number, basis: GrowthEstimate['basis'], label: string, source: SourceRef): GrowthEstimate => {
    const c = capGrowth(raw, cap);
    return {
      value: c.value, raw, capped: c.capped, basis, label, source: { ...source, excerpt: `${label} = ${raw.toFixed(1)}%/yr${c.capped ? `, capped to ${c.value.toFixed(1)}% (formulas use ${cap.min}%…+${cap.max}%)` : ''}.` },
    };
  };
  const lastFy = lastOf(annual);
  if (estimates && isNum(epsTtm) && epsTtm > 0) {
    const baseFy = lastFy?.fiscalYear ?? new Date().getUTCFullYear() - 1;
    // TTM may already include quarters after the last FY end (e.g. 10-Qs filed after the 10-K)
    const lastQ = lastOf(quarterly);
    const aheadYears = lastFy && lastQ ? Math.max(0, Math.round((Date.parse(lastQ.periodEnd) - Date.parse(lastFy.periodEnd)) / 86_400_000 / 91.25)) / 4 : 0;
    const cands = estimates.periods
      .filter((p) => p.metric === 'eps' && isNum(fyNum(p.period)) && p.consensus > 0)
      .map((p) => ({ p, fy: fyNum(p.period) }))
      .filter((x) => x.fy > baseFy && x.fy <= baseFy + 3)
      .sort((a, b) => b.fy - a.fy);
    const pick = cands[0];
    if (pick) {
      const years = Math.max(0.5, pick.fy - baseFy - aheadYears);
      const raw = cagr(epsTtm, pick.p.consensus, years);
      if (raw != null) {
        const label = `Consensus ${pick.p.period} EPS $${pick.p.consensus.toFixed(2)} (${pick.p.numAnalysts || 'n/a'} analysts) vs TTM EPS $${epsTtm.toFixed(2)}, ${years.toFixed(years % 1 ? 2 : 0)}-yr CAGR`;
        return done(raw, 'consensus', label, estimatesSource ?? { id: `est:${ticker}`, name: `${ticker} consensus estimates`, kind: 'estimate' });
      }
    }
    if (isNum(estimates.forwardEps) && estimates.forwardEps > 0) {
      const raw = cagr(epsTtm, estimates.forwardEps, 1);
      if (raw != null) {
        const label = `Consensus forward EPS $${estimates.forwardEps.toFixed(2)}${estimates.forwardBasis ? ` (${estimates.forwardBasis.split(';')[0]})` : ''} vs TTM EPS $${epsTtm.toFixed(2)}, 1-yr`;
        return done(raw, 'consensus', label, estimatesSource ?? { id: `est:${ticker}`, name: `${ticker} consensus estimates`, kind: 'estimate' });
      }
    }
  }
  const he = historicalCagr(annual, 'eps');
  if (he) {
    const label = `Historical diluted EPS CAGR FY${he.from.fiscalYear} $${he.from.eps.toFixed(2)} → FY${he.to.fiscalYear} $${he.to.eps.toFixed(2)} (${he.years} yrs)`;
    return done(he.value, 'historical-eps', label, input.rowSource(he.to));
  }
  const hf = historicalCagr(annual, 'freeCashFlow');
  if (hf) {
    const label = `Historical free-cash-flow CAGR FY${hf.from.fiscalYear} ${compactUsd(hf.from.freeCashFlow)} → FY${hf.to.fiscalYear} ${compactUsd(hf.to.freeCashFlow)} (${hf.years} yrs)`;
    return done(hf.value, 'historical-fcf', label, input.rowSource(hf.to));
  }
  return {
    value: null, raw: null, capped: false, basis: 'none', label: 'No consensus estimate and no positive 3–5 year EPS/FCF history',
    source: { id: `growth:${ticker}:none`, name: `${ticker} growth estimate`, kind: 'estimate', excerpt: 'No consensus EPS estimate and no positive 3–5 year EPS or FCF history to derive a growth rate.' },
  };
}

/** Last close on/before `date` (bars oldest first, YYYY-MM-DD), within `maxGapDays`. */
export function closeOnOrBefore(bars: Bar[], date: string, maxGapDays = 7): Bar | null {
  let lo = 0;
  let hi = bars.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].date.slice(0, 10) <= date) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (found < 0) return null;
  const b = bars[found];
  return (Date.parse(date) - Date.parse(b.date.slice(0, 10))) / 86_400_000 <= maxGapDays ? b : null;
}

function rate(p: YieldPoint | null, series: string, label: string, what: string, override?: number | null): RateInput {
  if (isNum(override)) {
    return {
      value: override, date: null, series: 'override', label: `${label} (owner default)`,
      source: { id: `setting:${series}:override`, name: `${label} — owner default (Settings → Valuation defaults)`, kind: 'estimate', excerpt: `${label} fixed at ${override.toFixed(2)}% by the owner's valuation defaults instead of the live FRED ${series} series. Used as ${what}.`, locator: 'Settings → Valuation defaults' },
    };
  }
  return {
    value: p?.value ?? null, date: p?.date ?? null, series: p?.series ?? series, label,
    source: {
      id: `fred:${p?.series ?? series}`, name: `FRED ${p?.series ?? series} — ${label}`, url: FRED_URL(p?.series ?? series), kind: 'price',
      excerpt: p ? `${label} ${p.value.toFixed(2)}% on ${p.date} (FRED series ${p.series}, Federal Reserve Bank of St. Louis). Used as ${what}.` : `FRED ${series} unavailable (no FRED_API_KEY or request failed).`,
      locator: `FRED ${p?.series ?? series}`,
    },
  };
}

export function buildFundamentals(input: BuildInput): FundamentalsModel {
  const { ticker, price, rowSource } = input;
  const adjA = adjustForSplits(input.annual);
  const adjQ = adjustForSplits(input.quarterly);
  const annual = adjA.rows;
  const quarterly = adjQ.rows;
  const asOf = input.asOf ?? (input.now ?? new Date()).toISOString();
  const latest = lastOf(quarterly) ?? lastOf(annual) ?? null;
  const latestSrc = latest ? rowSource(latest) : undefined;
  const mock = !!input.isMock;
  const cfg = input.defaults ?? FACTORY_VALUATION_DEFAULTS;
  const gc = { basePe: cfg.graham.basePe, growthMultiplier: cfg.graham.growthMultiplier, baseYield: cfg.graham.baseYield };
  const cap = { min: cfg.dcf.growthCapMin, max: cfg.dcf.growthCapMax };
  const riskFree = rate(input.riskFree, 'DGS10', '10-year Treasury yield', 'the risk-free rate in the DCF discount rate', cfg.dcf.riskFreeOverride);
  const aaa = rate(input.aaa, 'DAAA', "Moody's Aaa corporate bond yield", "Graham's Y", cfg.graham.aaaOverride);

  const val = deriveValuation({ price, marketCap: null, annual, quarterly });
  const epsTtm = val.epsTtm;
  const growth = estimateGrowth({ epsTtm, annual, quarterly, estimates: input.estimates, estimatesSource: input.estimatesSource, ticker, rowSource, cap });

  const shares = latest?.sharesOutstanding && latest.sharesOutstanding > 0 ? latest.sharesOutstanding : null;
  const equity = latest && isNum(latest.totalEquity) ? latest.totalEquity : null;
  const debt = latest && isNum(latest.totalDebt) ? latest.totalDebt : null;
  const cash = latest && isNum(latest.cash) ? latest.cash : null;
  const bvps = bookValuePerShare(equity, shares);
  const bsLabel = latest ? `${latest.fiscalPeriod === 'FY' ? `FY${latest.fiscalYear}` : `${latest.fiscalPeriod} FY${latest.fiscalYear}`} balance sheet (period ended ${latest.periodEnd})` : 'balance sheet';

  let kind: FundamentalsKind = 'company';
  let reason: string | undefined;
  if (input.isFund) { kind = 'fund'; reason = 'Not applicable to funds: ETFs and mutual funds hold baskets of securities and have no earnings, book value or cash flows of their own to value.'; }
  else if (input.unavailableReason || (!annual.length && !quarterly.length)) { kind = 'unavailable'; reason = input.unavailableReason ?? `No SEC financial statements are available for ${ticker} (often an ETF, fund, ADR or recent listing), so fundamental values cannot be computed.`; }
  else if (input.isFinancial) kind = 'financial';

  // ---------------- Graham
  const gFixed = cfg.graham.growthMode === 'fixed';
  const gGraham = gFixed ? cfg.graham.fixedGrowth : growth.value != null ? Math.max(0, growth.value) : null;
  const gLabel = gFixed ? `owner default g = ${cfg.graham.fixedGrowth}% (fixed)` : `${growth.label}${growth.value != null && growth.value < 0 ? ' (negative growth floored at 0% for Graham)' : ''}`;
  const gv = grahamValue(epsTtm, gGraham, aaa.value, gc);
  const gn = grahamNumber(epsTtm, bvps);
  const grahamReason = !isNum(epsTtm) ? 'No diluted EPS reported.' : epsTtm <= 0 ? 'Not meaningful: trailing EPS is negative or zero, and the Graham formula needs positive earnings.'
    : gGraham == null ? 'No growth estimate available.' : aaa.value == null ? "Moody's Aaa yield unavailable from FRED." : undefined;
  const graham: GrahamModel = {
    status: gv != null ? 'ok' : 'nm', reason: gv != null ? undefined : grahamReason,
    eps: epsTtm, epsBasis: val.epsBasis, g: gGraham, y: aaa.value, value: gv, constants: gc, growthMode: cfg.graham.growthMode, grahamNumber: gn, bvps,
    marginOfSafety: marginOfSafety(gv, price), upsidePct: upsidePct(gv, price),
    source: derived(latestSrc, `fund:${ticker}:graham`, `${ticker} Graham intrinsic value (derived)`,
      gv != null
        ? `V = EPS × (${gc.basePe} + ${gc.growthMultiplier}g) × ${gc.baseYield} / Y = $${epsTtm!.toFixed(2)} × (${gc.basePe} + ${gc.growthMultiplier} × ${gGraham!.toFixed(1)}) × ${gc.baseYield} / ${aaa.value!.toFixed(2)} = $${gv.toFixed(2)}. EPS: ${val.epsBasis}. g: ${gLabel}. Y: ${aaa.series === 'override' ? `owner default ${aaa.value!.toFixed(2)}%` : `Moody's Aaa ${aaa.value!.toFixed(2)}% (FRED ${aaa.series}, ${aaa.date})`}.`
        : `Graham value not computed — ${grahamReason}`,
      'Derived: Graham (1974 revised) formula', mock),
    numberSource: derived(latestSrc, `fund:${ticker}:graham-number`, `${ticker} Graham Number (derived)`,
      gn != null ? `Graham Number = √(22.5 × EPS × BVPS) = √(22.5 × $${epsTtm!.toFixed(2)} × $${bvps!.toFixed(2)}) = $${gn.toFixed(2)}. BVPS = equity ${compactUsd(equity!)} ÷ ${(shares! / 1e6).toFixed(0)}M diluted shares (${bsLabel}).`
        : 'Graham Number not computed — needs positive EPS and positive book value per share.',
      'Derived: Graham Number', mock),
  };

  // ---------------- DCF
  const fcf = ttmFreeCashFlow(annual, quarterly);
  const betaV = input.beta?.value ?? 1;
  const betaBasis = input.beta?.basis ?? 'Default β = 1.0 (no beta available)';
  const betaSource = input.beta?.source ?? { id: `beta:${ticker}:default`, name: `${ticker} beta (default)`, kind: 'price' as const, excerpt: 'No beta available from FMP or price history; using the market beta of 1.0.' };
  const rf = riskFree.value ?? FALLBACK_RF;
  const erp = cfg.dcf.erp;
  const capmDiscount = round1(capmCostOfEquity(rf, betaV, erp));
  const defDiscount = cfg.dcf.discountMode === 'fixed' ? cfg.dcf.fixedDiscount : capmDiscount;
  const defGrowth = cfg.dcf.growthMode === 'fixed' ? cfg.dcf.fixedGrowth : growth.value != null ? round1(growth.value) : cfg.dcf.terminal;
  const defaults: DcfParams = { growth: defGrowth, discount: defDiscount, terminal: cfg.dcf.terminal };
  const growthBasis = cfg.dcf.growthMode === 'fixed'
    ? `Default growth ${cfg.dcf.fixedGrowth}% (fixed, set in Settings → Valuation defaults)`
    : growth.value != null ? `Default growth from ${growth.label}${growth.capped ? ` (capped to ${cap.min}%…+${cap.max}%)` : ''}` : `No growth estimate; default growth = terminal growth ${cfg.dcf.terminal}%`;
  const rfText = `rf ${rf.toFixed(2)}%${riskFree.series === 'override' ? ' (owner default)' : riskFree.value == null ? ' (fallback; FRED unavailable)' : ` (10-yr Treasury, FRED DGS10 ${riskFree.date})`}`;
  const discountBasis = cfg.dcf.discountMode === 'fixed'
    ? `Default discount rate ${cfg.dcf.fixedDiscount}% (fixed, set in Settings → Valuation defaults); CAPM would give ${capmDiscount.toFixed(1)}%`
    : `Default discount rate = CAPM cost of equity = ${rfText} + β ${betaV.toFixed(2)} × ERP ${erp.toFixed(1)}% = ${capmDiscount.toFixed(1)}%`;
  const params: DcfParams = {
    growth: isNum(input.overrides?.growth) ? input.overrides!.growth! : defaults.growth,
    discount: isNum(input.overrides?.discount) ? input.overrides!.discount! : defaults.discount,
    terminal: isNum(input.overrides?.terminal) ? input.overrides!.terminal! : defaults.terminal,
  };
  const dcfInputs: DcfInputs | null = fcf.value != null && shares ? { baseFcf: fcf.value, cash: cash ?? 0, totalDebt: debt ?? 0, shares, price } : null;
  let dcfModel: DcfModel;
  const dcfBase = {
    inputs: dcfInputs, baseFcfBasis: fcf.basis, defaults, params,
    beta: { value: betaV, basis: betaBasis, source: betaSource }, erp, growthBasis, discountBasis, growthMode: cfg.dcf.growthMode, discountMode: cfg.dcf.discountMode,
    balanceSource: derived(latestSrc, `fund:${ticker}:bs`, latestSrc?.name ?? `${ticker} balance sheet`,
      `Cash ${isNum(cash) ? compactUsd(cash) : '—'}, total debt ${isNum(debt) ? compactUsd(debt) : '—'}, total equity ${isNum(equity) ? compactUsd(equity) : '—'}, diluted shares ${shares ? `${(shares / 1e6).toFixed(0)}M` : '—'} — ${bsLabel}.`,
      latestSrc?.locator ?? 'Balance sheet', mock),
  };
  const dcfSourceText = `${discountBasis}. Base FCF: ${fcf.basis}. ${growthBasis}. Terminal growth ${cfg.dcf.terminal}%.`;
  if (kind === 'financial') {
    dcfModel = { ...dcfBase, status: 'nm', reason: 'Not meaningful for financial companies: for banks, insurers and brokers, debt and deposits are raw material rather than financing, and "free cash flow" mixes in lending and investment flows. Price-to-book is the more useful yardstick.', result: null, source: derived(latestSrc, `fund:${ticker}:dcf`, `${ticker} DCF`, 'DCF is not computed for financial companies.', 'Derived', mock) };
  } else if (!dcfInputs) {
    dcfModel = { ...dcfBase, status: 'nm', reason: fcf.value == null ? 'No cash-flow statement available.' : 'Diluted share count unavailable.', result: null, source: derived(latestSrc, `fund:${ticker}:dcf`, `${ticker} DCF`, 'Inputs unavailable.', 'Derived', mock) };
  } else {
    const result = dcf(dcfInputs, params);
    dcfModel = {
      ...dcfBase, status: result.ok ? 'ok' : 'nm', reason: result.ok ? undefined : result.reason, result,
      source: derived(latestSrc, `fund:${ticker}:dcf`, `${ticker} 3-year DCF (derived)`,
        result.ok ? `Value/share = (Σ PV(FCF₁…₃) ${compactUsd(result.sumPvFcf)} + PV(terminal) ${compactUsd(result.pvTerminal)} + cash ${compactUsd(dcfInputs.cash)} − debt ${compactUsd(dcfInputs.totalDebt)}) ÷ ${(dcfInputs.shares / 1e6).toFixed(0)}M shares = $${result.perShare.toFixed(2)}. ${dcfSourceText}` : `${result.reason} ${dcfSourceText}`,
        'Derived: 3-year discounted cash flow', mock),
    };
  }

  // ---------------- PEG
  const pegGrowth = growth.basis === 'consensus' || growth.basis === 'historical-eps' ? growth.raw : null;
  const pegV = peg(val.pe, pegGrowth);
  const pegReason = val.pe == null ? 'Not meaningful: P/E needs positive trailing earnings.' : pegGrowth == null ? 'No EPS growth estimate available.' : pegGrowth <= 0 ? 'Not meaningful: expected EPS growth is zero or negative.' : undefined;
  const pegModel: PegModel = {
    status: pegV != null ? 'ok' : 'nm', reason: pegV != null ? undefined : pegReason,
    value: pegV, pe: val.pe, peBasis: val.peBasis, growth: pegGrowth, growthBasis: growth.basis, growthLabel: growth.label, band: pegV != null ? pegBand(pegV, cfg.peg) : null, thresholds: { fairFrom: cfg.peg.fairFrom, richAbove: cfg.peg.richAbove },
    source: derived(latestSrc, `fund:${ticker}:peg`, `${ticker} PEG ratio (derived)`,
      pegV != null ? `PEG = P/E ${val.pe!.toFixed(1)}x ÷ EPS growth ${pegGrowth!.toFixed(1)} (%/yr) = ${pegV.toFixed(2)}. P/E: ${val.peBasis}. Growth (${growth.basis === 'consensus' ? 'forward consensus' : 'historical'}; uncapped): ${growth.label}.` : `PEG not computed — ${pegReason}`,
      'Derived: PEG', mock),
  };

  // ---------------- P/B
  const pbV = priceToBook(price, bvps);
  const pbHistory: RatioPoint[] = [];
  const deHistory: RatioPoint[] = [];
  const fyRows = annual.filter((r) => r.fiscalPeriod === 'FY').slice(-5);
  for (const r of fyRows) {
    const src = rowSource(r);
    const b = closeOnOrBefore(input.bars, r.periodEnd);
    const rb = bookValuePerShare(r.totalEquity, r.sharesOutstanding);
    const v = b ? priceToBook(b.close, rb) : null;
    pbHistory.push({
      label: `FY${r.fiscalYear}`, fiscalYear: r.fiscalYear, periodEnd: r.periodEnd, value: v, negativeEquity: isNum(r.totalEquity) && r.totalEquity <= 0, source: src,
      detail: b && rb != null ? `Close $${b.close.toFixed(2)} on ${b.date.slice(0, 10)} ÷ BVPS $${rb.toFixed(2)} (equity ${compactUsd(r.totalEquity)} ÷ ${(r.sharesOutstanding / 1e6).toFixed(0)}M sh)` : !b ? 'No price history at fiscal year-end' : 'Book value unavailable',
    });
    const d = debtToEquity(r.totalDebt, r.totalEquity);
    deHistory.push({
      label: `FY${r.fiscalYear}`, fiscalYear: r.fiscalYear, periodEnd: r.periodEnd, value: d.kind === 'ratio' ? d.value : null, negativeEquity: d.kind === 'negative-equity', source: src,
      detail: d.kind === 'ratio' ? `Debt ${compactUsd(r.totalDebt)} ÷ equity ${compactUsd(r.totalEquity)}` : d.kind === 'negative-equity' ? `Negative equity (${compactUsd(r.totalEquity)})` : 'Not reported',
    });
  }
  if (latest && pbV != null) pbHistory.push({ label: 'Now', fiscalYear: latest.fiscalYear, periodEnd: latest.periodEnd, value: pbV, source: latestSrc!, detail: `Price ${usd(price)} ÷ BVPS ${usd(bvps)} (${bsLabel})` });
  const pbReason = equity != null && equity <= 0 ? 'Not meaningful: book value (shareholders’ equity) is negative.' : price == null ? 'Price unavailable.' : 'Book value or share count unavailable.';
  const pb: PbModel = {
    status: pbV != null ? 'ok' : 'nm', reason: pbV != null ? undefined : pbReason, value: pbV, bvps, equity, shares, asOf: latest?.periodEnd ?? null, history: pbHistory,
    source: derived(latestSrc, `fund:${ticker}:pb`, `${ticker} price-to-book (derived)`,
      pbV != null ? `P/B = price ${usd(price)} ÷ BVPS $${bvps!.toFixed(2)} = ${pbV.toFixed(2)}x. BVPS = total equity ${compactUsd(equity!)} ÷ ${(shares! / 1e6).toFixed(0)}M diluted shares (${bsLabel}).` : `P/B not computed — ${pbReason}`,
      'Derived: price ÷ book value per share', mock),
  };

  // ---------------- D/E
  const deNow = debtToEquity(debt, equity);
  const latestDePoint = latest && deNow.kind !== 'missing' && latest.periodEnd !== lastOf(fyRows)?.periodEnd ? [{ label: 'Now', fiscalYear: latest.fiscalYear, periodEnd: latest.periodEnd, value: deNow.kind === 'ratio' ? deNow.value : null, negativeEquity: deNow.kind === 'negative-equity', source: latestSrc!, detail: `Debt ${compactUsd(debt!)} ÷ equity ${compactUsd(equity!)} (${bsLabel})` }] : [];
  const de: DeModel = kind === 'financial'
    ? { status: 'nm', reason: 'Not meaningful for financial companies: deposits, policy reserves and repo funding are operating liabilities, so leverage is judged with regulatory capital ratios instead.', value: null, debt, equity, asOf: latest?.periodEnd ?? null, history: [], source: derived(latestSrc, `fund:${ticker}:de`, `${ticker} debt-to-equity`, 'D/E is not computed for financial companies.', 'Derived', mock) }
    : {
      status: deNow.kind === 'ratio' ? 'ok' : deNow.kind === 'negative-equity' ? 'negative-equity' : 'nm',
      reason: deNow.kind === 'negative-equity' ? `Shareholders’ equity is negative (${compactUsd(equity!)}), usually from buybacks or accumulated losses — a D/E ratio would be misleading.` : deNow.kind === 'missing' ? 'Debt or equity not reported.' : undefined,
      value: deNow.kind === 'ratio' ? deNow.value : null, debt, equity, asOf: latest?.periodEnd ?? null, history: [...deHistory, ...latestDePoint],
      source: derived(latestSrc, `fund:${ticker}:de`, `${ticker} debt-to-equity (derived)`,
        deNow.kind === 'ratio' ? `D/E = total debt ${compactUsd(debt!)} ÷ total equity ${compactUsd(equity!)} = ${deNow.value.toFixed(2)}x (${bsLabel}). Total debt = long-term + short-term borrowings (excludes operating leases).` : deNow.kind === 'negative-equity' ? `Total equity is negative (${compactUsd(equity!)}); D/E not shown.` : 'Debt or equity not reported.',
        'Derived: total debt ÷ total equity', mock),
    };

  // ---------------- sources + notes
  const sources: SourceRef[] = [];
  const seen = new Set<string>();
  const add = (s: SourceRef | undefined | null) => { if (s && !seen.has(s.id)) { seen.add(s.id); sources.push(s); } };
  add(latestSrc);
  if (lastOf(annual)) add(rowSource(lastOf(annual)!));
  add(input.priceSource);
  add(riskFree.source);
  add(aaa.source);
  add(input.estimatesSource);
  add(input.beta?.source);
  for (const s of input.extraSources ?? []) add(s);

  const notes: string[] = [];
  const splitList = [...adjA.splits, ...adjQ.splits].filter((x, i, a) => a.findIndex((y) => y.ratio === x.ratio) === i);
  if (splitList.length) notes.push(`Stock split${splitList.length > 1 ? 's' : ''} detected (${splitList.map((x) => (x.ratio >= 1 ? `${x.ratio}-for-1` : `1-for-${Math.round(1 / x.ratio)}`)).join(', ')}); earlier periods' EPS and share counts are restated to today's share basis to match split-adjusted prices.`);
  if (growth.capped) notes.push(`Growth estimate ${pct(growth.raw)} capped to ${pct(growth.value)} for the Graham and DCF formulas (range ${cap.min}%…+${cap.max}%); PEG uses the uncapped figure.`);
  if (growth.basis === 'consensus') notes.push('Consensus EPS is typically analyst-adjusted (non-GAAP) while TTM EPS is GAAP diluted from SEC filings, which can overstate or understate implied growth.');
  if (cfg.dcf.discountMode === 'capm' && riskFree.value == null) notes.push(`10-year Treasury yield unavailable; DCF uses a fallback risk-free rate of ${FALLBACK_RF}%.`);
  if (cfg.dcf.discountMode === 'capm' && !input.beta) notes.push('No beta available; DCF uses β = 1.0.');
  if (kind !== 'financial') notes.push('DCF is a simplified equity DCF: free cash flow (operating cash flow − capex, before interest is netted out) discounted at the cost of equity, then cash added and debt subtracted. It ignores the debt share of the capital structure (no WACC), stock-based compensation and leases.');

  return {
    ticker, name: input.name ?? null, kind, reason, asOf, isMock: mock, providers: input.providers ?? [], price, priceSource: input.priceSource,
    growth, riskFree, aaa, graham, dcf: dcfModel, peg: pegModel, pb, de, valuation: cfg, sources, notes,
  };
}
