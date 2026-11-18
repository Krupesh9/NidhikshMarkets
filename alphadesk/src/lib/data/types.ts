// Shared market-data types. Safe to import from client components (types only).

export type SourceKind = 'filing' | 'transcript' | 'news' | 'price' | 'estimate' | 'ownership' | 'mock';

export interface SourceRef {
  id: string;
  name: string;
  url?: string;
  kind: SourceKind;
  excerpt?: string;
  /** e.g. "Item 7, MD&A p.42" or "Q3 call, CFO remarks" */
  locator?: string;
}

export interface DataMeta {
  source: SourceRef[];
  isMock: boolean;
  /** ISO timestamp the data is as of */
  asOf: string;
  /** Human-readable provider name that served the data, e.g. "Mock", "Nidhiksh local cache", "Massive (Polygon)", "SEC EDGAR" */
  provider?: string;
}

export interface WithMeta<T> {
  data: T;
  meta: DataMeta;
}

export type GicsSector =
  | 'Information Technology'
  | 'Communication Services'
  | 'Consumer Discretionary'
  | 'Consumer Staples'
  | 'Energy'
  | 'Financials'
  | 'Health Care'
  | 'Industrials'
  | 'Materials'
  | 'Real Estate'
  | 'Utilities';

export const GICS_SECTORS: GicsSector[] = [
  'Information Technology',
  'Communication Services',
  'Consumer Discretionary',
  'Consumer Staples',
  'Energy',
  'Financials',
  'Health Care',
  'Industrials',
  'Materials',
  'Real Estate',
  'Utilities',
];

export interface UniverseItem {
  ticker: string;
  name: string;
  sector: GicsSector;
  industry: string;
  country: string;
  exchange: string;
}

export interface Quote {
  ticker: string;
  price: number;
  change: number;
  changePct: number;
  open: number;
  high: number;
  low: number;
  prevClose: number;
  volume: number;
  marketCap: number;
  /** ISO timestamp */
  ts: string;
}

