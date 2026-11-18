import type {
  Bar, Catalyst, CatalystType, DataMeta, Estimates, EstimatePeriod, Filing, FinancialPeriod, Financials,
  FinancialStatementRow, HistoryRange, InsiderTxn, InstitutionalHolding, MarketDataProvider, NewsItem, Profile,
  Quote, ScreenRow, SourceRef, Transcript, UniverseItem, WithMeta,
} from '../types';
import { MOCK_BY_TICKER, MOCK_UNIVERSE, type MockCompany } from './universe';
import { gaussian, pick, rng, round } from './prng';
import { isIntradayRange } from '../types';
import { synthIntraday } from '../intraday';
import { FILING_EXCERPTS, NEWS_TEMPLATES, PUBLISHERS, SEGMENT_BY_SECTOR, TRANSCRIPT_LINES, fill } from './content';

const DAY = 86_400_000;
const MOCK_SOURCE: SourceRef = { id: 'mock:dataset', name: 'Nidhiksh Pulse demo dataset (simulated)', kind: 'mock' };

function todayUTC(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
const iso = (d: Date) => d.toISOString().slice(0, 10);
const dayKey = () => iso(todayUTC());

function meta(sources: SourceRef[] = []): DataMeta {
  return { source: [MOCK_SOURCE, ...sources], isMock: true, asOf: new Date().toISOString(), provider: 'Mock' };
}
function wrap<T>(data: T, sources: SourceRef[] = []): WithMeta<T> {
  return { data, meta: meta(sources) };
}
const norm = (t: string) => t.trim().toUpperCase();
const segmentOf = (m: MockCompany, r: () => number) => pick(r, SEGMENT_BY_SECTOR[m.sector] ?? ['core']);
const edgar = (ticker: string, form: string) =>
  `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${encodeURIComponent(ticker)}&type=${encodeURIComponent(form)}&dateb=&owner=include&count=40`;

// ---------- prices ----------
const historyCache = new Map<string, Bar[]>();

function tradingDaysBack(n: number): Date[] {
  const out: Date[] = [];
  let d = todayUTC();
  while (out.length < n) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(d);
    d = new Date(d.getTime() - DAY);
  }
  return out.reverse();
}

/** Full daily history (up to ~30y), deterministic per ticker per day, ending at the reference price. */
export function mockFullHistory(ticker: string): Bar[] {
  const m = MOCK_BY_TICKER[norm(ticker)];
  if (!m) return [];
  const key = `${m.ticker}|${dayKey()}`;
  const hit = historyCache.get(key);
  if (hit) return hit;
  const years = Math.min(30, Math.max(3, new Date().getUTCFullYear() - m.ipo));
  const n = Math.round(years * 252);
  const dates = tradingDaysBack(n);
  const r = rng('hist', m.ticker);
  const vol = 0.011 + m.beta * 0.008;
  // today's move seeded by date so the daily change varies day to day
  const rToday = rng('today', m.ticker, dayKey());
  const todayMove = gaussian(rToday) * vol;
  const endPrice = m.price * (1 + gaussian(rng('drift', m.ticker, dayKey().slice(0, 7))) * 0.03) * (1 + todayMove);
  // walk backwards
  const closes = new Array<number>(n);
  closes[n - 1] = endPrice;
  const annualDrift = Math.max(0.03, Math.min(0.28, m.revGrowth / 100 + 0.04));
  const mu = annualDrift / 252;
  for (let i = n - 2; i >= 0; i--) {
    const ret = i === n - 2 ? todayMove : mu + gaussian(r) * vol;
    closes[i] = Math.max(0.05, closes[i + 1] / (1 + ret));
  }
  const bars: Bar[] = dates.map((d, i) => {
    const close = closes[i];
    const open = i === 0 ? close : closes[i - 1] * (1 + gaussian(r) * vol * 0.3);
    const hi = Math.max(open, close) * (1 + Math.abs(gaussian(r)) * vol * 0.5);
    const lo = Math.min(open, close) * (1 - Math.abs(gaussian(r)) * vol * 0.5);
    const baseVol = (m.mcapB * 1e9) / m.price / 250;
    return {
      date: iso(d),
      open: round(open),
      high: round(hi),
      low: round(lo),
      close: round(close),
      volume: Math.round(baseVol * (0.6 + r() * 0.9)),
    };
  });
  historyCache.set(key, bars);
  return bars;
}

