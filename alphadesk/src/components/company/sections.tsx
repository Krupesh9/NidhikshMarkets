import 'server-only';
import { MockBanner } from '@/components/shell/MockBanner';
import type { Bar } from '@/lib/data/types';
import { SectionCard } from './SectionCard';
import { PriceChart } from './PriceChart';
import { FinancialStatements } from './FinancialStatements';
import { EstimatesPanel } from './EstimatesPanel';
import { OwnershipPanel } from './OwnershipPanel';
import { NewsFilingsPanel } from './NewsFilingsPanel';
import { loadAllMetas, loadChartEvents, loadEstimates, loadFinancials, loadNewsFilings, loadOwnership } from './server/data';

/** Async server sections — each wrapped in <Suspense> by the page so they stream independently. */

export async function ChartSection({ ticker, initialBars, barsMock }: { ticker: string; initialBars: Bar[]; barsMock: boolean }) {
  const { events, meta } = await loadChartEvents(ticker);
  return (
    <SectionCard id="chart" title="Price & events" description="Daily OHLCV with earnings, 8-K, insider-buy and major-news markers — click a marker for its source." isMock={meta.isMock || barsMock} providers={meta.providers}>
      <PriceChart ticker={ticker} initialBars={initialBars} events={events} isMock={meta.isMock} />
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

export async function EstimatesSection({ ticker }: { ticker: string }) {
  const d = await loadEstimates(ticker);
  return (
    <SectionCard id="estimates" title="Consensus estimates" description="Next FY / next quarter consensus and revision trend." isMock={d.meta.isMock} providers={d.meta.providers}>
      <EstimatesPanel ticker={ticker} estimates={d.estimates} source={d.source} />
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

/** Page-level MockBanner: shown when any section on screen is (partly) simulated. */
export async function PageMockBanner({ ticker, cik, includeBody }: { ticker: string; cik?: string; includeBody: boolean }) {
  const m = await loadAllMetas(ticker, cik, includeBody);
  const real = m.providers.filter((p) => p !== 'Mock');
  return <MockBanner isMock={m.isMock} provider={real.length ? real.join(' + ') : 'Mock'} />;
}
