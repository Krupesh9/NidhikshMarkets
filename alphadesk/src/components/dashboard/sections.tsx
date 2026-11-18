import 'server-only';
/** Async server sections for /dashboard. Each is wrapped in <Suspense> with a skeleton by the page. */
import Link from 'next/link';
import { Briefcase, CalendarClock, FlaskConical, Newspaper, Pill, Share2, Star, TrendingUp } from 'lucide-react';
import { getMarketData, type Catalyst, type NewsItem, type Quote, type SourceRef } from '@/lib/data';
import { portfolioRepo, type Scope } from '@/lib/repos';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Delta } from '@/components/ui/delta';
import { EmptyState } from '@/components/ui/empty-state';
import { SourceChips } from '@/components/ui/source-chip';
import { MockBanner } from '@/components/shell/MockBanner';
import { ShareCard } from '@/components/sharing/SharedFeed';
import { listShareCards } from '@/components/sharing/server';
import { fmt, cn } from '@/lib/utils';
import { summarizePortfolio } from './portfolio-math';

export const INDEX_PROXIES = [
  { t: 'SPY', label: 'S&P 500' },
  { t: 'QQQ', label: 'Nasdaq 100' },
  { t: 'DIA', label: 'Dow 30' },
  { t: 'IWM', label: 'Russell 2000' },
] as const;

function SectionTitle({ icon: Icon, children, action }: { icon: typeof Star; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
      <CardTitle className="flex items-center gap-2 text-sm"><Icon className="h-4 w-4 text-muted" aria-hidden /> {children}</CardTitle>
      {action}
    </CardHeader>
  );
}

const uniqSources = (s: SourceRef[], n = 3) => {
  const seen = new Set<string>();
  return s.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true))).slice(0, n);
};

/** Market pulse strip: index proxy ETFs. */
export async function MarketPulse() {
  const q = await getMarketData().getQuotes(INDEX_PROXIES.map((x) => x.t));
  const by = Object.fromEntries(q.data.map((x) => [x.ticker, x]));
  return (
    <section aria-label="Market pulse" className="space-y-2">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {INDEX_PROXIES.map(({ t, label }) => {
          const x: Quote | undefined = by[t];
          return (
            <Link key={t} href={`/company/${t}`} className="rounded-lg border border-border bg-panel p-3 transition-colors hover:border-info/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info">
              <div className="flex items-baseline justify-between text-[11px] text-muted"><span className="font-mono font-semibold text-text">{t}</span><span>{label}</span></div>
              <div className="mt-1 flex items-baseline justify-between gap-2">
                <span className="font-mono text-lg font-semibold tabular-nums">{x ? fmt.price(x.price) : '—'}</span>
                {x ? <Delta value={x.changePct} className="text-xs" /> : <span className="text-[11px] text-muted">no quote</span>}
              </div>
              {x && <div className="mt-0.5 font-mono text-[11px] tabular-nums text-muted">{x.change > 0 ? '+' : ''}{fmt.price(x.change)} · vol {fmt.compact(x.volume)}</div>}
            </Link>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted">
        <span>Index proxies via ETFs · as of {new Date(q.meta.asOf).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })} · {q.meta.provider ?? 'market data'}</span>
        <SourceChips sources={uniqSources(q.meta.source, 2)} />
      </div>
      <MockBanner isMock={q.meta.isMock} provider={q.meta.provider} />
    </section>
  );
}

/** Watchlist movers sorted by absolute % change. */
export async function WatchlistMovers({ symbols }: { symbols: string[] }) {
  if (!symbols.length) {
    return (
      <Card>
        <SectionTitle icon={Star}>Watchlist movers</SectionTitle>
        <CardContent><EmptyState icon={Star} title="Your watchlist is empty" description="Add tickers from any company page (☆) or the ⌘K search to see movers here." action={<Button asChild size="sm" variant="secondary"><Link href="/screener">Find ideas in the screener</Link></Button>} /></CardContent>
      </Card>
    );
  }
  const q = await getMarketData().getQuotes(symbols);
  const rows = [...q.data].sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));
  return (
    <Card>
      <SectionTitle icon={Star} action={<span className="text-[11px] text-muted">{symbols.length} names</span>}>Watchlist movers</SectionTitle>
      <CardContent className="space-y-2">
        <MockBanner isMock={q.meta.isMock} provider={q.meta.provider}><strong>Demo data.</strong> Some quotes are simulated.</MockBanner>
        <ul className="divide-y divide-border">
          {rows.slice(0, 8).map((x) => (
            <li key={x.ticker}>
              <Link href={`/company/${x.ticker}`} className="flex items-center justify-between gap-3 py-1.5 text-sm hover:bg-panel-2/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info">
                <span className="font-mono font-semibold text-info">{x.ticker}</span>
                <span className="ml-auto font-mono tabular-nums">{fmt.price(x.price)}</span>
                <Delta value={x.changePct} className="w-20 justify-end text-xs" />
              </Link>
            </li>
          ))}
        </ul>
        {rows.length < symbols.length && <p className="text-[11px] text-muted">No quote for {symbols.filter((s) => !rows.some((r) => r.ticker === s)).join(', ')}.</p>}
      </CardContent>
    </Card>
  );
}