/** Slice daily bars to a range. Intraday ranges (1D/1W) cannot be served from daily bars and return []. */
export function sliceRange(bars: Bar[], range: HistoryRange): Bar[] {
  if (isIntradayRange(range)) return [];
  if (!bars.length) return bars;
  const last = new Date(bars[bars.length - 1].date + 'T00:00:00Z');
  let from: Date;
  switch (range) {
    case '1M': from = new Date(last.getTime() - 31 * DAY); break;
    case '3M': from = new Date(last.getTime() - 92 * DAY); break;
    case '6M': from = new Date(last.getTime() - 183 * DAY); break;
    case 'YTD': from = new Date(Date.UTC(last.getUTCFullYear(), 0, 1)); break;
    case '1Y': from = new Date(last.getTime() - 366 * DAY); break;
    case '5Y': from = new Date(last.getTime() - 5 * 366 * DAY); break;
    default: return bars;
  }
  const f = iso(from);
  return bars.filter((b) => b.date >= f);
}

function mockQuote(ticker: string): Quote | null {
  const m = MOCK_BY_TICKER[norm(ticker)];
  if (!m) return null;
  const h = mockFullHistory(m.ticker);
  const last = h[h.length - 1];
  const prev = h[h.length - 2] ?? last;
  // "live-ish": small deterministic wiggle per minute
  const minute = Math.floor(Date.now() / 60_000);
  const wiggle = gaussian(rng('tick', m.ticker, minute)) * 0.0012;
  const price = round(last.close * (1 + wiggle));
  const change = round(price - prev.close);
  const sharesOut = (m.mcapB * 1e9) / m.price;
  return {
    ticker: m.ticker,
    price,
    change,
    changePct: round((change / prev.close) * 100),
    open: last.open,
    high: Math.max(last.high, price),
    low: Math.min(last.low, price),
    prevClose: prev.close,
    volume: last.volume,
    marketCap: Math.round(sharesOut * price),
    ts: new Date().toISOString(),
  };
}

