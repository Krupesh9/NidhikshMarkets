// BQL-style snippet builder (pure). Gives analysts a starting query to reproduce an answer in a terminal / Excel add-in.
import type { Metric } from './intent';
import type { BqlBlock } from './types';

const FIELD: Record<Metric, string> = {
  revenue: 'SALES_REV_TURN',
  revenue_growth: 'SALES_GROWTH',
  gross_margin: 'GROSS_MARGIN',
  operating_margin: 'OPER_MARGIN',
  net_margin: 'PROF_MARGIN',
  fcf_margin: 'FREE_CASH_FLOW_MARGIN',
  eps: 'IS_EPS',
  pe: 'PE_RATIO',
  ev_ebitda: 'EV_TO_T12M_EBITDA',
  market_cap: 'CUR_MKT_CAP',
};

export function bqlField(m: Metric): string {
  return FIELD[m];
}

export function security(t: string): string {
  return `'${t.replace('.', '/').toUpperCase()} US Equity'`;
}

/** e.g. get(SALES_REV_TURN, GROSS_MARGIN) for(['AAPL US Equity','MSFT US Equity']) with(fpt=A, fpo=range(-5Y,0Y)) */
export function buildBql(tickers: string[], metrics: Metric[], years = 5, opts: { title?: string } = {}): BqlBlock {
  const fields = [...new Set((metrics.length ? metrics : ['revenue', 'gross_margin'] as Metric[]).map(bqlField))];
  const pointInTime = metrics.every((m) => m === 'pe' || m === 'ev_ebitda' || m === 'market_cap');
  const univ = `for([${tickers.map(security).join(',')}])`;
  const query = pointInTime ? `get(${fields.join(', ')}) ${univ}` : `get(${fields.join(', ')}) ${univ} with(fpt=A, fpo=range(-${Math.max(1, years)}Y,0Y))`;
  const excel = `=BQL("${tickers.map((t) => `${t.toUpperCase()} US Equity`).join(',')}", "${fields.join(',')}"${pointInTime ? '' : `, "fpt=A", "fpo=range(-${Math.max(1, years)}Y,0Y)"`})`;
  return { type: 'bql', title: opts.title ?? 'Reproduce in BQL', query, excel };
}

/** Screen-style BQL: filter a sector universe. */
export function buildScreenBql(filters: { sector?: string; maxPe?: number; minRevenueGrowth?: number; minMarketCapB?: number }): BqlBlock {
  const conds: string[] = [];
  if (filters.sector) conds.push(`GICS_SECTOR_NAME=='${filters.sector}'`);
  if (filters.maxPe != null) conds.push(`PE_RATIO<${filters.maxPe}`);
  if (filters.minRevenueGrowth != null) conds.push(`SALES_GROWTH>${filters.minRevenueGrowth}`);
  if (filters.minMarketCapB != null) conds.push(`CUR_MKT_CAP>${filters.minMarketCapB}B`);
  const where = conds.length ? `filter(members('SPX Index'), ${conds.join(' and ')})` : `members('SPX Index')`;
  return {
    type: 'bql', title: 'Reproduce screen in BQL',
    query: `get(NAME, CUR_MKT_CAP, PE_RATIO, SALES_GROWTH) for(${where})`,
    excel: `=BQL("${where.replace(/"/g, "'")}", "NAME,CUR_MKT_CAP,PE_RATIO,SALES_GROWTH")`,
  };
}
