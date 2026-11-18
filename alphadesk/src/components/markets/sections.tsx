import 'server-only';
/** Async server sections for /markets/[slug]; each is streamed inside <Suspense> with a skeleton. */
import Link from 'next/link';
import { CalendarClock, Landmark, Layers, Newspaper, PieChart, Sigma, TrendingDown, TrendingUp } from 'lucide-react';
import { getMarketData, type NewsItem, type Quote } from '@/lib/data';
import type { MarketDef } from '@/lib/markets/global';
import { getIndexHoldings, type IndexHoldings } from '@/lib/markets/holdings';
import { getMarketNews, getNextMacro, getRangeStats, type MarketSnapshot } from '@/lib/markets/detail';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Delta } from '@/components/ui/delta';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { CompanyLogo } from '@/components/ui/company-logo';
import { MockBanner } from '@/components/shell/MockBanner';
import { cn, fmt } from '@/lib/utils';

const ext = { target: '_blank', rel: 'noopener noreferrer' } as const;
const linkCls = 'hover:text-info hover:underline';

function SectionTitle({ icon: Icon, children, action, id }: { icon: typeof Layers; children: React.ReactNode; action?: React.ReactNode; id?: string }) {
  return (
    <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
      <CardTitle id={id} className="flex items-center gap-2 text-sm"><Icon className="h-4 w-4 text-muted" aria-hidden /> {children}</CardTitle>
      {action}
    </CardHeader>
  );
}

function SourceLine({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn('mt-4 border-t border-border pt-3 text-[11px] leading-relaxed text-muted', className)}>{children}</p>;
}

export function SectionSkeleton({ title, rows = 5, className }: { title: string; rows?: number; className?: string }) {
  return (
    <Card className={className} role="status" aria-label={`Loading ${title}`}>
      <CardHeader className="pb-3"><span className="eyebrow">{title}</span></CardHeader>
      <CardContent className="space-y-3">
        {Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className="h-9" />)}
      </CardContent>
    </Card>
  );
}

const pctW = (w: number) => `${(w * 100).toFixed(2)}%`;

/* ------------------------------------ index ------------------------------------ */

interface Row { h: IndexHoldings['top10'][number]; q: Quote | undefined }

