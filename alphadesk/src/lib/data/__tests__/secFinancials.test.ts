import { describe, expect, it } from 'vitest';
import { factMapFromCompanyFacts, fiscalYearLabel, mapSecFinancials, secFilingUrl, type FactMap, type XbrlFact } from '../secFinancials';

// Minimal companyfacts-shaped fixture for a calendar fiscal year filer.
const K24 = { accn: '0000000001-25-000010', form: '10-K', filed: '2025-02-10' };
const K25 = { accn: '0000000001-26-000010', form: '10-K', filed: '2026-02-10' };
const Q1 = { accn: '0000000001-25-000020', form: '10-Q', filed: '2025-05-01' };
const Q2 = { accn: '0000000001-25-000030', form: '10-Q', filed: '2025-08-01' };
const Q3 = { accn: '0000000001-25-000040', form: '10-Q', filed: '2025-11-01' };
const d = (start: string | undefined, end: string, val: number, f: { accn: string; form: string; filed: string }): XbrlFact => ({ start, end, val, ...f });

const facts: FactMap = {
  // pre-ASC 606 tag for FY2024; post tag for 2025 — both must be picked up
  SalesRevenueNet: [d('2024-01-01', '2024-12-31', 400, K24)],
  RevenueFromContractWithCustomerExcludingAssessedTax: [
    d('2025-01-01', '2025-03-31', 100, Q1), d('2025-04-01', '2025-06-30', 110, Q2), d('2025-07-01', '2025-09-30', 120, Q3),
    d('2025-01-01', '2025-09-30', 330, Q3), // 9M YTD
    d('2025-01-01', '2025-12-31', 460, K25),
  ],
  CostOfRevenue: [d('2025-01-01', '2025-03-31', 40, Q1), d('2025-01-01', '2025-12-31', 180, K25), d('2025-01-01', '2025-09-30', 130, Q3)],
  OperatingIncomeLoss: [d('2025-01-01', '2025-03-31', 30, Q1), d('2025-01-01', '2025-12-31', 150, K25)],
  NetIncomeLoss: [
    d('2024-01-01', '2024-12-31', 80, K24),
    d('2024-01-01', '2024-12-31', 999, K25), // later comparative: earliest-filed (as reported) wins
    d('2025-01-01', '2025-03-31', 20, Q1), d('2025-04-01', '2025-06-30', 22, Q2), d('2025-07-01', '2025-09-30', 24, Q3),
    d('2025-01-01', '2025-09-30', 66, Q3), d('2025-01-01', '2025-12-31', 96, K25),
  ],
  EarningsPerShareDiluted: [d('2025-01-01', '2025-03-31', 0.2, Q1), d('2025-01-01', '2025-12-31', 0.96, K25), d('2025-01-01', '2025-09-30', 0.66, Q3)],
  DepreciationDepletionAndAmortization: [d('2025-01-01', '2025-12-31', 20, K25)],
  // cash flow is YTD-only in 10-Qs
  NetCashProvidedByUsedInOperatingActivities: [
    d('2025-01-01', '2025-03-31', 25, Q1), d('2025-01-01', '2025-06-30', 55, Q2), d('2025-01-01', '2025-09-30', 90, Q3), d('2025-01-01', '2025-12-31', 130, K25),
  ],
  PaymentsToAcquirePropertyPlantAndEquipment: [d('2025-01-01', '2025-06-30', 12, Q2), d('2025-01-01', '2025-03-31', 5, Q1)],
  WeightedAverageNumberOfDilutedSharesOutstanding: [d('2025-01-01', '2025-03-31', 100, Q1), d('2025-01-01', '2025-12-31', 100, K25)],
  Assets: [d(undefined, '2025-03-31', 1000, Q1), d(undefined, '2025-12-31', 1200, K25)],
  Liabilities: [d(undefined, '2025-12-31', 700, K25)],
  StockholdersEquity: [d(undefined, '2025-03-31', 450, Q1), d(undefined, '2025-12-31', 500, K25)],
  LiabilitiesAndStockholdersEquity: [d(undefined, '2025-03-31', 1000, Q1)],
  CashAndCashEquivalentsAtCarryingValue: [d(undefined, '2025-12-31', 50, K25)],
  LongTermDebtNoncurrent: [d(undefined, '2025-12-31', 200, K25)],
  LongTermDebtCurrent: [d(undefined, '2025-12-31', 10, K25)],
  CommercialPaper: [d(undefined, '2025-12-31', 5, K25)],
};