// ---------- fundamentals ----------
function mockFinancials(ticker: string, period: FinancialPeriod): Financials | null {
  const m = MOCK_BY_TICKER[norm(ticker)];
  if (!m) return null;
  const r = rng('fin', m.ticker, period);
  const lastFY = new Date().getUTCFullYear() - 1;
  const sharesOut = (m.mcapB * 1e9) / m.price;
  const rows: FinancialStatementRow[] = [];
  const gm = Math.min(0.85, Math.max(0.12, m.netMargin / 100 + 0.25 + r() * 0.15));
  const mk = (fy: number, fp: string, end: string, revenue: number, scale: number): FinancialStatementRow => {
    const nm = (m.netMargin / 100) * (0.75 + r() * 0.5);
    const om = nm * 1.25;
    const grossProfit = revenue * gm * (0.95 + r() * 0.1);
    const operatingIncome = revenue * om;
    const netIncome = revenue * nm;
    const ebitda = operatingIncome * 1.18;
    const shares = sharesOut * (1 + (lastFY - fy) * 0.012);
    const totalAssets = revenue * (1.2 + r() * 1.3) * scale;
    const totalLiabilities = totalAssets * (0.45 + r() * 0.3);
    const ocf = netIncome * (1.1 + r() * 0.3);
    const capex = revenue * (0.03 + r() * 0.08);
    return {
      fiscalYear: fy,
      fiscalPeriod: fp,
      periodEnd: end,
      revenue: Math.round(revenue),
      grossProfit: Math.round(grossProfit),
      operatingIncome: Math.round(operatingIncome),
      netIncome: Math.round(netIncome),
      ebitda: Math.round(ebitda),
      eps: round(netIncome / shares, 2),
      totalAssets: Math.round(totalAssets),
      totalLiabilities: Math.round(totalLiabilities),
      totalEquity: Math.round(totalAssets - totalLiabilities),
      cash: Math.round(totalAssets * (0.08 + r() * 0.15)),
      totalDebt: Math.round(totalLiabilities * (0.3 + r() * 0.3)),
      operatingCashFlow: Math.round(ocf),
      capex: Math.round(capex),
      freeCashFlow: Math.round(ocf - capex),
      sharesOutstanding: Math.round(shares),
      grossMargin: round((grossProfit / revenue) * 100, 1),
      operatingMargin: round((operatingIncome / revenue) * 100, 1),
      netMargin: round((netIncome / revenue) * 100, 1),
      sourceId: `mock:filing:${m.ticker}:${fp === 'FY' ? '10-K' : '10-Q'}:${fy}${fp === 'FY' ? '' : fp}`,
    };
  };
  if (period === 'annual') {
    const first = Math.max(m.ipo, lastFY - 34);
    let rev = m.revB * 1e9;
    const revs: number[] = [];
    for (let fy = lastFY; fy >= first; fy--) {
      revs.push(rev);
      const g = (m.revGrowth / 100) * (0.6 + r() * 0.8) + 0.04 + gaussian(r) * 0.05;
      rev = rev / (1 + Math.max(-0.2, Math.min(0.6, g)));
    }
    revs.reverse();
    revs.forEach((rv, i) => rows.push(mk(first + i, 'FY', `${first + i}-12-31`, rv, 1)));
  } else {
    let rev = (m.revB * 1e9) / 4;
    const qs: { fy: number; q: number; rev: number }[] = [];
    let fy = lastFY + 1;
    let q = Math.max(1, Math.floor(new Date().getUTCMonth() / 3));
    for (let i = 0; i < 16; i++) {
      qs.push({ fy, q, rev });
      rev = rev / (1 + (m.revGrowth / 100 / 4) * (0.5 + r()));
      q--;
      if (q === 0) { q = 4; fy--; }
    }
    qs.reverse().forEach(({ fy: y, q: qq, rev: rv }) =>
      rows.push(mk(y, `Q${qq}`, `${y}-${String(qq * 3).padStart(2, '0')}-${qq === 1 || qq === 4 ? '31' : '30'}`, rv, 4)));
  }
  return { ticker: m.ticker, period, currency: 'USD', rows };
}

function mockEstimates(ticker: string): Estimates | null {
  const m = MOCK_BY_TICKER[norm(ticker)];
  if (!m) return null;
  const r = rng('est', m.ticker, dayKey().slice(0, 7));
  const fy = new Date().getUTCFullYear();
  const sharesOut = (m.mcapB * 1e9) / m.price;
  const eps0 = m.price / m.pe;
  const periods: EstimatePeriod[] = [];
  const mkP = (period: string, metric: EstimatePeriod['metric'], value: number): EstimatePeriod => {
    const drift = (r() - 0.4) * 0.08;
    const revisions = Array.from({ length: 13 }, (_, i) => {
      const d = new Date(todayUTC().getTime() - (12 - i) * 7 * DAY);
      const v = value * (1 - drift * ((12 - i) / 12)) * (1 + gaussian(r) * 0.003);
      return { date: iso(d), value: round(v, metric === 'eps' ? 2 : 0) };
    });
    const last = revisions[12].value;
    const d30 = revisions[8].value;
    const d90 = revisions[0].value;
    return {
      period, metric, consensus: last,
      high: round(last * (1.06 + r() * 0.06), metric === 'eps' ? 2 : 0),
      low: round(last * (0.88 + r() * 0.05), metric === 'eps' ? 2 : 0),
      numAnalysts: 12 + Math.floor(r() * 35),
      revisions,
      change30dPct: round(((last - d30) / Math.abs(d30)) * 100, 2),
      change90dPct: round(((last - d90) / Math.abs(d90)) * 100, 2),
    };
  };
  for (let k = 0; k < 3; k++) {
    const g = Math.pow(1 + m.revGrowth / 100 * 0.8, k + 1);
    periods.push(mkP(`FY${fy + k}`, 'revenue', m.revB * 1e9 * g));
    periods.push(mkP(`FY${fy + k}`, 'eps', eps0 * g * 1.05));
    periods.push(mkP(`FY${fy + k}`, 'ebitda', (m.revB * 1e9 * g * m.netMargin) / 100 * 1.6));
  }
  void sharesOut;
  const fwd = periods.find((p) => p.metric === 'eps' && p.period === `FY${fy + 1}`);
  const buy = 10 + Math.floor(r() * 30);
  return {
    ticker: m.ticker,
    rating: { buy, hold: 3 + Math.floor(r() * 12), sell: Math.floor(r() * 4) },
    priceTarget: { mean: round(m.price * (1.05 + r() * 0.2)), high: round(m.price * (1.3 + r() * 0.3)), low: round(m.price * (0.7 + r() * 0.15)) },
    periods,
    forwardEps: fwd?.consensus,
    forwardPe: fwd && fwd.consensus > 0 ? round(m.price / fwd.consensus, 1) : undefined,
    trailingEps: round(eps0, 2),
    forwardBasis: `next fiscal year FY${fy + 1} consensus EPS (simulated)`,
  };
}

