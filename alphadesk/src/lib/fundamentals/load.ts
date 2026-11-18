import 'server-only';
import { getMarketData } from '@/lib/data';
import type { Bar, DataMeta, FinancialStatementRow, SourceRef } from '@/lib/data/types';
import { fmpEnabled, fmpGet } from '@/lib/data/fmp';
import { FMP_PROFILE_URL, getFmpProfile } from '@/lib/data/fmpProfile';
import { fredLatest } from '@/lib/markets/fred';
import { periodSource } from '@/components/company/lib/helpers';
import { log } from '@/lib/log';
import { buildFundamentals, type YieldPoint } from './build';
import { isFinancialCompany, isNum, regressionBeta, type DcfParams } from './formulas';
import type { FundamentalsModel } from './types';

const md = () => getMarketData();

async function fredPoint(series: string): Promise<YieldPoint | null> {
  const y = await fredLatest(series);
  return y && isNum(y.value) ? { value: y.value, date: y.date, series } : null;
}

/** Beta from the FMP company profile (shares the budgeted fmpGet path + cache with getFmpProfile). */
async function fmpBeta(T: string): Promise<number | null> {
  if (!fmpEnabled()) return null;
  try {
    const body = await fmpGet<Record<string, unknown>[]>(`profile?symbol=${encodeURIComponent(T)}`, 24 * 3600_000);
    const b = Array.isArray(body) ? body[0]?.beta : null;
    return isNum(b) && b > 0 ? b : null;
  } catch {
    return null;
  }
}

/** Weekly-return OLS beta vs SPY over the last ~2 years of daily bars (fallback when FMP has no beta). */
function historyBeta(asset: Bar[], market: Bar[]): number | null {
  const m = new Map(market.map((b) => [b.date.slice(0, 10), b.close]));
  const pairs = asset.map((b) => [b.close, m.get(b.date.slice(0, 10))] as const).filter((p): p is readonly [number, number] => isNum(p[1]));
  const weekly = pairs.filter((_, i) => (pairs.length - 1 - i) % 5 === 0).slice(-105);
  const b = regressionBeta(weekly.map((p) => p[0]), weekly.map((p) => p[1]), 52);
  return b != null && b > 0 && b < 5 ? b : null;
}

/**
 * Loads price (Alpaca chain), SEC statements, consensus (Alpha Vantage), FRED yields, FMP profile/beta and 5Y history,
 * then builds the Fundamental values model. Never throws for missing data — the model carries not-applicable states.
 */
