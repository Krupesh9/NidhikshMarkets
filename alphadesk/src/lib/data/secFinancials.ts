// SEC XBRL (companyfacts) → Financials mapping. Pure; unit-tested in __tests__/secFinancials.test.ts.
//
// Rules:
//  - Annual rows: duration facts of ~1 year (340–390 days) from 10-K/20-F style forms, keyed by period end.
//  - Quarterly rows: ~3-month (80–100 day) facts. 10-Qs report cash flow year-to-date only and 10-Ks have no Q4,
//    so a missing quarter value is derived by differencing YTD facts that share a start date (e.g. Q4 = FY − 9M).
//  - Balance-sheet items are instants at the period end.
//  - Each value is taken "as originally reported" (earliest filing that contains it); the row links that filing.
import type { FinancialPeriod, Financials, FinancialStatementRow } from './types';

export interface XbrlFact { start?: string; end: string; val: number; accn: string; fy?: number | null; fp?: string | null; form: string; filed: string; frame?: string }
/** tag → facts. Units are already chosen (USD for money, USD/shares for EPS, shares for counts). */
export type FactMap = Record<string, XbrlFact[]>;

const T = {
  revenue: ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'RevenueFromContractWithCustomerIncludingAssessedTax', 'SalesRevenueNet', 'SalesRevenueGoodsNet'],
  costOfRevenue: ['CostOfRevenue', 'CostOfGoodsAndServicesSold', 'CostOfGoodsSold'],
  grossProfit: ['GrossProfit'],
  operatingIncome: ['OperatingIncomeLoss'],
  netIncome: ['NetIncomeLoss', 'ProfitLoss', 'NetIncomeLossAvailableToCommonStockholdersBasic'],
  eps: ['EarningsPerShareDiluted', 'EarningsPerShareBasicAndDiluted', 'EarningsPerShareBasic'],
  da: ['DepreciationDepletionAndAmortization', 'DepreciationAndAmortization', 'DepreciationAmortizationAndAccretionNet', 'Depreciation'],
  ocf: ['NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations'],
  capex: ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets'],
  dilutedShares: ['WeightedAverageNumberOfDilutedSharesOutstanding', 'WeightedAverageNumberOfShareOutstandingBasicAndDiluted'],
  assets: ['Assets'],
  liabilities: ['Liabilities'],
  equity: ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'],
  liabAndEquity: ['LiabilitiesAndStockholdersEquity'],
  cash: ['CashAndCashEquivalentsAtCarryingValue', 'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents', 'Cash'],
  ltDebt: ['LongTermDebt', 'LongTermDebtAndCapitalLeaseObligations'],
  ltDebtNoncurrent: ['LongTermDebtNoncurrent', 'LongTermDebtAndCapitalLeaseObligationsNoncurrent'],
  ltDebtCurrent: ['LongTermDebtCurrent', 'LongTermDebtAndCapitalLeaseObligationsCurrent', 'DebtCurrent'],
  shortDebt: ['CommercialPaper', 'ShortTermBorrowings'],
  sharesOut: ['CommonStockSharesOutstanding', 'EntityCommonStockSharesOutstanding'],
} as const;

const ANNUAL_FORMS = /^(10-K|20-F|40-F|10-KT)/;
const DAY = 86_400_000;
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
const isAnnual = (f: XbrlFact) => !!f.start && days(f.start, f.end) >= 340 && days(f.start, f.end) <= 390;
const isQuarter = (f: XbrlFact) => !!f.start && days(f.start, f.end) >= 80 && days(f.start, f.end) <= 100;
const addDays = (ymd: string, n: number) => new Date(Date.parse(ymd) + n * DAY).toISOString().slice(0, 10);

/** Fiscal-year label from a FY end date: the calendar year it ends in (a 52/53-week year ending Jan 1–7 belongs to the prior year). */
export function fiscalYearLabel(end: string): number {
  const d = new Date(end + 'T00:00:00Z');
  return d.getUTCMonth() === 0 && d.getUTCDate() <= 7 ? d.getUTCFullYear() - 1 : d.getUTCFullYear();
}

/** Per tag, keep one fact per (start,end): the earliest filed (as originally reported). */
function dedupe(facts: XbrlFact[]): XbrlFact[] {
  const by = new Map<string, XbrlFact>();
  for (const f of facts) {
    if (typeof f.val !== 'number' || !isFinite(f.val) || !f.end) continue;
    const k = `${f.start ?? ''}|${f.end}`;
    const cur = by.get(k);
    if (!cur || f.filed < cur.filed) by.set(k, f);
  }
  return Array.from(by.values());
}

