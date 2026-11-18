import 'server-only';
import type * as React from 'react';
import { MockBanner } from '@/components/shell/MockBanner';
import type { Bar } from '@/lib/data/types';
import { SectionCard } from './SectionCard';
import { PriceChart } from './PriceChart';
import { FinancialStatements } from './FinancialStatements';
import { EstimatesPanel } from './EstimatesPanel';
import { OwnershipPanel } from './OwnershipPanel';
import { NewsFilingsPanel } from './NewsFilingsPanel';
import { loadAllMetas, loadEstimates, loadFinancials, loadNewsFilings, loadOwnership, type CompanyAccess } from './server/data';
import { LockedOverlay } from '@/components/billing/LockedOverlay';
import { ProChip } from '@/components/billing/UpgradeDialog';
import { AnalysisSample, FinancialsSample, OwnershipSample } from '@/components/billing/LockedSamples';
import type { Feature } from '@/lib/plans';

/** Async server sections — each wrapped in <Suspense> by the page so they stream independently. */

export async function ChartSection({ ticker, initialBars, barsMock, canAdvanced = true }: { ticker: string; initialBars: Bar[]; barsMock: boolean; canAdvanced?: boolean }) {
  return (
    <SectionCard id="chart" title="Price chart" description={canAdvanced ? 'Intraday to max-history OHLCV with volume. Add SMA, EMA, SMA × EMA crossovers, MACD and RSI from the indicator toolbar.' : 'Daily price and volume, 1 month to 1 year. Indicators, candlesticks, intraday and long history are on Pro.'} isMock={barsMock}>
      <PriceChart ticker={ticker} initialBars={initialBars} canAdvanced={canAdvanced} />
    </SectionCard>
  );
}

export async function FinancialsSection({ ticker, cik }: { ticker: string; cik?: string }) {
  const d = await loadFinancials(ticker, cik);
  return (
    <SectionCard id="financials" title="Financial statements" description="Every period header links to its source filing." isMock={d.meta.isMock} providers={d.meta.providers}>
      <FinancialStatements ticker={ticker} annual={d.annual} quarterly={d.quarterly} annualSources={d.annualSources} quarterlySources={d.quarterlySources} providers={d.provider} />
    </SectionCard>
  );
}

export async function EstimatesSection({ ticker, price = null }: { ticker: string; price?: number | null }) {
  const d = await loadEstimates(ticker);
  return (
    <SectionCard id="estimates" title="Analysis" description="Analyst ratings, 12-month price targets, recent analyst actions and consensus estimates." isMock={d.meta.isMock} providers={d.meta.providers}>
      <EstimatesPanel ticker={ticker} estimates={d.estimates} source={d.source} price={price} />
    </SectionCard>
  );
}

export async function OwnershipSection({ ticker }: { ticker: string }) {
  const d = await loadOwnership(ticker);
  return (
    <SectionCard id="ownership" title="Ownership" description="Insider transactions (Form 4) and top institutional holders (13F)." isMock={d.meta.isMock} providers={d.meta.providers}>
      <OwnershipPanel ticker={ticker} insiders={d.insiders} institutional={d.institutional} instSource={d.instSource} insiderMock={d.insiderMock} instMock={d.instMock} />
    </SectionCard>
  );
}

export async function NewsFilingsSection({ ticker }: { ticker: string }) {
  const d = await loadNewsFilings(ticker);
  return (
    <SectionCard id="news" title="News, filings & catalysts" isMock={d.meta.isMock} providers={d.meta.providers}>
      <NewsFilingsPanel ticker={ticker} news={d.news} filings={d.filings} catalysts={d.catalysts} catalystsMock={d.catalystsMock} />
    </SectionCard>
  );
}

const LOCKED: Record<'financials' | 'analystResearch' | 'ownership', { id: string; title: string; includes: string; sample: React.ReactNode }> = {
  financials: { id: 'financials', title: 'Financial statements', includes: 'Income statement, balance sheet and cash flow — annual and quarterly, every period linked to its SEC filing — plus EV/EBITDA.', sample: <FinancialsSample /> },
  analystResearch: { id: 'estimates', title: 'Analysis', includes: 'Analyst ratings, 12-month price targets, firm-by-firm analyst actions, consensus EPS and revenue estimates, forward EPS and forward P/E.', sample: <AnalysisSample /> },
  ownership: { id: 'ownership', title: 'Ownership', includes: 'Insider transactions from Form 4 filings and the top institutional holders from 13F reports.', sample: <OwnershipSample /> },
};

/** Locked premium section for Free users: static sample under a glass lock. No data for this ticker is loaded. */
export function LockedSection({ feature }: { feature: Extract<Feature, keyof CompanyAccess> }) {
  const l = LOCKED[feature];
  return (
    <SectionCard id={l.id} title={l.title} actions={<ProChip />}>
      <LockedOverlay feature={feature} includes={l.includes} sample={l.sample} />
    </SectionCard>
  );
}

/** Static sample for the locked Fundamental values card (fixed placeholder numbers, never real data). */
function FundamentalsSample() {
  const tiles = [['Intrinsic value', '$182.40'], ['DCF value / share', '$167.10'], ['PEG ratio', '1.42'], ['Price-to-book', '6.8x'], ['Debt-to-equity', '0.54']];
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {[78, 64, 55].map((w, i) => <div key={i} className="h-7 rounded-md bg-info/60" style={{ width: `${w}%` }} />)}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {tiles.map(([k, v]) => (
          <div key={k} className="rounded-lg border border-border p-3">
            <div className="text-[11px] text-muted">{k}</div>
            <div className="mt-1 font-mono text-lg font-semibold">{v}</div>
          </div>
        ))}
      </div>
      <div className="h-32 rounded-lg border border-border bg-panel-2" />
    </div>
  );
}

/** Locked Fundamental values section (Pro): glass lock over a static sample. */
export function LockedFundamentals() {
  return (
    <SectionCard id="fundamentals" title="Fundamental values" actions={<ProChip />}>
      <LockedOverlay feature="financials" includes="Intrinsic value (Graham), a 3-year DCF with adjustable assumptions, PEG ratio, price-to-book and debt-to-equity with 5-year trends." sample={<FundamentalsSample />} />
    </SectionCard>
  );
}

/**
 * Page-level MockBanner: only when header-critical data (quote, 1Y history, profile, financials) is simulated.
 * Sections that are still mock (e.g. insiders/13F/catalysts with no real source) keep their own "Demo" badge (SectionCard).
 */
export async function PageMockBanner({ ticker, cik, access }: { ticker: string; cik?: string; includeBody: boolean; access: CompanyAccess }) {
  const m = await loadAllMetas(ticker, cik, false, access); // core meta only (cached provider calls)
  const real = m.providers.filter((p) => p !== 'Mock');
  return <MockBanner isMock={m.isMock} provider={real.length ? real.join(' + ') : 'Mock'} />;
}