/** Portfolio summary cards linking to /portfolios/[id]. */
export async function PortfolioSummaries({ scope }: { scope: Scope }) {
  const ps = await portfolioRepo.list(scope);
  if (!ps.length) {
    return (
      <Card>
        <SectionTitle icon={Briefcase}>Portfolios</SectionTitle>
        <CardContent><EmptyState icon={Briefcase} title="No portfolios yet" description="Import positions from CSV or build one by hand to track exposure, P&L and risk." action={<Button asChild size="sm"><Link href="/portfolios?import=1">Import portfolio</Link></Button>} /></CardContent>
      </Card>
    );
  }
  const tickers = Array.from(new Set(ps.flatMap((p) => p.positions.map((x) => x.ticker))));
  const q = tickers.length ? await getMarketData().getQuotes(tickers) : null;
  const qm = Object.fromEntries((q?.data ?? []).map((x) => [x.ticker, x]));
  return (
    <section aria-label="Portfolios" className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><Briefcase className="h-4 w-4 text-muted" aria-hidden /> Portfolios</h2>
        <Link href="/portfolios" className="text-xs text-info hover:underline">All portfolios →</Link>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {ps.slice(0, 6).map((p) => {
          const s = summarizePortfolio(p.positions, qm);
          const top = s.rows.slice(0, 3);
          return (
            <Link key={p.id} href={`/portfolios/${p.id}`} className="group rounded-lg border border-border bg-panel p-3 transition-colors hover:border-info/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-semibold group-hover:text-info">{p.name}</span>
                <Badge variant="outline">{s.positions} pos · vs {p.benchmark}</Badge>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] text-muted">
                <div><div>Net</div><div className="font-mono text-sm font-semibold tabular-nums text-text">{fmt.money(s.net)}</div></div>
                <div><div>Gross</div><div className="font-mono text-sm tabular-nums text-text">{fmt.money(s.gross)}</div></div>
                <div>
                  <div>Day P&amp;L</div>
                  <div className={cn('font-mono text-sm tabular-nums', s.dayPnl > 0 ? 'text-up' : s.dayPnl < 0 ? 'text-down' : 'text-text')}>{s.dayPnl > 0 ? '+' : ''}{fmt.money(s.dayPnl)}</div>
                </div>
              </div>
              <div className="mt-1 flex items-center gap-1 text-[11px] text-muted">
                <span>{s.dayPnlPct != null ? fmt.pct(s.dayPnlPct) : '—'} today · Unrealized</span>
                <span className={cn('font-mono', s.unrealized >= 0 ? 'text-up' : 'text-down')}>{fmt.money(s.unrealized)}</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">{top.map((r) => <Badge key={r.ticker} variant={r.quantity < 0 ? 'down' : 'default'} className="font-mono">{r.ticker} {(r.weight * 100).toFixed(0)}%</Badge>)}</div>
            </Link>
          );
        })}
      </div>
      {q?.meta.isMock && <p className="text-[11px] text-warn">Some position prices are simulated (demo data).</p>}
    </section>
  );
}

/** Recent shared research from the org feed. */
export async function RecentShared({ scope }: { scope: Scope }) {
  const items = (await listShareCards(scope, 5)).slice(0, 5);
  return (
    <Card>
      <SectionTitle icon={Share2} action={<Link href="/shared" className="text-xs text-info hover:underline">Team feed →</Link>}>Recent shared research</SectionTitle>
      <CardContent className="space-y-2">
        {items.length ? items.map((c) => <ShareCard key={c.id} c={c} compact />) : (
          <EmptyState icon={Share2} title="Nothing shared yet" description="Ask the AI a question and share the cited answer with your team." action={<Button asChild size="sm" variant="secondary"><Link href="/research">Open Research</Link></Button>} />
        )}
      </CardContent>
    </Card>
  );
}

const CAT_ICON: Partial<Record<Catalyst['type'], typeof Star>> = { earnings: TrendingUp, fda: Pill };