class Facts {
  private m = new Map<string, XbrlFact[]>();
  constructor(raw: FactMap) {
    for (const [tag, list] of Object.entries(raw)) if (Array.isArray(list) && list.length) this.m.set(tag, dedupe(list));
  }
  /** Union across candidate tags (filers switch tags over time, e.g. Revenues → RevenueFromContract… after ASC 606). */
  list(tags: readonly string[]): XbrlFact[] {
    return tags.flatMap((t) => this.m.get(t) ?? []);
  }
  /** Duration value over exactly [start,end] (±3 days), else derived from YTD facts sharing a start date. */
  flow(tags: readonly string[], start: string, end: string, allowDiff = true): XbrlFact | null {
    for (const t of tags) {
      const l = this.m.get(t);
      if (!l) continue;
      const near = (a: string | undefined, b: string) => !!a && Math.abs(days(a, b)) <= 3;
      const direct = l.find((f) => near(f.start, start) && near(f.end, end));
      if (direct) return direct;
      if (!allowDiff) continue;
      // YTD(to end) − YTD(to start−1) with a common start
      for (const ytd of l.filter((f) => near(f.end, end) && f.start && f.start < start)) {
        const prior = l.find((f) => f.start === ytd.start && near(f.end, addDays(start, -1)));
        if (prior) return { ...ytd, start, val: ytd.val - prior.val };
      }
    }
    return null;
  }
  instant(tags: readonly string[], end: string): XbrlFact | null {
    for (const t of tags) {
      const f = this.m.get(t)?.find((x) => !x.start && Math.abs(days(x.end, end)) <= 3);
      if (f) return f;
    }
    return null;
  }
}

interface Period { start: string; end: string; fiscalYear: number; fiscalPeriod: string }

function annualPeriods(fx: Facts): Period[] {
  const seen = new Map<string, Period>();
  for (const tags of [T.revenue, T.netIncome, T.operatingIncome]) {
    for (const f of fx.list(tags)) {
      if (!isAnnual(f) || !ANNUAL_FORMS.test(f.form) || seen.has(f.end)) continue;
      seen.set(f.end, { start: f.start!, end: f.end, fiscalYear: fiscalYearLabel(f.end), fiscalPeriod: 'FY' });
    }
  }
  return Array.from(seen.values()).sort((a, b) => a.end.localeCompare(b.end));
}

/** The fiscal year (start/end/label) containing `date`, projecting forward from the latest known FY when needed. */
function fyContaining(annual: Period[], date: string): Period | null {
  const hit = annual.find((p) => date >= p.start && date <= addDays(p.end, 3));
  if (hit) return hit;
  const last = annual[annual.length - 1];
  if (!last || date < last.start) return null;
  let start = addDays(last.end, 1);
  for (let k = 1; k <= 3; k++) {
    const endD = new Date(last.end + 'T00:00:00Z');
    endD.setUTCFullYear(endD.getUTCFullYear() + k);
    const end = endD.toISOString().slice(0, 10);
    if (date <= addDays(end, 7)) return { start, end, fiscalYear: fiscalYearLabel(end), fiscalPeriod: 'FY' };
    start = addDays(end, 1);
  }
  return null;
}

function quarterPeriods(fx: Facts, annual: Period[]): Period[] {
  const ends = new Map<string, string>(); // end -> start
  for (const tags of [T.revenue, T.netIncome, T.operatingIncome]) {
    for (const f of fx.list(tags)) if (isQuarter(f) && !ends.has(f.end)) ends.set(f.end, f.start!);
  }
  // Q4 = (end of the ~9-month YTD fact + 1 day) .. FY end
  for (const a of annual) {
    for (const tags of [T.revenue, T.netIncome]) {
      const nine = fx.list(tags).find((f) => f.start === a.start && f.start && days(f.start, f.end) >= 255 && days(f.start, f.end) <= 290);
      if (nine && !ends.has(a.end)) ends.set(a.end, addDays(nine.end, 1));
    }
  }
  const out: Period[] = [];
  for (const [end, start] of Array.from(ends.entries())) {
    const fy = fyContaining(annual, end);
    if (!fy) continue;
    const q = Math.min(4, Math.max(1, Math.round(days(fy.start, end) / 91.3)));
    out.push({ start, end, fiscalYear: fy.fiscalYear, fiscalPeriod: `Q${q}` });
  }
  return out.sort((a, b) => a.end.localeCompare(b.end));
}

