import 'server-only';
// Research tools exposed to every LLM provider. Inputs are zod-validated (tool-schemas.ts); every result
// carries SourceRefs. Fields named `cite` / `*Cite` hold source ids that the agent rewrites to `[n]` numbers.
import { getMarketData } from '@/lib/data';
import { GICS_SECTORS, type FinancialStatementRow, type GicsSector, type SourceRef, type WithMeta } from '@/lib/data/types';
import type { SessionUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { portfolioRepo } from '@/lib/repos';
import { getPortfolioAnalytics } from '@/lib/analytics/server';
import { bqlField } from './bql';
import { cagr, mult, pct, round, usdB } from './format';
import { METRIC_LABEL, findSector, type Metric } from './intent';
import { rankChunks, type Chunk } from './search';
import { validateToolInput, isToolName, type ToolInput, type ToolName } from './tool-schemas';
import type { ChartBlock, StructuredBlock, TableBlock } from './types';

export interface ToolContext {
  user: Pick<SessionUser, 'id' | 'orgId'> | null;
}

export interface ToolOutput {
  data: unknown;
  sources: SourceRef[];
  /** structured blocks shown to the user automatically; citeIds resolved to [n] by the agent */
  blocks?: { block: StructuredBlock; citeIds: string[] }[];
  isMock: boolean;
  /** short human summary for the tool-step indicator */
  summary: string;
}

const md = () => getMarketData();

function findSectorSafe(s: string): GicsSector | undefined {
  return GICS_SECTORS.find((g) => g.toLowerCase() === s.trim().toLowerCase()) ?? findSector(s);
}

/** Provider source (keeps url/kind/provenance) scoped to this ticker+dataset so ids never collide across companies. */
function sourceOr(meta: WithMeta<unknown>["meta"], fallback: SourceRef): SourceRef {
  const s = meta.source?.[0];
  if (!s) return fallback;
  return { ...s, id: s.id === fallback.id ? s.id : `${s.id}|${fallback.id}`, name: fallback.name, kind: s.kind ?? fallback.kind, locator: s.locator ?? s.name };
}

// ---------- financial helpers ----------

export interface YearPoint {
  fy: number;
  revenue: number;
  growth: number | null;
  grossMargin: number | null;
  operatingMargin: number | null;
  netMargin: number | null;
  fcfMargin: number | null;
  eps: number | null;
}

const margin = (num: number, rev: number) => (rev > 0 && Number.isFinite(num) ? round((num / rev) * 100, 1) : null);

function toPoints(rows: FinancialStatementRow[]): YearPoint[] {
  const sorted = [...rows].sort((a, b) => a.fiscalYear - b.fiscalYear || a.periodEnd.localeCompare(b.periodEnd));
  return sorted.map((r, i) => {
    const prev = sorted[i - 1];
    return {
      fy: r.fiscalYear,
      revenue: r.revenue,
      growth: prev && prev.revenue > 0 ? round((r.revenue / prev.revenue - 1) * 100, 1) : null,
      grossMargin: margin(r.grossProfit, r.revenue),
      operatingMargin: margin(r.operatingIncome, r.revenue),
      netMargin: margin(r.netIncome, r.revenue),
      fcfMargin: margin(r.freeCashFlow, r.revenue),
      eps: Number.isFinite(r.eps) ? round(r.eps, 2) : null,
    };
  });
}

async function financialSeries(ticker: string, years: number, period: 'annual' | 'quarterly' = 'annual') {
  const r = await md().getFinancials(ticker, period);
  const rows = r.data?.rows ?? [];
  const all = toPoints(rows);
  const pts = all.slice(-years);
  const base = r.meta.source?.[0];
  const first = pts[0];
  const last = pts[pts.length - 1];
  const excerpt = pts
    .map((p) => `FY${p.fy}: revenue ${usdB(p.revenue)}${p.growth != null ? ` (${pct(p.growth, 1, true)} YoY)` : ''}, gross margin ${pct(p.grossMargin)}, operating margin ${pct(p.operatingMargin)}, net margin ${pct(p.netMargin)}.`)
    .join(' ');
  const src: SourceRef = {
    id: `${base?.id ?? 'data:financials'}|${ticker}:${period}:${first?.fy ?? ''}-${last?.fy ?? ''}`,
    name: `${ticker} ${period === 'annual' ? '10-K' : '10-Q'} financial statements${r.meta.isMock ? ' (simulated)' : ''}`,
    url: base?.url,
    kind: base?.kind ?? (r.meta.isMock ? 'mock' : 'filing'),
    locator: first && last ? `Income statement & cash flow, FY${first.fy}–FY${last.fy}` : undefined,
    excerpt: excerpt || undefined,
  };
  return { points: pts, all, source: src, isMock: r.meta.isMock, provider: r.meta.provider, currency: r.data?.currency ?? 'USD' };
}

// ---------- tools ----------

async function getCompanySnapshot({ ticker }: ToolInput<'get_company_snapshot'>): Promise<ToolOutput> {
  const [p, q, e] = await Promise.all([md().getProfile(ticker), md().getQuote(ticker), md().getEstimates(ticker)]);
  if (!p.data && !q.data) return { data: { error: `No data found for ${ticker}. Check the symbol.` }, sources: [], isMock: true, summary: `${ticker}: not found` };
  const prof = p.data;
  const quote = q.data;
  const est = e.data;
  const fyEps = est?.periods.find((x) => x.metric === 'eps' && /^FY/.test(x.period));
  const fyRev = est?.periods.find((x) => x.metric === 'revenue' && /^FY/.test(x.period));

  const profSrc: SourceRef = {
    ...sourceOr(p.meta, { id: `data:profile:${ticker}`, name: `${ticker} company profile`, kind: p.meta.isMock ? 'mock' : 'filing' }),
    excerpt: prof
      ? `${prof.name} (${prof.sector} / ${prof.industry}), HQ ${prof.hq}. Market cap ${usdB(prof.marketCap)}; P/E ${mult(prof.pe)}, forward P/E ${mult(prof.forwardPe)}, EV/EBITDA ${mult(prof.evEbitda)}; beta ${prof.beta.toFixed(2)}.`
      : undefined,
  };
  if (!profSrc.name.includes('profile') && prof) profSrc.name = `${prof.name} — company profile${p.meta.isMock ? ' (simulated)' : ''}`;
  const quoteSrc: SourceRef = {
    ...sourceOr(q.meta, { id: `data:price:${ticker}`, name: `${ticker} quote`, kind: 'price' }),
    excerpt: quote ? `${ticker} last ${quote.price.toFixed(2)} (${pct(quote.changePct, 2, true)} on the day), market cap ${usdB(quote.marketCap)}, as of ${quote.ts.slice(0, 16).replace('T', ' ')} UTC.` : undefined,
    locator: q.meta.provider,
  };
  const estSrc: SourceRef | null = est
    ? {
        ...sourceOr(e.meta, { id: `data:estimates:${ticker}`, name: `${ticker} consensus estimates`, kind: 'estimate' }),
        excerpt: `${fyEps ? `${fyEps.period} EPS consensus $${fyEps.consensus.toFixed(2)} (${fyEps.numAnalysts} analysts), ${pct(fyEps.change30dPct, 1, true)} over 30 days. ` : ''}${fyRev ? `${fyRev.period} revenue consensus ${usdB(fyRev.consensus)}. ` : ''}Ratings ${est.rating.buy} buy / ${est.rating.hold} hold / ${est.rating.sell} sell; mean price target $${est.priceTarget.mean.toFixed(2)}.`,
      }
    : null;
  const sources = [profSrc, quoteSrc, ...(estSrc ? [estSrc] : [])];
  return {
    data: {
      ticker,
      name: prof?.name ?? ticker,
      sector: prof?.sector,
      industry: prof?.industry,
      description: prof?.description,
      price: quote?.price,
      changePct: quote?.changePct,
      quoteCite: quoteSrc.id,
      marketCap: usdB(prof?.marketCap ?? quote?.marketCap),
      pe: prof?.pe,
      forwardPe: prof?.forwardPe,
      evEbitda: prof?.evEbitda,
      beta: prof?.beta,
      dividendYield: prof?.dividendYield,
      week52: prof ? { high: prof.week52High, low: prof.week52Low } : undefined,
      profileCite: profSrc.id,
      estimates: est
        ? {
            fyEps: fyEps ? { period: fyEps.period, consensus: fyEps.consensus, analysts: fyEps.numAnalysts, change30dPct: fyEps.change30dPct } : undefined,
            fyRevenue: fyRev ? { period: fyRev.period, consensus: usdB(fyRev.consensus) } : undefined,
            rating: est.rating,
            priceTargetMean: est.priceTarget.mean,
            cite: estSrc?.id,
          }
        : undefined,
    },
    sources,
    isMock: p.meta.isMock || q.meta.isMock,
    summary: `${prof?.name ?? ticker}${quote ? ` · $${quote.price.toFixed(2)}` : ''}`,
  };
}

async function getFinancials({ ticker, period, years }: ToolInput<'get_financials'>): Promise<ToolOutput> {
  const s = await financialSeries(ticker, period === 'quarterly' ? Math.min(years * 4, 40) : years, period);
  if (!s.points.length) return { data: { error: `No ${period} financials for ${ticker}.` }, sources: [], isMock: true, summary: `${ticker}: no financials` };
  return {
    data: { ticker, period, currency: s.currency, provider: s.provider, cite: s.source.id, rows: s.points.map((p) => ({ ...p, revenue: usdB(p.revenue) })) },
    sources: [s.source],
    isMock: s.isMock,
    summary: `${ticker} ${s.points.length} ${period === 'annual' ? 'fiscal years' : 'quarters'}`,
  };
}

export interface CompareCompany {
  ticker: string;
  name: string;
  firstFy: number | null;
  latestFy: number | null;
  revenueLatest: string;
  revenueCagr: number | null;
  revenueGrowthLatest: number | null;
  avgGrowth: number | null;
  grossMarginLatest: number | null;
  grossMarginChangePts: number | null;
  operatingMarginLatest: number | null;
  operatingMarginChangePts: number | null;
  netMarginLatest: number | null;
  fcfMarginLatest: number | null;
  epsLatest: number | null;
  pe: number | null;
  evEbitda: number | null;
  marketCap: string;
  finCite: string;
  profileCite: string | null;
  series: YearPoint[];
}

async function compareCompanies({ tickers, metrics, years }: ToolInput<'compare_companies'>): Promise<ToolOutput> {
  const uniq = [...new Set(tickers)];
  const results = await Promise.all(
    uniq.map(async (t) => {
      const [fin, prof] = await Promise.all([financialSeries(t, years + 1), md().getProfile(t)]);
      return { t, fin, prof };
    }),
  );
  const sources: SourceRef[] = [];
  const companies: CompareCompany[] = [];
  let isMock = false;
  for (const { t, fin, prof } of results) {
    isMock ||= fin.isMock || prof.meta.isMock;
    const pts = fin.points.slice(-years - 1);
    const win = pts.slice(1).length ? pts.slice(1) : pts; // the N-year window (first point only used for growth/CAGR base)
    const first = pts[0];
    const last = pts[pts.length - 1];
    const pr = prof.data;
    let profileCite: string | null = null;
    if (pr) {
      const ps: SourceRef = {
        ...sourceOr(prof.meta, { id: `data:profile:${t}`, name: `${pr.name} — company profile${prof.meta.isMock ? ' (simulated)' : ''}`, kind: prof.meta.isMock ? 'mock' : 'filing' }),
        excerpt: `${pr.name}: market cap ${usdB(pr.marketCap)}; P/E ${mult(pr.pe)}; EV/EBITDA ${mult(pr.evEbitda)}.`,
      };
      sources.push(ps);
      profileCite = ps.id;
    }
    if (fin.points.length) sources.push(fin.source);
    const growths = win.map((p) => p.growth).filter((g): g is number => g != null);
    companies.push({
      ticker: t,
      name: pr?.name ?? t,
      firstFy: first?.fy ?? null,
      latestFy: last?.fy ?? null,
      revenueLatest: usdB(last?.revenue),
      revenueCagr: first && last ? cagr(first.revenue, last.revenue, last.fy - first.fy) : null,
      revenueGrowthLatest: last?.growth ?? null,
      avgGrowth: growths.length ? round(growths.reduce((a, b) => a + b, 0) / growths.length, 1) : null,
      grossMarginLatest: last?.grossMargin ?? null,
      grossMarginChangePts: first?.grossMargin != null && last?.grossMargin != null ? round(last.grossMargin - first.grossMargin, 1) : null,
      operatingMarginLatest: last?.operatingMargin ?? null,
      operatingMarginChangePts: first?.operatingMargin != null && last?.operatingMargin != null ? round(last.operatingMargin - first.operatingMargin, 1) : null,
      netMarginLatest: last?.netMargin ?? null,
      fcfMarginLatest: last?.fcfMargin ?? null,
      epsLatest: last?.eps ?? null,
      pe: pr?.pe ?? null,
      evEbitda: pr?.evEbitda ?? null,
      marketCap: usdB(pr?.marketCap),
      finCite: fin.source.id,
      profileCite,
      series: win,
    });
  }

  // ---- table block ----
  const ms = metrics as Metric[];
  const span = companies[0]?.firstFy && companies[0]?.latestFy ? companies[0].latestFy - companies[0].firstFy : years;
  const cols: TableBlock['columns'] = [{ key: 'company', label: 'Company' }];
  const want = (m: Metric) => ms.includes(m);
  if (want('revenue') || want('revenue_growth')) cols.push({ key: 'revenue', label: `Revenue (FY${companies[0]?.latestFy ?? ''})`, numeric: true });
  if (want('revenue_growth')) {
    cols.push({ key: 'revenueCagr', label: `Rev CAGR (${span}Y)`, numeric: true, format: 'pct' });
    cols.push({ key: 'revenueGrowthLatest', label: 'Rev growth (latest FY)', numeric: true, format: 'pct' });
  }
  if (want('gross_margin')) {
    cols.push({ key: 'grossMarginLatest', label: 'Gross margin', numeric: true, format: 'pct' });
    cols.push({ key: 'grossMarginChangePts', label: `Δ GM (${span}Y, pts)`, numeric: true, format: 'num' });
  }
  if (want('operating_margin')) {
    cols.push({ key: 'operatingMarginLatest', label: 'Operating margin', numeric: true, format: 'pct' });
    cols.push({ key: 'operatingMarginChangePts', label: `Δ OM (${span}Y, pts)`, numeric: true, format: 'num' });
  }
  if (want('net_margin')) cols.push({ key: 'netMarginLatest', label: 'Net margin', numeric: true, format: 'pct' });
  if (want('fcf_margin')) cols.push({ key: 'fcfMarginLatest', label: 'FCF margin', numeric: true, format: 'pct' });
  if (want('eps')) cols.push({ key: 'epsLatest', label: 'EPS (latest FY)', numeric: true, format: 'usd' });
  if (want('pe')) cols.push({ key: 'pe', label: 'P/E', numeric: true, format: 'x' });
  if (want('ev_ebitda')) cols.push({ key: 'evEbitda', label: 'EV/EBITDA', numeric: true, format: 'x' });
  if (want('market_cap')) cols.push({ key: 'marketCap', label: 'Market cap', numeric: true });
  const table: TableBlock = {
    type: 'table',
    title: `${companies.map((c) => c.ticker).join(' vs ')} — ${ms.map((m) => METRIC_LABEL[m]).join(', ')}`,
    columns: cols,
    rows: companies.map((c) => ({
      company: `${c.ticker} · ${c.name.replace(/,? Inc\.?| Corporation/g, '')}`,
      revenue: c.revenueLatest,
      revenueCagr: c.revenueCagr,
      revenueGrowthLatest: c.revenueGrowthLatest,
      grossMarginLatest: c.grossMarginLatest,
      grossMarginChangePts: c.grossMarginChangePts,
      operatingMarginLatest: c.operatingMarginLatest,
      operatingMarginChangePts: c.operatingMarginChangePts,
      netMarginLatest: c.netMarginLatest,
      fcfMarginLatest: c.fcfMarginLatest,
      epsLatest: c.epsLatest,
      pe: c.pe,
      evEbitda: c.evEbitda,
      marketCap: c.marketCap,
    })),
    note: `Fiscal years FY${companies[0]?.firstFy ?? ''}–FY${companies[0]?.latestFy ?? ''}. Margins computed from reported line items.${isMock ? ' Includes simulated demo data.' : ''}`,
  };
  const citeIds = companies.flatMap((c) => [c.finCite, ...(c.profileCite ? [c.profileCite] : [])]);
  const blocks: ToolOutput['blocks'] = [{ block: table, citeIds }];

  // ---- chart blocks ----
  const fys = [...new Set(companies.flatMap((c) => c.series.map((p) => p.fy)))].sort();
  const lineFor = (key: keyof YearPoint, title: string): ChartBlock => ({
    type: 'chart',
    chart: 'line',
    title,
    xKey: 'fy',
    format: 'pct',
    series: companies.map((c) => ({ key: c.ticker, label: c.ticker })),
    data: fys.map((fy) => {
      const row: Record<string, string | number | null> = { fy: `FY${fy}` };
      for (const c of companies) row[c.ticker] = (c.series.find((p) => p.fy === fy)?.[key] as number | null | undefined) ?? null;
      return row;
    }),
  });
  if (want('revenue_growth')) blocks.push({ block: lineFor('growth', 'Revenue growth YoY (%)'), citeIds: companies.map((c) => c.finCite) });
  if (want('operating_margin')) blocks.push({ block: lineFor('operatingMargin', 'Operating margin (%)'), citeIds: companies.map((c) => c.finCite) });
  else if (want('gross_margin')) blocks.push({ block: lineFor('grossMargin', 'Gross margin (%)'), citeIds: companies.map((c) => c.finCite) });
  if (!want('revenue_growth') && !want('operating_margin') && !want('gross_margin') && (want('pe') || want('ev_ebitda'))) {
    blocks.push({
      block: { type: 'chart', chart: 'bar', title: 'Valuation multiples', xKey: 'ticker', format: 'num', series: [{ key: 'pe', label: 'P/E' }, { key: 'evEbitda', label: 'EV/EBITDA' }], data: companies.map((c) => ({ ticker: c.ticker, pe: c.pe, evEbitda: c.evEbitda })) },
      citeIds: companies.map((c) => c.profileCite).filter((x): x is string => !!x),
    });
  }

  return {
    data: { years: span, metrics: ms, bqlFields: ms.map(bqlField), companies },
    sources,
    blocks,
    isMock,
    summary: `${companies.length} companies · ${ms.length} metrics · ${span}Y`,
  };
}

async function runScreen(input: ToolInput<'run_screen'>): Promise<ToolOutput> {
  const r = await md().getScreenRows();
  const sector = input.sector ? findSectorSafe(input.sector) : undefined;
  let rows = r.data.filter((x) => {
    if (sector && x.sector !== sector) return false;
    if (input.minMarketCapB != null && x.marketCap < input.minMarketCapB * 1e9) return false;
    if (input.maxPe != null && !(x.pe > 0 && x.pe <= input.maxPe)) return false;
    if (input.minRevenueGrowth != null && x.revenueGrowth < input.minRevenueGrowth) return false;
    if (input.minEpsRevision != null && x.epsRevision30d < input.minEpsRevision) return false;
    if (input.maxShortInterest != null && x.shortInterestPct > input.maxShortInterest) return false;
    if (input.insiderBuying && !(x.insiderBuying90d > 0)) return false;
    return true;
  });
  const key = { marketCap: 'marketCap', revenueGrowth: 'revenueGrowth', pe: 'pe', epsRevision30d: 'epsRevision30d', insiderBuying90d: 'insiderBuying90d' }[input.sortBy] as 'marketCap';
  rows = rows.sort((a, b) => (input.sortBy === 'pe' ? a.pe - b.pe : (b[key] as number) - (a[key] as number))).slice(0, input.limit);
  const filtersText = [
    sector && `sector = ${sector}`,
    input.minMarketCapB != null && `market cap ≥ $${input.minMarketCapB}B`,
    input.maxPe != null && `P/E ≤ ${input.maxPe}x`,
    input.minRevenueGrowth != null && `revenue growth ≥ ${input.minRevenueGrowth}%`,
    input.minEpsRevision != null && `EPS revisions ≥ ${input.minEpsRevision}%`,
    input.maxShortInterest != null && `short interest ≤ ${input.maxShortInterest}%`,
    input.insiderBuying && 'net insider buying (90d)',
  ].filter(Boolean).join(', ') || 'no filters';
  const src: SourceRef = {
    id: `data:screen:${Buffer.from(JSON.stringify(input)).toString('base64url').slice(0, 40)}`,
    name: `Screen results (${filtersText})${r.meta.isMock ? ' — simulated universe' : ''}`,
    kind: r.meta.isMock ? 'mock' : 'estimate',
    locator: `${rows.length} matches · as of ${r.meta.asOf.slice(0, 10)}`,
    excerpt: rows.map((x) => `${x.ticker}: market cap ${usdB(x.marketCap)}, P/E ${mult(x.pe)}, revenue growth ${pct(x.revenueGrowth)}, EPS revision 30d ${pct(x.epsRevision30d, 1, true)}.`).join(' '),
  };
  const table: TableBlock = {
    type: 'table',
    title: `Screen: ${filtersText}`,
    columns: [
      { key: 'ticker', label: 'Ticker' }, { key: 'name', label: 'Company' }, { key: 'sector', label: 'Sector' },
      { key: 'marketCapB', label: 'Mkt cap', numeric: true, format: 'usdB' }, { key: 'pe', label: 'P/E', numeric: true, format: 'x' },
      { key: 'revenueGrowth', label: 'Rev growth', numeric: true, format: 'pct' }, { key: 'epsRevision30d', label: 'EPS rev 30d', numeric: true, format: 'pct' },
    ],
    rows: rows.map((x) => ({ ticker: x.ticker, name: x.name, sector: x.sector, marketCapB: round(x.marketCap / 1e9, 1), pe: x.pe, revenueGrowth: x.revenueGrowth, epsRevision30d: x.epsRevision30d })),
    note: r.meta.isMock ? 'Simulated universe for the demo.' : undefined,
  };
  return {
    data: {
      filters: filtersText,
      count: rows.length,
      cite: src.id,
      rows: rows.map((x) => ({ ticker: x.ticker, name: x.name, sector: x.sector, marketCap: usdB(x.marketCap), pe: x.pe, revenueGrowth: x.revenueGrowth, epsRevision30d: x.epsRevision30d, shortInterestPct: x.shortInterestPct, insiderBuying90d: x.insiderBuying90d, whyNow: x.whyNow?.headline })),
    },
    sources: [src],
    blocks: rows.length ? [{ block: table, citeIds: [src.id] }] : [],
    isMock: r.meta.isMock,
    summary: `${rows.length} matches`,
  };
}

async function getNews({ ticker, limit, sentiment }: ToolInput<'get_news'>): Promise<ToolOutput> {
  const r = await md().getNews(ticker);
  const items = r.data.filter((n) => !sentiment || n.sentiment === sentiment).slice(0, limit);
  const sources: SourceRef[] = items.map((n) => ({
    id: n.id,
    name: `${n.publisher}: ${n.title}`,
    url: n.url,
    kind: 'news',
    excerpt: n.summary ? `${n.title}. ${n.summary}` : n.title,
    locator: n.publishedAt.slice(0, 10),
  }));
  return {
    data: { ticker: ticker ?? null, items: items.map((n) => ({ title: n.title, publisher: n.publisher, date: n.publishedAt.slice(0, 10), sentiment: n.sentiment, tickers: n.tickers, summary: n.summary, cite: n.id })) },
    sources,
    isMock: r.meta.isMock,
    summary: `${items.length} headlines`,
  };
}

async function buildCorpus(tickers: string[]): Promise<{ chunks: Chunk[]; isMock: boolean }> {
  let isMock = false;
  const chunks: Chunk[] = [];
  await Promise.all(
    tickers.slice(0, 8).map(async (t) => {
      const [f, tr, n] = await Promise.all([md().getFilings(t), md().getTranscripts(t), md().getNews(t)]);
      isMock ||= f.meta.isMock || tr.meta.isMock || n.meta.isMock;
      for (const fl of f.data.slice(0, 8)) {
        (fl.excerpts ?? []).forEach((ex, i) =>
          chunks.push({ id: `${fl.id}#${i}`, ticker: t, title: `${t} ${fl.form} — ${fl.title}`, text: ex.text, url: fl.url, kind: 'filing', locator: `${fl.form} filed ${fl.filedAt} · ${ex.locator}`, date: fl.filedAt }),
        );
      }
      for (const x of tr.data.slice(0, 4)) {
        x.excerpts.forEach((ex, i) =>
          chunks.push({ id: `${x.id}#${i}`, ticker: t, title: x.title, text: `${ex.speaker}: ${ex.text}`, url: x.url, kind: 'transcript', locator: `${x.date} · ${ex.locator}`, date: x.date }),
        );
      }
      for (const nn of n.data.slice(0, 10)) {
        chunks.push({ id: nn.id, ticker: t, title: `${nn.publisher}: ${nn.title}`, text: nn.summary ? `${nn.title}. ${nn.summary}` : nn.title, url: nn.url, kind: 'news', locator: nn.publishedAt.slice(0, 10), date: nn.publishedAt });
      }
    }),
  );
  return { chunks, isMock };
}

async function searchDocuments({ query, tickers, kinds, limit }: ToolInput<'search_documents'>): Promise<ToolOutput> {
  let chunks: Chunk[] = [];
  let isMock = false;
  let backend = 'keyword (TF-IDF) over provider documents';
  try {
    const count = await db.documentChunk.count();
    if (count > 0) {
      const rows = await db.documentChunk.findMany({
        where: { ...(tickers?.length ? { ticker: { in: tickers } } : {}), ...(kinds?.length ? { kind: { in: kinds } } : {}) },
        orderBy: { date: 'desc' },
        take: 2000,
      });
      chunks = rows.map((r) => ({ id: r.sourceId + '#' + r.id, ticker: r.ticker, title: r.title, text: r.text, url: r.url, kind: r.kind, date: r.date?.toISOString() ?? null }));
      backend = 'DocumentChunk index (keyword/TF-IDF)';
    }
  } catch {
    /* table missing -> provider corpus */
  }
  if (!chunks.length) {
    let ts = tickers ?? [];
    if (!ts.length) {
      const u = await md().getUniverse();
      ts = u.data.slice(0, 8).map((x) => x.ticker);
    }
    const c = await buildCorpus(ts);
    chunks = c.chunks;
    isMock = c.isMock;
  }
  if (kinds?.length) chunks = chunks.filter((c) => kinds.includes(c.kind as 'filing'));
  // Rank per ticker so every requested company gets coverage, then merge.
  const groups = tickers?.length ? tickers.map((t) => chunks.filter((c) => c.ticker === t)) : [chunks];
  const perGroup = Math.max(2, Math.ceil(limit / groups.length));
  // Drop weak matches (e.g. only a generic term like "data") relative to the best passage overall.
  const all = groups.map((g) => rankChunks(query, g, 1000));
  const top = Math.max(0, ...all.flat().map((r) => r.score));
  const strong = all.map((g) => g.filter((r) => r.score >= top * 0.3 && (r.matched.length >= 2 || r.score >= top * 0.6)));
  const coverage = Object.fromEntries((tickers ?? []).map((t, i) => [t, strong[i]?.length ?? 0]));
  const ranked = strong.flatMap((g) => g.slice(0, perGroup)).sort((a, b) => b.score - a.score).slice(0, Math.max(limit, groups.length * 2));
  const sources: SourceRef[] = ranked.map((r) => ({
    id: r.id,
    name: r.title,
    url: r.url ?? undefined,
    kind: (['filing', 'transcript', 'news'].includes(r.kind) ? r.kind : 'filing') as SourceRef['kind'],
    excerpt: r.text,
    locator: r.locator,
  }));
  return {
    data: {
      query,
      backend,
      /** relevant passages per requested ticker (keyword-based exposure proxy) */
      coverage,
      documentsSearched: chunks.length,
      passages: ranked.map((r) => ({ ticker: r.ticker, kind: r.kind, title: r.title, locator: r.locator, text: r.text, matched: r.matched, score: r.score, cite: r.id })),
      note: ranked.length ? undefined : 'No matching passages. Try broader terms.',
    },
    sources,
    isMock,
    summary: `${ranked.length} passages`,
  };
}

async function portfolioRisk({ portfolioId }: ToolInput<'portfolio_risk'>, ctx: ToolContext): Promise<ToolOutput> {
  if (!ctx.user) return { data: { available: false, reason: 'Sign in required.' }, sources: [], isMock: false, summary: 'not available' };
  const scope = { orgId: ctx.user.orgId, userId: ctx.user.id };
  const list = await portfolioRepo.list(scope);
  const pf = portfolioId ? list.find((p) => p.id === portfolioId) : list[0];
  if (!pf) return { data: { available: false, reason: 'No portfolios found. Create one under Portfolios first.', portfolios: [] }, sources: [], isMock: false, summary: 'no portfolio' };
  let res: Awaited<ReturnType<typeof getPortfolioAnalytics>>;
  try {
    res = await getPortfolioAnalytics(scope, pf.id);
  } catch (e) {
    return { data: { available: false, portfolio: pf.name, reason: `Portfolio analytics are not available right now (${(e as Error).message}).` }, sources: [], isMock: false, summary: 'not available' };
  }
  if (!res) return { data: { available: false, reason: 'Portfolio not found.' }, sources: [], isMock: false, summary: 'not found' };
  if (res.status !== 'ready') return { data: { available: false, portfolio: pf.name, reason: `${res.message} Ask again in a moment.` }, sources: [], isMock: false, summary: 'computing' };
  const a = res.analytics;
  const v = a.valuation;
  const top = a.exposure.topWeights.slice(0, 5).map((t) => ({ ticker: t.ticker, weightPct: round(t.weight * 100, 1) }));
  const sectors = a.exposure.sector.buckets
    .map((b) => ({ sector: b.key, netWeightPct: round(b.netWeight * 100, 1) }))
    .sort((x, y) => Math.abs(y.netWeightPct) - Math.abs(x.netWeightPct));
  const worst = [...a.stress].sort((x, y) => x.pnl - y.pnl)[0];
  const h1 = a.risk.monteCarlo.horizons.find((h) => h.days === 1) ?? a.risk.monteCarlo.horizons[0];
  const cvar95 = h1?.levels.find((l) => Math.abs(l.confidence - 0.95) < 1e-6)?.cvar;
  const src: SourceRef = {
    id: `data:portfolio:${pf.id}:${res.meta.computedAt}`,
    name: `Portfolio "${pf.name}" — risk analytics vs ${res.benchmark.label}${res.meta.isMock ? ' (simulated prices)' : ''}`,
    kind: res.meta.isMock ? 'mock' : 'price',
    locator: `${res.portfolio.positionCount} positions · ${a.risk.monteCarlo.paths.toLocaleString('en-US')}-path Monte Carlo · computed ${res.meta.computedAt.slice(0, 16).replace('T', ' ')} UTC`,
    excerpt:
      `NAV $${Math.round(v.nav).toLocaleString('en-US')}; gross ${pct(v.grossPct * 100)}, net ${pct(v.netPct * 100)}. ` +
      `Beta ${a.risk.beta.toFixed(2)} (${a.risk.betaSource}); annualised volatility ${pct(a.risk.annualVol * 100)}${a.risk.trackingError != null ? `; tracking error ${pct(a.risk.trackingError * 100)}` : ''}. ` +
      `1-day 95% VaR $${Math.round(a.risk.var95_1d).toLocaleString('en-US')} (${pct(a.risk.var95_1dPct * 100, 2)} of NAV)${cvar95 != null ? `, CVaR $${Math.round(cvar95).toLocaleString('en-US')}` : ''}. ` +
      `Top weights: ${top.map((t) => `${t.ticker} ${t.weightPct}%`).join(', ')}. Largest sector: ${sectors[0]?.sector ?? 'n/a'} ${sectors[0]?.netWeightPct ?? 0}%.` +
      (worst ? ` Worst stress scenario: ${worst.name} ${pct(worst.pnlPct * 100, 1, true)}.` : ''),
  };
  return {
    data: {
      available: true, portfolio: pf.name, benchmark: res.benchmark.label, cite: src.id,
      nav: Math.round(v.nav), grossPct: round(v.grossPct * 100, 1), netPct: round(v.netPct * 100, 1),
      beta: round(a.risk.beta, 2), annualVolPct: round(a.risk.annualVol * 100, 1), trackingErrorPct: a.risk.trackingError != null ? round(a.risk.trackingError * 100, 1) : null,
      var95_1d: Math.round(a.risk.var95_1d), var95_1dPct: round(a.risk.var95_1dPct * 100, 2), cvar95_1d: cvar95 != null ? Math.round(cvar95) : null,
      topWeights: top, sectorWeights: sectors, sectorHhi: round(a.exposure.sector.hhi, 3), effectiveSectors: round(a.exposure.sector.effectiveN, 1),
      worstStress: worst ? { name: worst.name, pnlPct: round(worst.pnlPct * 100, 1) } : null,
      otherPortfolios: list.filter((p) => p.id !== pf.id).map((p) => ({ id: p.id, name: p.name })),
      note: 'Full Monte Carlo distribution, stress tests and attribution are on the Portfolios page.',
    },
    sources: [src, ...res.meta.sources.slice(0, 2)],
    isMock: res.meta.isMock,
    summary: `${pf.name}: VaR ${pct(a.risk.var95_1dPct * 100, 2)}`,
  };
}

const IMPL: { [N in ToolName]: (input: ToolInput<N>, ctx: ToolContext) => Promise<ToolOutput> } = {
  get_company_snapshot: getCompanySnapshot,
  get_financials: getFinancials,
  compare_companies: compareCompanies,
  run_screen: runScreen,
  get_news: getNews,
  search_documents: searchDocuments,
  portfolio_risk: portfolioRisk,
};

/** Validate and execute a tool call. Never throws: errors come back as `{ error }` data. */
export async function executeTool(name: string, input: unknown, ctx: ToolContext): Promise<ToolOutput & { ok: boolean }> {
  if (!isToolName(name)) return { ok: false, data: { error: `Unknown tool ${name}` }, sources: [], isMock: false, summary: 'unknown tool' };
  const v = validateToolInput(name, input);
  if (!v.ok) return { ok: false, data: { error: `Invalid input: ${v.error}` }, sources: [], isMock: false, summary: 'invalid input' };
  try {
    const out = await (IMPL[name] as (i: unknown, c: ToolContext) => Promise<ToolOutput>)(v.input, ctx);
    const err = out.data && typeof out.data === 'object' && 'error' in (out.data as object);
    return { ...out, ok: !err };
  } catch (e) {
    return { ok: false, data: { error: `Tool failed: ${(e as Error).message}` }, sources: [], isMock: false, summary: 'failed' };
  }
}
