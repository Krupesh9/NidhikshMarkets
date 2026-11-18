import 'server-only';
import { MockBanner } from '@/components/shell/MockBanner';
import type { Bar } from '@/lib/data/types';
import { SectionCard } from './SectionCard';
import { PriceChart } from './PriceChart';
import { FinancialStatements } from './FinancialStatements';
import { EstimatesPanel } from './EstimatesPanel';
import { OwnershipPanel } from './OwnershipPanel';
import { NewsFilingsPanel } from './NewsFilingsPanel';
import { loadAllMetas, loadEstimates, loadFinancials, loadNewsFilings, loadOwnership } from './server/data';

/** Async server sections — each wrapped in <Suspense> by the page so they stream independently. */

export async function ChartSection({ ticker, initialBars, barsMock }: { ticker: string; initialBars: Bar[]; barsMock: boolean }) {
  return (
    <SectionCard id="chart" title="Price chart" description="Intraday to max-history OHLCV with volume. Add SMA, EMA, SMA × EMA crossovers, MACD and RSI from the indicator toolbar." isMock={barsMock}>
      <PriceChart ticker={ticker} initialBars={initialBars} />
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

/**
 * Page-level MockBanner: only when header-critical data (quote, 1Y history, profile, financials) is simulated.
 * Sections that are still mock (e.g. insiders/13F/catalysts with no real source) keep their own "Demo" badge (SectionCard).
 */
export async function PageMockBanner({ ticker, cik }: { ticker: string; cik?: string; includeBody: boolean }) {
  const m = await loadAllMetas(ticker, cik, false); // core meta only (cached provider calls)
  const real = m.providers.filter((p) => p !== 'Mock');
  return <MockBanner isMock={m.isMock} provider={real.length ? real.join(' + ') : 'Mock'} />;
}