const pct = (a: number, rev: number) => (rev ? Math.round((a / rev) * 1000) / 10 : 0);

function buildRow(fx: Facts, p: Period): FinancialStatementRow | null {
  const flow = (tags: readonly string[], diff = true) => fx.flow(tags, p.start, p.end, diff);
  const inst = (tags: readonly string[]) => fx.instant(tags, p.end);
  const rev = flow(T.revenue);
  const ni = flow(T.netIncome);
  if (!rev && !ni) return null;
  const revenue = rev?.val ?? 0;
  const cogs = flow(T.costOfRevenue);
  const grossProfit = flow(T.grossProfit)?.val ?? (rev && cogs ? revenue - cogs.val : 0);
  const operatingIncome = flow(T.operatingIncome)?.val ?? 0;
  const netIncome = ni?.val ?? 0;
  const da = flow(T.da)?.val ?? 0;
  const ocf = flow(T.ocf)?.val ?? 0;
  const capex = Math.abs(flow(T.capex)?.val ?? 0);
  const assets = inst(T.assets)?.val ?? 0;
  const equity = inst(T.equity)?.val ?? 0;
  const liabilities = inst(T.liabilities)?.val ?? (inst(T.liabAndEquity)?.val ?? assets) - equity;
  const ltDebt = inst(T.ltDebt)?.val ?? (inst(T.ltDebtNoncurrent)?.val ?? 0) + (inst(T.ltDebtCurrent)?.val ?? 0);
  const totalDebt = ltDebt + (inst(T.shortDebt)?.val ?? 0);
  const shares = flow(T.dilutedShares, false)?.val ?? inst(T.sharesOut)?.val ?? 0;
  const eps = flow(T.eps)?.val ?? (shares ? netIncome / shares : 0);
  const src = rev ?? ni!;
  return {
    fiscalYear: p.fiscalYear, fiscalPeriod: p.fiscalPeriod, periodEnd: p.end,
    revenue, grossProfit, operatingIncome, netIncome, ebitda: operatingIncome + da, eps: Math.round(eps * 100) / 100,
    totalAssets: assets, totalLiabilities: liabilities, totalEquity: equity, cash: inst(T.cash)?.val ?? 0, totalDebt,
    operatingCashFlow: ocf, capex, freeCashFlow: ocf - capex, sharesOutstanding: shares,
    grossMargin: pct(grossProfit, revenue), operatingMargin: pct(operatingIncome, revenue), netMargin: pct(netIncome, revenue),
    sourceId: `sec:${src.accn}`,
  };
}

/** Map XBRL facts to statement rows (oldest first). `limit` keeps the most recent N periods. */
export function mapSecFinancials(ticker: string, raw: FactMap, period: FinancialPeriod, limit = period === 'annual' ? 30 : 16): Financials | null {
  const fx = new Facts(raw);
  const annual = annualPeriods(fx);
  const periods = period === 'annual' ? annual : quarterPeriods(fx, annual);
  const rows = periods.map((p) => buildRow(fx, p)).filter((r): r is FinancialStatementRow => !!r).slice(-limit);
  return rows.length ? { ticker: ticker.toUpperCase(), period, currency: 'USD', rows } : null;
}

/** Flatten SEC companyfacts JSON ({facts:{'us-gaap':{Tag:{units:{USD:[...]}}}, dei:{...}}}) into a FactMap. */
export function factMapFromCompanyFacts(json: unknown): FactMap {
  const out: FactMap = {};
  const facts = (json as { facts?: Record<string, Record<string, { units?: Record<string, XbrlFact[]> }>> })?.facts ?? {};
  for (const ns of ['us-gaap', 'dei', 'ifrs-full']) {
    for (const [tag, def] of Object.entries(facts[ns] ?? {})) {
      const units = def.units ?? {};
      const list = units.USD ?? units['USD/shares'] ?? units.shares;
      if (list && !out[tag]) out[tag] = list;
    }
  }
  return out;
}

/** Accession → EDGAR filing index URL. */
export function secFilingUrl(cik: string | number, accn: string): string {
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accn.replace(/-/g, '')}/${accn}-index.htm`;
}