describe('SEC XBRL → Financials mapping', () => {
  it('builds annual rows from 10-K ~1y facts, oldest first, across revenue tag changes', () => {
    const a = mapSecFinancials('abc', facts, 'annual')!;
    expect(a.ticker).toBe('ABC');
    expect(a.rows.map((r) => [r.fiscalYear, r.fiscalPeriod, r.revenue])).toEqual([[2024, 'FY', 400], [2025, 'FY', 460]]);
    const fy25 = a.rows[1];
    expect(fy25.grossProfit).toBe(280);
    expect(fy25.ebitda).toBe(170); // operating income + D&A
    expect(fy25.totalDebt).toBe(215); // LT noncurrent + current + commercial paper
    expect(fy25.freeCashFlow).toBe(fy25.operatingCashFlow - fy25.capex);
    expect(fy25.grossMargin).toBeCloseTo(60.9, 1);
    expect(fy25.sourceId).toBe(`sec:${K25.accn}`);
  });

  it('uses the as-originally-reported value (earliest filing) for restated comparatives', () => {
    const a = mapSecFinancials('ABC', facts, 'annual')!;
    expect(a.rows[0].netIncome).toBe(80);
  });

  it('labels quarters and derives Q4 = FY − 9M YTD', () => {
    const q = mapSecFinancials('ABC', facts, 'quarterly')!;
    expect(q.rows.map((r) => `${r.fiscalYear}${r.fiscalPeriod}`)).toEqual(['2025Q1', '2025Q2', '2025Q3', '2025Q4']);
    const q4 = q.rows[3];
    expect(q4.revenue).toBe(130); // 460 − 330
    expect(q4.netIncome).toBe(30); // 96 − 66
    expect(q4.grossProfit).toBe(80); // 130 − (180 − 130)
    expect(q4.eps).toBeCloseTo(0.3, 5);
    expect(q4.periodEnd).toBe('2025-12-31');
  });

  it('differences YTD cash-flow facts into discrete quarters', () => {
    const q = mapSecFinancials('ABC', facts, 'quarterly')!;
    expect(q.rows.map((r) => r.operatingCashFlow)).toEqual([25, 30, 35, 40]);
    expect(q.rows[1].capex).toBe(7); // 12 − 5, positive outflow
  });

  it('reads balance-sheet instants at period end and derives liabilities when untagged', () => {
    const q = mapSecFinancials('ABC', facts, 'quarterly')!;
    expect(q.rows[0].totalAssets).toBe(1000);
    expect(q.rows[0].totalLiabilities).toBe(550); // L&SE − equity
  });

  it('returns null when nothing maps', () => {
    expect(mapSecFinancials('ABC', {}, 'annual')).toBeNull();
  });

  it('fiscal-year label handles 52/53-week years ending in early January', () => {
    expect(fiscalYearLabel('2026-01-25')).toBe(2026); // NVDA-style late-January year end
    expect(fiscalYearLabel('2025-01-03')).toBe(2024);
    expect(fiscalYearLabel('2025-09-27')).toBe(2025);
  });

  it('flattens companyfacts JSON by unit and builds filing URLs', () => {
    const json = { facts: { 'us-gaap': { Assets: { units: { USD: [d(undefined, '2025-12-31', 1, K25)] } }, EarningsPerShareDiluted: { units: { 'USD/shares': [d('2025-01-01', '2025-12-31', 2, K25)] } } } } };
    const m = factMapFromCompanyFacts(json);
    expect(Object.keys(m).sort()).toEqual(['Assets', 'EarningsPerShareDiluted']);
    expect(secFilingUrl('0001045810', '0001045810-26-000075')).toBe('https://www.sec.gov/Archives/edgar/data/1045810/000104581026000075/0001045810-26-000075-index.htm');
  });
});