const INSIDER_TITLES = ['CEO', 'CFO', 'Director', 'EVP & General Counsel', 'Chief Operating Officer', 'SVP, Engineering'];
const FIRST = ['James', 'Maria', 'Robert', 'Linda', 'David', 'Susan', 'Michael', 'Karen', 'Thomas', 'Nancy', 'Arjun', 'Mei'];
const LAST = ['Walker', 'Patel', 'Nguyen', 'Johnson', 'Garcia', 'Okafor', 'Schmidt', 'Rossi', 'Kim', 'Haddad'];

function mockInsiders(ticker: string): InsiderTxn[] {
  const m = MOCK_BY_TICKER[norm(ticker)];
  if (!m) return [];
  const r = rng('ins', m.ticker);
  return Array.from({ length: 12 }, (_, i) => {
    const date = iso(new Date(todayUTC().getTime() - Math.floor(r() * 180 + i * 3) * DAY));
    const type: InsiderTxn['type'] = r() < 0.28 ? 'Buy' : r() < 0.85 ? 'Sell' : 'Option Exercise';
    const shares = Math.round((500 + r() * 40000) / 10) * 10;
    const price = round(m.price * (0.9 + r() * 0.15));
    return {
      id: `mock:form4:${m.ticker}:${i}`,
      ticker: m.ticker,
      insider: `${pick(r, FIRST)} ${pick(r, LAST)}`,
      title: pick(r, INSIDER_TITLES),
      date, type, shares, price,
      value: Math.round(shares * price),
      sharesOwnedAfter: Math.round(shares * (3 + r() * 30)),
      filingUrl: edgar(m.ticker, '4'),
    };
  }).sort((a, b) => b.date.localeCompare(a.date));
}

const HOLDERS = ['Vanguard Group', 'BlackRock', 'State Street', 'Fidelity (FMR)', 'Geode Capital', 'T. Rowe Price', 'Capital Research', 'Morgan Stanley IM', 'JPMorgan Asset Mgmt', 'Norges Bank', 'Wellington Management', 'Northern Trust'];

function mockInstitutional(ticker: string): InstitutionalHolding[] {
  const m = MOCK_BY_TICKER[norm(ticker)];
  if (!m) return [];
  const r = rng('inst', m.ticker);
  const sharesOut = (m.mcapB * 1e9) / m.price;
  const q = todayUTC();
  const reportDate = iso(new Date(Date.UTC(q.getUTCFullYear(), Math.floor(q.getUTCMonth() / 3) * 3, 0)));
  let pct = 8.5 + r() * 1.5;
  return HOLDERS.map((holder) => {
    const shares = Math.round((sharesOut * pct) / 100);
    const changePct = round(gaussian(r) * 4, 2);
    const row = {
      holder, shares, value: Math.round(shares * m.price), pctOfShares: round(pct, 2),
      changeShares: Math.round((shares * changePct) / 100), changePct, reportDate,
    };
    pct *= 0.55 + r() * 0.3;
    return row;
  });
}

