import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { SearchX } from 'lucide-react';
import { requireSessionUser } from '@/lib/auth';
import { sanitizeTicker } from '@/lib/sanitize';
import { assertFeature } from '@/lib/plans';
import { getMarketData } from '@/lib/data';
import { EmptyState } from '@/components/ui/empty-state';
import { AutoRefresh } from '@/components/shell/AutoRefresh';
import { CompanyHeader } from '@/components/company/CompanyHeader';
import { DeepDiveLimitCard } from '@/components/company/DeepDiveLimitCard';
import { SectionSkeleton } from '@/components/company/SectionCard';
import { ChartSection, EstimatesSection, FinancialsSection, NewsFilingsSection, OwnershipSection, PageMockBanner } from '@/components/company/sections';
import { loadCore } from '@/components/company/server/data';
import { registerDeepDive } from '@/components/company/server/deepDive';

export const dynamic = 'force-dynamic';

export function generateMetadata({ params }: { params: { ticker: string } }): Metadata {
  const t = sanitizeTicker(decodeURIComponent(params.ticker)) ?? 'Company';
  return { title: `${t} · Deep dive` };
}

async function NotFoundState({ raw }: { raw: string }) {
  const { data: universe } = await getMarketData().getUniverse();
  const first = raw.charAt(0).toUpperCase();
  const suggestions = [...universe.filter((u) => u.ticker.startsWith(first)), ...universe].filter((u, i, a) => a.findIndex((x) => x.ticker === u.ticker) === i).slice(0, 6);
  return (
    <div className="mx-auto max-w-2xl py-10">
      <EmptyState
        icon={SearchX}
        title={`We couldn't find "${raw}"`}
        description="No provider (Massive, Nidhiksh cache, SEC EDGAR or the demo universe) recognises this symbol. Check the ticker, or press ⌘K to search by company name."
        action={
          <div className="flex flex-wrap justify-center gap-2">
            {suggestions.map((s) => (
              <Link key={s.ticker} href={`/company/${s.ticker}`} className="rounded border border-border bg-panel-2 px-2 py-1 text-xs hover:border-info/50">
                <span className="font-mono font-semibold text-info">{s.ticker}</span> <span className="text-muted">{s.name}</span>
              </Link>
            ))}
          </div>
        }
      />
    </div>
  );
}

export default async function CompanyPage({ params }: { params: { ticker: string } }) {
  const user = await requireSessionUser();
  const raw = decodeURIComponent(params.ticker).slice(0, 20);
  const ticker = sanitizeTicker(raw);
  if (!ticker) return <NotFoundState raw={raw} />;

  const core = await loadCore(ticker);
  if (!core.found) return <NotFoundState raw={ticker} />;

  const dd = await registerDeepDive(user, ticker);
  const allowed = dd.gate.allowed;
  const cik = core.profile?.cik;

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <Suspense fallback={null}>
        <PageMockBanner ticker={ticker} cik={cik} includeBody={allowed} />
      </Suspense>
      <div className="-mb-3 flex justify-end"><AutoRefresh everyMs={5 * 60_000} /></div>
      <CompanyHeader core={core} canShare={assertFeature(user, 'sharing').allowed} />
      {!allowed ? (
        <DeepDiveLimitCard gate={dd.gate} ticker={ticker} />
      ) : (
        <>
          <Suspense fallback={<SectionSkeleton title="Price & events" height="h-[380px]" />}>
            <ChartSection ticker={ticker} initialBars={core.bars1Y} barsMock={core.meta.isMock} />
          </Suspense>
          <Suspense fallback={<SectionSkeleton title="Financial statements" height="h-10" rows={9} />}>
            <FinancialsSection ticker={ticker} cik={cik} />
          </Suspense>
          <Suspense fallback={<SectionSkeleton title="Analysis" height="h-64" />}>
            <EstimatesSection ticker={ticker} price={core.quote?.price ?? null} />
          </Suspense>
          <Suspense fallback={<SectionSkeleton title="Ownership" height="h-10" rows={8} />}>
            <OwnershipSection ticker={ticker} />
          </Suspense>
          <Suspense fallback={<SectionSkeleton title="News, filings & catalysts" height="h-72" />}>
            <NewsFilingsSection ticker={ticker} />
          </Suspense>
          <p className="pb-2 text-center text-[11px] text-muted">
            {dd.counted ? 'Counted as a deep dive today. ' : ''}Data via the Nidhiksh Pulse provider chain; click any figure for its source. Research only — not investment advice.
          </p>
        </>
      )}
    </div>
  );
}