export async function loadFundamentals(ticker: string, overrides?: Partial<DcfParams>): Promise<FundamentalsModel> {
  const T = ticker.toUpperCase();
  const [p, q, fa, fq, e, f, h, fmp, rf, daaa] = await Promise.all([
    md().getProfile(T), md().getQuote(T), md().getFinancials(T, 'annual'), md().getFinancials(T, 'quarterly'), md().getEstimates(T),
    md().getFilings(T), md().getHistory(T, '5Y'), getFmpProfile(T).catch(() => null), fredPoint('DGS10'), fredPoint('DAAA'),
  ]);
  const aaa = daaa ?? (await fredPoint('AAA'));
  const bars = h.data ?? [];
  const price = q.data?.price ?? bars[bars.length - 1]?.close ?? null;
  const priceMock = q.data ? q.meta.isMock : h.meta.isMock;
  const finMeta = fq.data ? fq.meta : fa.meta;
  const finMock = !!(fa.data || fq.data) && finMeta.isMock;
  // never mix simulated statements/consensus into a live price (same rule as the deep-dive header)
  const mixing = finMock && !priceMock;
  const annual: FinancialStatementRow[] = mixing ? [] : fa.data?.rows ?? [];
  const quarterly: FinancialStatementRow[] = mixing ? [] : fq.data?.rows ?? [];
  const estimates = e.data && (!e.meta.isMock || priceMock) ? e.data : null;
  const filings = f.data ?? [];
  const profile = p.data;

  const isFund = !!(fmp?.isEtf || fmp?.isFund);
  const valuable = !isFund && (annual.length > 0 || quarterly.length > 0);
  // beta: FMP profile → regression vs SPY on price history → 1.0 (handled in build)
  let beta: { value: number; basis: string; source: SourceRef } | null = null;
  const fb = valuable ? await fmpBeta(T) : null;
  if (fb != null) {
    beta = { value: fb, basis: 'FMP company profile beta', source: { id: `fmp:profile:${T}`, name: `${T} company profile (Financial Modeling Prep)`, url: FMP_PROFILE_URL(T), kind: 'price', excerpt: `Beta ${fb.toFixed(2)} from the FMP company profile (sensitivity of ${T} returns to the S&P 500).`, locator: 'FMP profile · beta' } };
  } else if (valuable && bars.length > 300) {
    try {
      const spy = await md().getHistory('SPY', '5Y');
      const hb = historyBeta(bars, spy.data ?? []);
      if (hb != null) beta = { value: hb, basis: 'Regression vs SPY, ~2 years of weekly returns', source: { id: `beta:${T}:regression`, name: `${T} beta vs SPY (computed)`, kind: priceMock ? 'mock' : 'price', excerpt: `Beta ${hb.toFixed(2)} = cov(r_${T}, r_SPY) ÷ var(r_SPY) on ~104 weekly returns from daily closes (${h.meta.provider ?? 'price history'}).`, locator: 'Computed from price history' } };
    } catch (err) {
      log.debug('fundamentals.beta_failed', { ticker: T, err: (err as Error).message });
    }
  }

  const isFinancial = isFinancialCompany({ sector: fmp?.sector, industries: [fmp?.industry, profile && !p.meta.isMock ? profile.industry : null] });
  const rowSource = (r: FinancialStatementRow) => periodSource(r, filings, T, { isMock: finMock, cik: profile?.cik, provider: finMeta.provider });

  const qSrc = q.meta.source.find((s) => s.kind === 'price') ?? h.meta.source[0];
  const priceSource: SourceRef = {
    id: qSrc?.id ?? `price:${T}`, name: qSrc?.name ?? `${T} price`, url: qSrc?.url, kind: priceMock ? 'mock' : 'price',
    excerpt: price != null ? `Last price $${price.toFixed(2)}${q.data ? ` as of ${q.data.ts.slice(0, 16).replace('T', ' ')} UTC` : ''} via ${(q.data ? q.meta : h.meta).provider ?? 'provider'}.` : 'No price available.',
    locator: 'Quote',
  };
  const estSrc = estimates ? e.meta.source.find((s) => s.kind === 'estimate') ?? e.meta.source[0] ?? null : null;
  const extra: SourceRef[] = [];
  if (fmp) extra.push({ id: `fmp:profile-page:${T}`, name: `${T} profile — sector ${fmp.sector || 'n/a'}, industry ${fmp.industry || 'n/a'} (Financial Modeling Prep)`, url: FMP_PROFILE_URL(T), kind: 'filing', excerpt: `Classification used to detect funds (ETF: ${fmp.isEtf ? 'yes' : 'no'}, fund: ${fmp.isFund ? 'yes' : 'no'}) and financial companies.`, locator: 'FMP profile' });
  if (profile?.cik) extra.push({ id: `sec:edgar:${profile.cik}`, name: `${T} filings on SEC EDGAR`, url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${profile.cik}&type=10-&dateb=&owner=include&count=40`, kind: 'filing', excerpt: 'Annual (10-K) and quarterly (10-Q) reports — source of EPS, cash flow, equity, debt, cash and diluted shares (XBRL company facts).', locator: 'EDGAR' });

  const metas: DataMeta[] = [q.data ? q.meta : h.meta, ...(annual.length || quarterly.length ? [finMeta] : []), ...(estimates ? [e.meta] : [])];
  const providers = Array.from(new Set([
    ...metas.map((m) => m.provider).filter((x): x is string => !!x && x !== 'none'),
    ...(rf || aaa ? ['FRED'] : []), ...(fmp || beta?.basis.startsWith('FMP') ? ['FMP'] : []),
  ]));

  return buildFundamentals({
    ticker: T, name: fmp?.companyName || profile?.name || null, price, priceSource, annual, quarterly, rowSource,
    estimates, estimatesSource: estSrc, riskFree: rf, aaa, beta, bars, isFund, isFinancial,
    unavailableReason: mixing ? `Only simulated statements are available for ${T}; fundamental values are hidden rather than mixing demo data with live prices.` : undefined,
    overrides, isMock: metas.some((m) => m.isMock && m.provider !== 'none'), providers, extraSources: extra,
  });
}