function newsFor(m: MockCompany, count: number): NewsItem[] {
  const r = rng('news', m.ticker, dayKey());
  return Array.from({ length: count }, (_, i) => {
    const tpl = pick(r, NEWS_TEMPLATES);
    const seg = segmentOf(m, r);
    const title = fill(tpl.t, m, { segment: seg, bps: String(20 + Math.floor(r() * 180)), buyback: String(Math.round(m.mcapB * 0.03)) });
    const publishedAt = new Date(Date.now() - Math.floor((i * 9 + r() * 9) * 3600_000)).toISOString();
    const publisher = pick(r, PUBLISHERS);
    return {
      id: `mock:news:${m.ticker}:${dayKey()}:${i}`,
      ticker: m.ticker,
      tickers: [m.ticker],
      title,
      summary: `${m.name} (${m.ticker}) — ${title.toLowerCase()}. Simulated headline for demo purposes.`,
      publisher,
      url: `https://example.com/news/${m.ticker.toLowerCase()}/${dayKey()}-${i}`,
      publishedAt,
      sentiment: tpl.s,
    };
  });
}

function mockFilings(ticker: string): Filing[] {
  const m = MOCK_BY_TICKER[norm(ticker)];
  if (!m) return [];
  const r = rng('filings', m.ticker);
  const now = todayUTC();
  const out: Filing[] = [];
  const seg = segmentOf(m, r);
  const ex = (form: string, extra: Record<string, string>) =>
    (FILING_EXCERPTS[form] ?? []).map((e) => ({ locator: e.locator, text: fill(e.text, m, extra) }));
  const vals = { growth: m.revGrowth.toFixed(1), segment: seg, gm: (40 + r() * 30).toFixed(1), rev: (m.revB / 4).toFixed(1) };
  for (let y = 0; y < 3; y++) {
    const fy = now.getUTCFullYear() - 1 - y;
    out.push({ id: `mock:filing:${m.ticker}:10-K:${fy}`, ticker: m.ticker, form: '10-K', title: `Annual report for fiscal year ${fy}`, filedAt: `${fy + 1}-02-${String(10 + y).padStart(2, '0')}`, periodOfReport: `${fy}-12-31`, url: edgar(m.ticker, '10-K'), accession: `0000${100000 + Math.floor(r() * 899999)}-${String(fy + 1).slice(2)}-${String(Math.floor(r() * 99999)).padStart(6, '0')}`, excerpts: ex('10-K', vals) });
  }
  for (let q = 1; q <= 4; q++) {
    const d = new Date(now.getTime() - (q * 91 - 40) * DAY);
    const qq = ((Math.floor(d.getUTCMonth() / 3) + 3) % 4) + 1;
    if (qq === 4) continue;
    out.push({ id: `mock:filing:${m.ticker}:10-Q:${d.getUTCFullYear()}Q${qq}`, ticker: m.ticker, form: '10-Q', title: `Quarterly report Q${qq} ${d.getUTCFullYear()}`, filedAt: iso(d), url: edgar(m.ticker, '10-Q'), excerpts: ex('10-Q', vals) });
  }
  for (let i = 0; i < 4; i++) {
    const d = new Date(now.getTime() - Math.floor(10 + i * 37 + r() * 20) * DAY);
    out.push({ id: `mock:filing:${m.ticker}:8-K:${iso(d)}`, ticker: m.ticker, form: '8-K', title: i % 2 === 0 ? 'Results of operations and financial condition' : 'Departure/election of officers', filedAt: iso(d), url: edgar(m.ticker, '8-K'), excerpts: ex('8-K', vals).slice(i % 2, (i % 2) + 1) });
  }
  return out.sort((a, b) => b.filedAt.localeCompare(a.filedAt));
}

function nextEarningsDate(m: MockCompany): string {
  const r = rng('earn', m.ticker, dayKey().slice(0, 7));
  return iso(new Date(todayUTC().getTime() + Math.floor(3 + r() * 80) * DAY));
}

