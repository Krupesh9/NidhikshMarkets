import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { ArrowLeft, Info } from 'lucide-react';
import { requireSessionUser } from '@/lib/auth';
import { hasFeature } from '@/lib/plans';
import { LockedOverlay } from '@/components/billing/LockedOverlay';
import { HoldingsSample } from '@/components/billing/LockedSamples';
import { marketBySlug } from '@/lib/markets/global';
import { getMarketHistory, getMarketSnapshot } from '@/lib/markets/detail';
import { AutoRefresh } from '@/components/shell/AutoRefresh';
import { Card, CardContent } from '@/components/ui/card';
import { Delta } from '@/components/ui/delta';
import { MarketChart } from '@/components/markets/MarketChart';
import { IndexSections, KeyStats, MacroDates, MarketNewsSection, SectionSkeleton } from '@/components/markets/sections';
import { fmt } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  return { title: marketBySlug(params.slug)?.label ?? 'Market' };
}

const KIND_LABEL = { index: 'Equity index', commodity: 'Commodity', yield: 'US Treasury yield' } as const;

export default async function MarketPage({ params }: { params: { slug: string } }) {
  const user = await requireSessionUser();
  const canHoldings = hasFeature(user, 'marketHoldings');
  const market = marketBySlug(params.slug);
  if (!market) notFound();
  const [snap, history] = await Promise.all([getMarketSnapshot(market), getMarketHistory(market, '1Y')]);
  const isYield = snap.unit === 'yield';
  const onEtf = market.kind !== 'yield' && snap.code === market.etf;
  const asOf = snap.asOf ? (snap.asOf.length <= 10 ? fmt.date(`${snap.asOf}T12:00:00Z`) : new Date(snap.asOf).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })) : null;

  return (
    <div className="page-enter mx-auto max-w-[1400px] space-y-6">
      <header className="space-y-4">
        <Link href="/dashboard" className="inline-flex items-center gap-1.5 rounded text-xs text-muted hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Global markets
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <div className="eyebrow">{KIND_LABEL[market.kind]} · <span className="font-mono normal-case tracking-normal">{snap.code}</span></div>
            <h1 className="mt-1 text-3xl font-semibold tracking-[-0.02em]">{market.label}</h1>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <span className="font-mono text-4xl font-semibold tabular-nums">
                {snap.value == null ? '—' : isYield ? `${snap.value.toFixed(2)}%` : fmt.price(snap.value)}
              </span>
              {isYield
                ? <Delta value={snap.change} suffix=" bp" dp={0} badge className="text-sm" />
                : <Delta value={snap.changePct} amount={snap.change} badge className="text-sm" />}
            </div>
            <p className="mt-2 text-xs text-muted">
              {snap.note}{asOf ? ` · as of ${asOf}` : ''} · source{' '}
              {snap.source.url ? <a href={snap.source.url} target="_blank" rel="noopener noreferrer" className="hover:text-info hover:underline">{snap.source.name}</a> : snap.source.name}
            </p>
          </div>
          <AutoRefresh everyMs={5 * 60_000} />
        </div>
        {onEtf && market.kind === 'commodity' && (
          <p role="note" className="flex items-start gap-2 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            Showing the {market.etf} ETF as a proxy because the futures / spot feed is unavailable. ETF prices track but don&apos;t equal the commodity price (roll costs, fees).
          </p>
        )}
      </header>

      <Card>
        <CardContent className="pt-5">
          <MarketChart slug={market.slug} label={market.label} initial={history} />
        </CardContent>
      </Card>

      {market.kind === 'index' && !canHoldings && (
        <Card>
          <CardContent className="pt-5">
            <LockedOverlay feature="marketHoldings" title="Index holdings are a Pro feature"
              includes={`Top 10 holdings of the ${market.etf ?? 'index'} proxy with weights, sector breakdown and each name's contribution to today's move.`}
              sample={<HoldingsSample />} minHeight={360} />
          </CardContent>
        </Card>
      )}
      {market.kind === 'index' && canHoldings && (
        <Suspense fallback={<div className="grid gap-6 xl:grid-cols-3"><SectionSkeleton title="Top 10 holdings" rows={10} className="xl:col-span-2" /><SectionSkeleton title="Contribution" rows={4} /></div>}>
          <IndexSections market={market} snapshot={snap} />
        </Suspense>
      )}
      {market.kind !== 'index' && (
        <Suspense fallback={<SectionSkeleton title="Key stats" rows={2} />}>
          <KeyStats market={market} snapshot={snap} />
        </Suspense>
      )}
      {market.kind === 'yield' && (
        <Suspense fallback={<SectionSkeleton title="Rate-moving dates" rows={2} />}>
          <MacroDates />
        </Suspense>
      )}
      <Suspense fallback={<SectionSkeleton title="Related news" rows={6} />}>
        <MarketNewsSection market={market} />
      </Suspense>
      <p className="text-center text-[11px] text-muted">Research only — not investment advice.</p>
    </div>
  );
}