/** Upcoming catalysts (next 60 days) for watchlist names; earnings + FDA first-class. */
export async function UpcomingCatalysts({ symbols }: { symbols: string[] }) {
  const md = getMarketData();
  const list = symbols.slice(0, 25);
  const res = await Promise.all(list.map((t) => md.getCatalysts(t).catch(() => null)));
  const today = new Date().toISOString().slice(0, 10);
  const horizon = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);
  const items = res.flatMap((r) => r?.data ?? []).filter((c) => c.date >= today && c.date <= horizon).sort((a, b) => a.date.localeCompare(b.date));
  const isMock = res.some((r) => r?.meta.isMock);
  return (
    <Card>
      <SectionTitle icon={CalendarClock} action={<span className="text-[11px] text-muted">next 60 days · watchlist</span>}>Upcoming catalysts</SectionTitle>
      <CardContent className="space-y-2">
        {isMock && <MockBanner><strong>Simulated calendar.</strong> Catalyst dates are demo data — confirm against company IR.</MockBanner>}
        {items.length ? (
          <ul className="divide-y divide-border">
            {items.slice(0, 10).map((c) => {
              const Icon = CAT_ICON[c.type] ?? CalendarClock;
              const days = Math.round((Date.parse(c.date) - Date.parse(today)) / 86_400_000);
              return (
                <li key={c.id} className="flex items-center gap-3 py-1.5 text-sm">
                  <Icon className={cn('h-4 w-4 shrink-0', c.type === 'fda' ? 'text-warn' : c.type === 'earnings' ? 'text-info' : 'text-muted')} aria-hidden />
                  {c.ticker && <Link href={`/company/${c.ticker}`} className="font-mono font-semibold text-info hover:underline">{c.ticker}</Link>}
                  <span className="min-w-0 flex-1 truncate" title={c.description ?? c.title}>{c.title}</span>
                  {!c.confirmed && <Badge variant="outline">est.</Badge>}
                  <span className="whitespace-nowrap font-mono text-xs tabular-nums text-muted">{new Date(c.date + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })} · {days === 0 ? 'today' : `${days}d`}</span>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState icon={CalendarClock} title={symbols.length ? 'No catalysts in the next 60 days' : 'Add names to your watchlist'} description={symbols.length ? 'Earnings, FDA dates and investor days for your watchlist will show here.' : 'Catalysts are tracked for watchlist names.'} />
        )}
      </CardContent>
    </Card>
  );
}

/** Top news, watchlist names first. */
export async function TopNews({ symbols }: { symbols: string[] }) {
  const md = getMarketData();
  const [general, ...wl] = await Promise.all([md.getNews().catch(() => null), ...symbols.slice(0, 6).map((t) => md.getNews(t).catch(() => null))]);
  const seen = new Set<string>();
  const merged: NewsItem[] = [...wl.flatMap((r) => r?.data.slice(0, 2) ?? []), ...(general?.data ?? [])]
    .filter((n) => (seen.has(n.id) ? false : (seen.add(n.id), true)))
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, 8);
  const isMock = [general, ...wl].some((r) => r?.meta.isMock);
  const wlSet = new Set(symbols);
  return (
    <Card>
      <SectionTitle icon={Newspaper}>Top news</SectionTitle>
      <CardContent className="space-y-2">
        {isMock && <MockBanner><strong>Simulated headlines</strong> mixed in for demo names — links may point to placeholder pages.</MockBanner>}
        {merged.length ? (
          <ul className="space-y-2.5">
            {merged.map((n) => {
              const safe = /^https?:\/\//i.test(n.url);
              return (
                <li key={n.id} className="text-sm">
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                    {n.tickers.slice(0, 3).map((t) => <Link key={t} href={`/company/${t}`} className={cn('font-mono font-semibold hover:underline', wlSet.has(t) ? 'text-accent' : 'text-info')}>{t}</Link>)}
                    <span>{n.publisher}</span><span aria-hidden>·</span>
                    <time dateTime={n.publishedAt}>{new Date(n.publishedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</time>
                    {n.sentiment && n.sentiment !== 'neutral' && <Badge variant={n.sentiment === 'positive' ? 'up' : 'down'}>{n.sentiment}</Badge>}
                  </div>
                  {safe ? <a href={n.url} target="_blank" rel="noopener noreferrer" className="font-medium leading-snug hover:text-info">{n.title}</a> : <span className="font-medium">{n.title}</span>}
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState icon={Newspaper} title="No news right now" description="Headlines for your watchlist and the broad market will appear here." />
        )}
      </CardContent>
    </Card>
  );
}

export function ResearchDisclaimer() {
  return <p className="flex items-center gap-1.5 text-[11px] text-muted"><FlaskConical className="h-3 w-3" aria-hidden /> Research only — not investment advice.</p>;
}