/** Top-10 holdings table + sector weights + leaders/laggards + contribution. */
export async function IndexSections({ market, snapshot }: { market: MarketDef; snapshot: MarketSnapshot }) {
  const holdings = await getIndexHoldings(market.slug);
  if (!holdings) {
    return (
      <Card>
        <SectionTitle icon={Layers}>Top 10 holdings</SectionTitle>
        <CardContent>
          <EmptyState icon={Layers} title="Holdings source unavailable" description="The public constituents file didn't respond. It's retried every 10 minutes — the chart and news below are unaffected." />
        </CardContent>
      </Card>
    );
  }
  const quotesRes = await getMarketData().getQuotes(holdings.top10.map((h) => h.ticker)).catch(() => null);
  const qmap = new Map((quotesRes?.data ?? []).map((q) => [q.ticker, q]));
  const rows: Row[] = holdings.top10.map((h) => ({ h, q: qmap.get(h.ticker) }));
  const maxW = Math.max(...rows.map((r) => r.h.weight), 0.0001);
  const top10Weight = rows.reduce((s, r) => s + r.h.weight, 0);
  const priced = rows.filter((r) => r.q && Number.isFinite(r.q.changePct));
  const contribution = priced.reduce((s, r) => s + r.h.weight * r.q!.changePct, 0); // percentage points of index return
  const isLevel = snapshot.code !== ('etf' in market ? market.etf : '');
  const prevLevel = snapshot.value != null && snapshot.change != null ? snapshot.value - snapshot.change : null;
  const pts = isLevel && prevLevel ? (contribution / 100) * prevLevel : null;
  const sorted = [...priced].sort((a, b) => b.q!.changePct - a.q!.changePct);
  const leaders = sorted.slice(0, 3);
  const laggards = sorted.slice(-3).reverse();
  const asOf = holdings.asOf ? fmt.date(`${holdings.asOf}T12:00:00Z`) : 'latest';
  const isMock = !!quotesRes?.meta.isMock;

  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <Card className="xl:col-span-2">
        <SectionTitle icon={Layers} id="holdings-h"
          action={<span className="text-[11px] text-muted">{holdings.count.toLocaleString()} constituents · top 10 = {pctW(top10Weight)}{holdings.weightLabel.startsWith('≈') ? ' (≈)' : ''}</span>}>
          Top 10 holdings
        </SectionTitle>
        <CardContent>
          {isMock && <MockBanner isMock provider={quotesRes?.meta.provider} className="mb-3" />}
          <div className="-mx-2 overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm" aria-labelledby="holdings-h">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-muted">
                  <th scope="col" className="w-8 px-2 py-2 font-medium">#</th>
                  <th scope="col" className="px-2 py-2 font-medium">Company</th>
                  <th scope="col" className="w-[30%] px-2 py-2 font-medium">{holdings.weightLabel}</th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">Price</th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">Today</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ h, q }, i) => (
                  <tr key={h.ticker} className="border-t border-border transition-colors hover:bg-panel-2/60">
                    <td className="px-2 py-2.5 font-mono text-xs text-muted tabular-nums">{i + 1}</td>
                    <td className="px-2 py-2.5">
                      <Link href={`/company/${encodeURIComponent(h.ticker)}`} className="group flex items-center gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info">
                        <CompanyLogo ticker={h.ticker} size={30} />
                        <span className="min-w-0">
                          <span className="block font-mono text-[13px] font-semibold text-info group-hover:underline">
                            {h.ticker}{h.classes?.length ? <span className="ml-1 font-normal text-muted">+{h.classes.join(', ')}</span> : null}
                          </span>
                          <span className="block max-w-[260px] truncate text-xs text-muted" title={h.name}>{h.name}{h.sector ? ` · ${h.sector}` : ''}</span>
                        </span>
                      </Link>
                    </td>
                    <td className="px-2 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-panel-2" aria-hidden>
                          <div className="h-full rounded-full bg-info/80" style={{ width: `${(h.weight / maxW) * 100}%` }} />
                        </div>
                        <span className="w-14 text-right font-mono text-xs tabular-nums">{pctW(h.weight)}</span>
                      </div>
                    </td>
                    <td className="px-2 py-2.5 text-right font-mono tabular-nums">{q ? fmt.price(q.price) : '—'}</td>
                    <td className="px-2 py-2.5 text-right"><Delta value={q?.changePct} badge /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <SourceLine>
            Constituents & weights: <a href={holdings.source.url} {...ext} className={linkCls}>{holdings.source.name}</a> as of {asOf} · {holdings.method}.
            {' '}Prices: {quotesRes?.meta.provider || 'market data'}{quotesRes?.meta.asOf ? `, ${new Date(quotesRes.meta.asOf).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : ''}.
          </SourceLine>
        </CardContent>
      </Card>

      <div className="space-y-6">
        <Card>
          <SectionTitle icon={Sigma}>Top-10 contribution today</SectionTitle>
          <CardContent>
            {priced.length ? (
              <>
                <div className="flex items-baseline gap-3">
                  <span className={cn('font-mono text-3xl font-semibold tabular-nums', contribution > 0 ? 'text-up' : contribution < 0 ? 'text-down' : 'text-text')}>
                    {contribution > 0 ? '+' : ''}{contribution.toFixed(2)}
                  </span>
                  <span className="text-sm text-muted">pct pts</span>
                </div>
                <p className="mt-2 text-sm text-muted">
                  The top 10 contributed <strong className="text-text">{contribution > 0 ? '+' : ''}{contribution.toFixed(2)} pts</strong> of the index&apos;s{' '}
                  {snapshot.changePct != null ? <strong className="text-text">{snapshot.changePct > 0 ? '+' : ''}{snapshot.changePct.toFixed(2)}%</strong> : 'day'} move
                  {pts != null && <> (≈ {pts > 0 ? '+' : '−'}{fmt.num(Math.abs(pts), Math.abs(pts) < 10 ? 1 : 0)} index points)</>}.
                </p>
                {snapshot.changePct != null && Math.abs(snapshot.changePct) > 0.005 && (
                  <div className="mt-4">
                    <div className="flex justify-between text-[11px] text-muted"><span>Share of the move from the top 10</span><span className="font-mono">{Math.round((contribution / snapshot.changePct) * 100)}%</span></div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-panel-2" aria-hidden>
                      <div className={cn('h-full rounded-full', contribution * snapshot.changePct >= 0 ? 'bg-info/80' : 'bg-warn/80')} style={{ width: `${Math.min(100, Math.abs(contribution / snapshot.changePct) * 100)}%` }} />
                    </div>
                  </div>
                )}
                <SourceLine>Σ weight × today&apos;s % change for the {priced.length} priced holdings. Approximate — research only.</SourceLine>
              </>
            ) : <p className="text-sm text-muted">No live quotes for the top holdings yet.</p>}
          </CardContent>
        </Card>

        <Card>
          <SectionTitle icon={TrendingUp}>Today&apos;s leaders &amp; laggards</SectionTitle>
          <CardContent>
            {priced.length >= 2 ? (
              <div className="grid grid-cols-2 gap-4">
                {[{ label: 'Leaders', list: leaders, Icon: TrendingUp }, { label: 'Laggards', list: laggards, Icon: TrendingDown }].map(({ label, list, Icon }) => (
                  <div key={label}>
                    <div className="eyebrow flex items-center gap-1.5"><Icon className="h-3.5 w-3.5" aria-hidden />{label}</div>
                    <ul className="mt-2 space-y-2">
                      {list.map((r) => (
                        <li key={r.h.ticker} className="flex items-center justify-between gap-2">
                          <Link href={`/company/${encodeURIComponent(r.h.ticker)}`} className="flex min-w-0 items-center gap-2 font-mono text-[13px] font-semibold text-info hover:underline">
                            <CompanyLogo ticker={r.h.ticker} size={22} />{r.h.ticker}
                          </Link>
                          <Delta value={r.q!.changePct} className="text-xs" />
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ) : <p className="text-sm text-muted">Waiting for quotes.</p>}
            <SourceLine>Among the top 10 holdings · {quotesRes?.meta.provider || 'market data'}.</SourceLine>
          </CardContent>
        </Card>

        {holdings.sectors.length > 0 && (
          <Card>
            <SectionTitle icon={PieChart}>Sector weights</SectionTitle>
            <CardContent>
              <ul className="space-y-2.5">
                {holdings.sectors.slice(0, 11).map((s, i) => (
                  <li key={s.sector}>
                    <div className="flex items-center justify-between text-xs">
                      <span className={cn(s.sector === 'Unclassified' && 'text-muted')}>{s.sector}</span>
                      <span className="font-mono tabular-nums">{pctW(s.weight)}</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-panel-2" aria-hidden>
                      <div className={cn('h-full rounded-full', s.sector === 'Unclassified' ? 'bg-muted/50' : i === 0 ? 'bg-accent/90' : 'bg-info/70')} style={{ width: `${(s.weight / holdings.sectors[0].weight) * 100}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
              {holdings.sectorSource && (
                <SourceLine>
                  Weights from {holdings.source.name}, sectors per <a href={holdings.sectorSource.url} {...ext} className={linkCls}>{holdings.sectorSource.name}</a> (not GICS) · {Math.round(holdings.sectorSource.coverage * 100)}% of weight classified.
                </SourceLine>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------- key stats ---------------------------------- */

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-panel-2/50 p-4">
      <div className="eyebrow">{label}</div>
      <div className="mt-1.5 font-mono text-lg font-semibold tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-muted">{sub}</div>}
    </div>
  );
}

/** Commodity / yield key stats from the 1Y daily series (plus day range from the ETF quote on fallback). */
export async function KeyStats({ market, snapshot }: { market: MarketDef; snapshot: MarketSnapshot }) {
  const { stats, quote, source } = await getRangeStats(market);
  const yieldMode = market.kind === 'yield';
  const v = (n: number | null) => (n == null ? '—' : yieldMode ? `${n.toFixed(2)}%` : fmt.price(n));
  const chg = (n: number | null) => (n == null ? '—' : <Delta value={n} suffix={yieldMode ? ' bp' : '%'} dp={yieldMode ? 0 : 2} className="text-lg" />);
  const pos = stats.low52 != null && stats.high52 != null && stats.last != null && stats.high52 > stats.low52 ? (stats.last - stats.low52) / (stats.high52 - stats.low52) : null;
  return (
    <Card>
      <SectionTitle icon={Landmark}>Key stats</SectionTitle>
      <CardContent>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
          {quote ? <Stat label="Day range" value={`${v(quote.low)} – ${v(quote.high)}`} sub={`${market.kind === 'yield' ? '' : (market as { etf: string }).etf} ETF session`} />
            : <Stat label="Last close" value={v(stats.last)} sub={stats.asOf ? fmt.date(`${stats.asOf}T12:00:00Z`) : undefined} />}
          <Stat label="1 month" value={chg(stats.chg1M)} />
          <Stat label="3 months" value={chg(stats.chg3M)} />
          <Stat label={yieldMode ? '1 year' : 'Year to date'} value={chg(yieldMode ? stats.chg1Y : stats.chgYTD)} />
          <Stat label="52-week range" value={<span className="text-base">{v(stats.low52)} – {v(stats.high52)}</span>}
            sub={pos != null ? (
              <span className="mt-1.5 block h-1 rounded-full bg-panel" aria-label={`at ${Math.round(pos * 100)}% of the 52-week range`}>
                <span className="relative block h-1 rounded-full bg-info/70" style={{ width: `${Math.max(2, pos * 100)}%` }} />
              </span>
            ) : undefined} />
        </div>
        <SourceLine>
          Computed from daily closes ({source.url ? <a href={source.url} {...ext} className={linkCls}>{source.name}</a> : source.name}; {snapshot.note}).
          {yieldMode ? ' Changes in basis points (1 bp = 0.01 pct pt).' : ''}
        </SourceLine>
      </CardContent>
    </Card>
  );
}

/** Next FOMC decision + next CPI release (yield pages). */
export async function MacroDates() {
  const { fomc, cpi } = await getNextMacro();
  const when = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const days = (d: string) => Math.round((Date.parse(`${d}T12:00:00Z`) - Date.now()) / 86_400_000);
  const items = [{ label: 'Next Fed decision', e: fomc }, { label: 'Next CPI release', e: cpi }];
  return (
    <Card>
      <SectionTitle icon={CalendarClock} action={<Link href="/calendar" className="text-[11px] text-info hover:underline">Full calendar</Link>}>Rate-moving dates</SectionTitle>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-2">
          {items.map(({ label, e }) => (
            <div key={label} className="rounded-lg border border-border bg-panel-2/50 p-4">
              <div className="eyebrow">{label}</div>
              {e ? (
                <>
                  <div className="mt-1.5 text-lg font-semibold">{when(e.date)}</div>
                  <div className="text-xs text-muted">
                    {e.time ? `${e.time} · ` : ''}{days(e.date) <= 0 ? 'today' : `in ${days(e.date)} day${days(e.date) === 1 ? '' : 's'}`}{e.estimated ? ' · estimated' : ''}
                  </div>
                  <div className="mt-2 text-[11px] text-muted">{e.source.url ? <a href={e.source.url} {...ext} className={linkCls}>{e.source.name}</a> : e.source.name}</div>
                </>
              ) : <div className="mt-1.5 text-sm text-muted">Not scheduled in the next 120 days.</div>}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------- news ------------------------------------- */

export async function MarketNewsSection({ market }: { market: MarketDef }) {
  const tickers = market.kind === 'index' ? (await getIndexHoldings(market.slug))?.top10.flatMap((h) => [h.ticker]) ?? [] : [];
  const { items, sources } = await getMarketNews(market, tickers, 12);
  const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const Title = ({ n }: { n: NewsItem }) => /^https?:\/\//i.test(n.url)
    ? <a href={n.url} {...ext} className="font-medium leading-snug hover:text-info">{n.title}</a>
    : <span className="font-medium leading-snug">{n.title}</span>;
  return (
    <Card>
      <SectionTitle icon={Newspaper}>Related news</SectionTitle>
      <CardContent>
        {items.length ? (
          <ul className="grid gap-x-8 gap-y-4 md:grid-cols-2">
            {items.map((n) => (
              <li key={n.id} className="border-t border-border pt-3 text-sm">
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                  {n.tickers.slice(0, 3).map((t) => <Link key={t} href={`/company/${encodeURIComponent(t)}`} className="font-mono font-semibold text-info hover:underline">{t}</Link>)}
                  <span>{n.publisher}</span><span aria-hidden>·</span><time dateTime={n.publishedAt}>{when(n.publishedAt)}</time>
                </div>
                <div className="mt-1"><Title n={n} /></div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={Newspaper} title="No related headlines right now" description="Feeds refresh every 5 minutes. The dashboard's Top news covers the broad market." action={<Link href="/dashboard" className="text-xs text-info hover:underline">Open dashboard</Link>} />
        )}
        <SourceLine>{sources ? `Via ${sources}.` : 'Public publisher feeds.'} Headlines link to the original publisher.</SourceLine>
      </CardContent>
    </Card>
  );
}
