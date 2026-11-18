import 'server-only';
import type { InstitutionalHolding, PartialProvider, SourceRef, WithMeta } from './types';
// Built by scripts/build-13f.mjs from the SEC's bulk Form 13F data sets; bundled statically so it works on Vercel.
import latest from '../../../data/13f/latest.json';

export const SEC_13F_DATASET_PAGE = 'https://www.sec.gov/data-research/sec-markets-data/form-13f-data-sets';
export const SEC_13F_PROVIDER = 'SEC Form 13F';

/** holder, filer CIK, shares, value (USD), pct, changeShares, changePct */
export type HolderRow = [string, string, number, number, number, number, number];
export interface TickerEntry {
  cusip: string;
  issuer: string;
  /** 'outstanding' = % of dei:EntityCommonStockSharesOutstanding; '13f' = % of all 13F-reported shares of the CUSIP */
  basis: 'outstanding' | '13f';
  sharesOutstanding?: number;
  holderCount: number;
  total13fShares: number;
  h: HolderRow[];
}
export interface Snapshot {
  file?: string;
  period: string;
  quarter: string;
  priorPeriod: string | null;
  generatedAt: string;
  datasets: { name: string; url: string | null }[];
  tickers: Record<string, TickerEntry>;
}

const SNAPSHOT = latest as unknown as Snapshot;

const norm = (t: string) => t.trim().toUpperCase().replace(/[-/]/g, '.');

export function holdingsFromSnapshot(snap: Snapshot, ticker: string): WithMeta<InstitutionalHolding[]> {
  const e = snap.tickers?.[norm(ticker)];
  const data: InstitutionalHolding[] = (e?.h ?? []).map(([holder, , shares, value, pct, changeShares, changePct]) => ({
    holder, shares, value, pctOfShares: pct, changeShares, changePct, reportDate: snap.period,
  }));
  const source: SourceRef[] = e
    ? [{
        id: `sec-13f:${snap.quarter}:${norm(ticker)}`,
        name: `SEC Form 13F data set — ${snap.quarter} (period ${snap.period})`,
        url: snap.datasets?.[0]?.url ?? SEC_13F_DATASET_PAGE,
        kind: 'ownership',
        locator: `13F-HR information tables, CUSIP ${e.cusip}${snap.priorPeriod ? `; QoQ vs ${snap.priorPeriod}` : ''}`,
        excerpt: `${e.holderCount.toLocaleString('en-US')} 13F filers reported ${e.issuer || norm(ticker)} (${e.total13fShares.toLocaleString('en-US')} shares) for the quarter ended ${snap.period}. `
          + (e.basis === 'outstanding'
            ? `"% out" = shares held / ${e.sharesOutstanding?.toLocaleString('en-US')} shares outstanding (SEC dei:EntityCommonStockSharesOutstanding).`
            : '"% out" here = % of all 13F-reported shares of this security (shares outstanding unavailable for this class).')
          + ' Values in USD as reported; options (PUT/CALL) excluded. 13F covers US institutional managers with >$100M, filed up to 45 days after quarter end.',
      }]
    : [];
  return { data, meta: { source, isMock: false, asOf: `${snap.period}T00:00:00.000Z`, provider: SEC_13F_PROVIDER } };
}

/** Server-only provider: top institutional holders from the bundled 13F snapshot (no network). */
export const sec13fProvider: PartialProvider = {
  name: SEC_13F_PROVIDER,
  async getInstitutional(ticker: string) {
    return holdingsFromSnapshot(SNAPSHOT, ticker);
  },
};