function mockCatalysts(ticker?: string): Catalyst[] {
  const list = ticker ? [MOCK_BY_TICKER[norm(ticker)]].filter(Boolean) : MOCK_UNIVERSE;
  const out: Catalyst[] = [];
  for (const m of list) {
    const r = rng('cat', m.ticker, dayKey().slice(0, 7));
    out.push({ id: `mock:cat:${m.ticker}:earn`, ticker: m.ticker, type: 'earnings', title: `${m.ticker} quarterly earnings`, date: nextEarningsDate(m), confirmed: r() > 0.3, description: 'Consensus and whisper numbers on the Estimates tab.' });
    if (m.sector === 'Health Care' && r() > 0.3) {
      out.push({ id: `mock:cat:${m.ticker}:fda`, ticker: m.ticker, type: 'fda', title: `${m.ticker} PDUFA date (pipeline asset)`, date: iso(new Date(todayUTC().getTime() + Math.floor(10 + r() * 120) * DAY)), confirmed: true, description: 'FDA action date for a late-stage candidate.' });
    }
    if (r() > 0.75) {
      out.push({ id: `mock:cat:${m.ticker}:iday`, ticker: m.ticker, type: 'investor_day', title: `${m.name} investor day`, date: iso(new Date(todayUTC().getTime() + Math.floor(15 + r() * 150) * DAY)), confirmed: r() > 0.5 });
    }
    if (m.divYield > 0 && r() > 0.6) {
      out.push({ id: `mock:cat:${m.ticker}:div`, ticker: m.ticker, type: 'dividend', title: `${m.ticker} ex-dividend`, date: iso(new Date(todayUTC().getTime() + Math.floor(5 + r() * 60) * DAY)), confirmed: true });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

function mockTranscripts(ticker: string): Transcript[] {
  const m = MOCK_BY_TICKER[norm(ticker)];
  if (!m) return [];
  const r = rng('tr', m.ticker);
  const now = todayUTC();
  return [0, 1].map((k) => {
    const d = new Date(now.getTime() - (20 + k * 91) * DAY);
    const q = ((Math.floor(d.getUTCMonth() / 3) + 3) % 4) + 1;
    const seg = segmentOf(m, r);
    return {
      id: `mock:transcript:${m.ticker}:${d.getUTCFullYear()}Q${q}`,
      ticker: m.ticker,
      title: `${m.name} Q${q} ${d.getUTCFullYear()} earnings call`,
      date: iso(d),
      url: `https://example.com/transcripts/${m.ticker.toLowerCase()}-${d.getUTCFullYear()}-q${q}`,
      excerpts: TRANSCRIPT_LINES.map((l, i) => ({ speaker: l.speaker, locator: `${l.speaker}, ¶${i + 1}`, text: fill(l.text, m, { segment: seg, growth: Math.max(1, m.revGrowth * 0.9).toFixed(0) }) })),
    };
  });
}

export function mockScreenRow(m: MockCompany): ScreenRow {
  const q = mockQuote(m.ticker)!;
  const est = mockEstimates(m.ticker)!;
  const r = rng('screen', m.ticker, dayKey());
  const fyEps = est.periods.find((p) => p.metric === 'eps')!;
  const ins = mockInsiders(m.ticker).filter((t) => t.date >= iso(new Date(todayUTC().getTime() - 90 * DAY)));
  const insiderNet = ins.reduce((s, t) => s + (t.type === 'Buy' ? t.value : t.type === 'Sell' ? -t.value : 0), 0);
  const cats = mockCatalysts(m.ticker);
  const hist = mockFullHistory(m.ticker).slice(-30).map((b) => b.close);
  const filing = mockFilings(m.ticker)[0];
  const news = newsFor(m, 1)[0];
  const seg = segmentOf(m, r);
  const dir = fyEps.change30dPct >= 0 ? 'up' : 'down';
  return {
    ticker: m.ticker, name: m.name, sector: m.sector, industry: m.industry, country: m.country,
    marketCap: q.marketCap, price: q.price, changePct: q.changePct,
    pe: m.pe, evEbitda: m.evEbitda, revenueGrowth: m.revGrowth,
    epsRevision30d: fyEps.change30dPct,
    shortInterestPct: m.shortInt,
    insiderBuying90d: insiderNet,
    esgScore: m.esg,
    nextEarnings: cats.find((c) => c.type === 'earnings')?.date ?? '',
    catalystFlags: Array.from(new Set(cats.filter((c) => c.date <= iso(new Date(todayUTC().getTime() + 45 * DAY))).map((c) => c.type))) as CatalystType[],
    sparkline: hist,
    whyNow: {
      headline: `${seg[0].toUpperCase()}${seg.slice(1)} trends ${m.revGrowth > 10 ? 'accelerating' : 'stabilizing'}; ${news.title}`,
      estimateChange: `FY EPS consensus ${dir} ${Math.abs(fyEps.change30dPct).toFixed(1)}% over 30 days (${fyEps.numAnalysts} analysts)`,
      risk: m.pe > 40 ? 'Valuation leaves little room for execution misses' : m.revGrowth < 2 ? 'Top-line growth stalling; relies on margin/capital returns' : `Competitive intensity in ${seg}`,
      sourceIds: [filing.id, news.id, `mock:estimates:${m.ticker}`],
    },
  };
}

export class MockProvider implements MarketDataProvider {
  readonly name = 'Mock';

  async getUniverse(): Promise<WithMeta<UniverseItem[]>> {
    return wrap(MOCK_UNIVERSE.map(({ ticker, name, sector, industry, country, exchange }) => ({ ticker, name, sector, industry, country, exchange })));
  }
  async getQuote(t: string) {
    return wrap(mockQuote(t), [{ id: `mock:price:${norm(t)}`, name: `${norm(t)} simulated quote`, kind: 'price' }]);
  }
  async getQuotes(ts: string[]) {
    return wrap(ts.map(mockQuote).filter((q): q is Quote => !!q));
  }
  async getHistory(t: string, range: HistoryRange) {
    if (isIntradayRange(range)) {
      const bars = synthIntraday(mockFullHistory(t), range, rng('intraday', norm(t), dayKey()));
      return wrap(bars, [{ id: `mock:price:${norm(t)}:${range}`, name: `${norm(t)} simulated ${range === '1D' ? '5-minute' : '30-minute'} bars`, kind: 'price' }]);
    }
    return wrap(sliceRange(mockFullHistory(t), range), [{ id: `mock:price:${norm(t)}`, name: `${norm(t)} simulated daily bars`, kind: 'price' }]);
  }
  async getProfile(t: string): Promise<WithMeta<Profile | null>> {
    const m = MOCK_BY_TICKER[norm(t)];
    if (!m) return wrap(null);
    const h = mockFullHistory(m.ticker).slice(-252);
    const q = mockQuote(m.ticker)!;
    return wrap({
      ticker: m.ticker, name: m.name, sector: m.sector, industry: m.industry, country: m.country, exchange: m.exchange,
      description: `${m.name} operates in the ${m.industry.toLowerCase()} industry within ${m.sector}. Headquartered in ${m.hq}, the company generated roughly $${m.revB.toFixed(1)}B of trailing revenue (${m.revGrowth >= 0 ? '+' : ''}${m.revGrowth.toFixed(1)}% YoY). Description is simulated for the demo.`,
      employees: Math.round(m.employeesK * 1000), founded: m.founded, hq: m.hq, website: `https://www.${m.website}`, ceo: m.ceo,
      marketCap: q.marketCap, sharesOutstanding: Math.round((m.mcapB * 1e9) / m.price), beta: m.beta, dividendYield: m.divYield,
      pe: m.pe, forwardPe: round(m.pe / (1 + Math.max(0.02, m.revGrowth / 100)), 1), evEbitda: m.evEbitda, priceToSales: round(m.mcapB / m.revB, 1),
      week52High: Math.max(...h.map((b) => b.high)), week52Low: Math.min(...h.map((b) => b.low)),
    });
  }
  async getFinancials(t: string, period: FinancialPeriod) {
    const f = mockFinancials(t, period);
    return wrap(f, f ? [{ id: `mock:filing:${norm(t)}:10-K:${new Date().getUTCFullYear() - 1}`, name: `${norm(t)} 10-K (simulated)`, kind: 'filing', url: edgar(norm(t), '10-K') }] : []);
  }
  async getEstimates(t: string) {
    return wrap(mockEstimates(t), [{ id: `mock:estimates:${norm(t)}`, name: `${norm(t)} consensus estimates (simulated)`, kind: 'estimate' }]);
  }
  async getInsiders(t: string) {
    return wrap(mockInsiders(t), [{ id: `mock:form4:${norm(t)}`, name: `${norm(t)} Form 4 filings (simulated)`, kind: 'ownership', url: edgar(norm(t), '4') }]);
  }
  async getInstitutional(t: string) {
    return wrap(mockInstitutional(t), [{ id: `mock:13f:${norm(t)}`, name: `${norm(t)} 13F holders (simulated)`, kind: 'ownership' }]);
  }
  async getNews(t?: string) {
    if (t) {
      const m = MOCK_BY_TICKER[norm(t)];
      return wrap(m ? newsFor(m, 10) : []);
    }
    const all = MOCK_UNIVERSE.flatMap((m) => newsFor(m, 2)).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    return wrap(all.slice(0, 40));
  }
  async getFilings(t: string) {
    const f = mockFilings(t);
    return wrap(f, f.slice(0, 3).map((x) => ({ id: x.id, name: `${x.ticker} ${x.form} ${x.filedAt}`, url: x.url, kind: 'filing' as const, excerpt: x.excerpts?.[0]?.text, locator: x.excerpts?.[0]?.locator })));
  }
  async getCatalysts(t?: string) {
    return wrap(mockCatalysts(t));
  }
  async getScreenRows() {
    return wrap(MOCK_UNIVERSE.map(mockScreenRow));
  }
  async getTranscripts(t: string) {
    const tr = mockTranscripts(t);
    return wrap(tr, tr.map((x) => ({ id: x.id, name: x.title, url: x.url, kind: 'transcript' as const, excerpt: x.excerpts[0]?.text, locator: x.excerpts[0]?.locator })));
  }
}

export const mockProvider = new MockProvider();

/** Resolve a mock source id (e.g. from whyNow.sourceIds) into a SourceRef with an excerpt for the right rail. */
export function resolveMockSource(id: string): SourceRef | null {
  const parts = id.split(':');
  if (parts[0] !== 'mock') return null;
  const ticker = parts[2];
  if (parts[1] === 'filing') {
    const f = mockFilings(ticker).find((x) => x.id === id) ?? mockFilings(ticker).find((x) => x.form === parts[3]);
    if (!f) return null;
    return { id, name: `${f.ticker} ${f.form} — ${f.title}`, url: f.url, kind: 'filing', excerpt: f.excerpts?.[0]?.text, locator: f.excerpts?.[0]?.locator };
  }
  if (parts[1] === 'news') {
    const m = MOCK_BY_TICKER[ticker];
    const n = m ? newsFor(m, 10).find((x) => x.id === id) : undefined;
    return n ? { id, name: `${n.publisher}: ${n.title}`, url: n.url, kind: 'news', excerpt: n.summary } : null;
  }
  if (parts[1] === 'transcript') {
    const t = mockTranscripts(ticker).find((x) => x.id === id);
    return t ? { id, name: t.title, url: t.url, kind: 'transcript', excerpt: t.excerpts[1]?.text, locator: t.excerpts[1]?.locator } : null;
  }
  if (parts[1] === 'estimates') {
    const e = mockEstimates(ticker);
    const p = e?.periods.find((x) => x.metric === 'eps');
    return p ? { id, name: `${ticker} consensus estimates (simulated)`, kind: 'estimate', excerpt: `${p.period} EPS consensus $${p.consensus.toFixed(2)} (${p.numAnalysts} analysts), ${p.change30dPct >= 0 ? '+' : ''}${p.change30dPct.toFixed(1)}% over 30 days.` } : null;
  }
  return { id, name: id, kind: 'mock' };
}