export interface Bar {
  /** Daily bars: ISO date (YYYY-MM-DD). Intraday ranges (1D/1W): full ISO timestamp, e.g. 2026-11-17T14:35:00Z. */
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type HistoryRange = '1D' | '1W' | '1M' | '3M' | '6M' | 'YTD' | '1Y' | '5Y' | 'MAX';

/** 1D = latest session in 5-minute bars; 1W = last 5 sessions in 30-minute bars. Everything else is daily. */
export const INTRADAY_RANGES: readonly HistoryRange[] = ['1D', '1W'];
export const isIntradayRange = (r: HistoryRange): r is '1D' | '1W' => r === '1D' || r === '1W';

export interface Profile {
  ticker: string;
  name: string;
  sector: GicsSector;
  industry: string;
  country: string;
  exchange: string;
  description: string;
  employees: number;
  founded: number;
  hq: string;
  website: string;
  ceo: string;
  cik?: string;
  marketCap: number;
  sharesOutstanding: number;
  beta: number;
  dividendYield: number;
  pe: number;
  forwardPe: number;
  evEbitda: number;
  priceToSales: number;
  week52High: number;
  week52Low: number;
}

export type FinancialPeriod = 'annual' | 'quarterly';

/** One fiscal period of a statement set. Values in USD (absolute), per-share in USD. */
export interface FinancialStatementRow {
  fiscalYear: number;
  /** 'FY' or 'Q1'..'Q4' */
  fiscalPeriod: string;
  periodEnd: string;
  revenue: number;
  grossProfit: number;
  operatingIncome: number;
  netIncome: number;
  ebitda: number;
  eps: number;
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  cash: number;
  totalDebt: number;
  operatingCashFlow: number;
  capex: number;
  freeCashFlow: number;
  sharesOutstanding: number;
  grossMargin: number;
  operatingMargin: number;
  netMargin: number;
  sourceId?: string;
}

export interface Financials {
  ticker: string;
  period: FinancialPeriod;
  currency: string;
  /** Oldest first. Mock annual provides 30+ years where the company existed. */
  rows: FinancialStatementRow[];
}

export interface EstimateRevision {
  date: string;
  value: number;
}

export interface EstimatePeriod {
  /** e.g. 'FY2026', 'Q1 FY2027' */
  period: string;
  metric: 'revenue' | 'eps' | 'ebitda';
  consensus: number;
  high: number;
  low: number;
  numAnalysts: number;
  /** consensus over time, oldest first (~ 12 weekly points) */
  revisions: EstimateRevision[];
  change30dPct: number;
  change90dPct: number;
}

export interface Estimates {
  ticker: string;
  rating: { buy: number; hold: number; sell: number };
  priceTarget: { mean: number; high: number; low: number };
  periods: EstimatePeriod[];
  /** Consensus EPS for the next fiscal year-end to be reported (explicit estimate when the provider has one). */
  forwardEps?: number;
  /** Provider-reported forward P/E (e.g. Alpha Vantage OVERVIEW ForwardPE). */
  forwardPe?: number;
  trailingEps?: number;
  /** Fiscal period the forward EPS refers to, e.g. 'FY2027 (ending 2027-01-31)'. */
  forwardBasis?: string;
  /** Individual analyst actions (needs a ratings feed such as Benzinga via Massive, or FMP). Newest first. */
  analystActions?: AnalystAction[];
  /** Where ratings / targets / actions came from (e.g. Financial Modeling Prep) and when. */
  analystSource?: { name: string; url?: string; asOf: string };
  priceTargetMedian?: number;
}

export interface AnalystAction {
  analyst?: string;
  firm: string;
  rating: 'buy' | 'hold' | 'sell';
  /** Rating as published, e.g. 'Overweight'. */
  ratingLabel?: string;
  previousLabel?: string;
  action: 'upgraded' | 'downgraded' | 'maintained' | 'initiated' | 'reiterated' | 'target-raised' | 'target-lowered';
  priceTarget?: number;
  date: string;
  url?: string;
}

export interface InsiderTxn {
  id: string;
  ticker: string;
  insider: string;
  title: string;
  date: string;
  type: 'Buy' | 'Sell' | 'Option Exercise' | 'Gift';
  shares: number;
  price: number;
  value: number;
  sharesOwnedAfter: number;
  filingUrl?: string;
}

export interface InstitutionalHolding {
  holder: string;
  shares: number;
  value: number;
  pctOfShares: number;
  /** shares change vs prior quarter */
  changeShares: number;
  changePct: number;
  reportDate: string;
}

export interface NewsItem {
  id: string;
  ticker?: string;
  tickers: string[];
  title: string;
  summary?: string;
  publisher: string;
  url: string;
  publishedAt: string;
  sentiment?: 'positive' | 'neutral' | 'negative';
}

export interface Filing {
  id: string;
  ticker: string;
  form: '10-K' | '10-Q' | '8-K' | 'DEF 14A' | 'S-1' | '13F-HR' | '4' | string;
  title: string;
  filedAt: string;
  periodOfReport?: string;
  url: string;
  accession?: string;
  /** short excerpts usable for citations */
  excerpts?: { locator: string; text: string }[];
}

export type CatalystType = 'earnings' | 'fda' | 'investor_day' | 'product' | 'dividend' | 'conference' | 'macro';

export interface Catalyst {
  id: string;
  ticker?: string;
  type: CatalystType;
  title: string;
  date: string;
  confirmed: boolean;
  description?: string;
}

export interface WhyNow {
  headline: string;
  estimateChange: string;
  risk: string;
  sourceIds: string[];
}

export interface ScreenRow {
  ticker: string;
  name: string;
  sector: GicsSector;
  industry: string;
  country: string;
  marketCap: number;
  price: number;
  changePct: number;
  pe: number;
  evEbitda: number;
  /** YoY, percent (e.g. 12.5 = 12.5%) */
  revenueGrowth: number;
  /** % change in FY EPS consensus over 30 days */
  epsRevision30d: number;
  shortInterestPct: number;
  /** net insider buying $ over 90 days (negative = net selling) */
  insiderBuying90d: number;
  esgScore: number;
  nextEarnings: string;
  catalystFlags: CatalystType[];
  sparkline: number[];
  whyNow: WhyNow;
}

export interface Transcript {
  id: string;
  ticker: string;
  title: string;
  date: string;
  url: string;
  excerpts: { speaker: string; locator: string; text: string }[];
}

export interface MarketDataProvider {
  readonly name: string;
  getUniverse(): Promise<WithMeta<UniverseItem[]>>;
  getQuote(ticker: string): Promise<WithMeta<Quote | null>>;
  getQuotes(tickers: string[]): Promise<WithMeta<Quote[]>>;
  getHistory(ticker: string, range: HistoryRange): Promise<WithMeta<Bar[]>>;
  getProfile(ticker: string): Promise<WithMeta<Profile | null>>;
  getFinancials(ticker: string, period: FinancialPeriod): Promise<WithMeta<Financials | null>>;
  getEstimates(ticker: string): Promise<WithMeta<Estimates | null>>;
  getInsiders(ticker: string): Promise<WithMeta<InsiderTxn[]>>;
  getInstitutional(ticker: string): Promise<WithMeta<InstitutionalHolding[]>>;
  getNews(ticker?: string): Promise<WithMeta<NewsItem[]>>;
  getFilings(ticker: string): Promise<WithMeta<Filing[]>>;
  getCatalysts(ticker?: string): Promise<WithMeta<Catalyst[]>>;
  getScreenRows(): Promise<WithMeta<ScreenRow[]>>;
  /** Earnings-call transcript excerpts (mock only for now) — used for AI citations. */
  getTranscripts(ticker: string): Promise<WithMeta<Transcript[]>>;
}

/** Partial provider: a source may implement only some methods; composite falls through. */
export type PartialProvider = { readonly name: string } & Partial<Omit<MarketDataProvider, 'name'>>;
