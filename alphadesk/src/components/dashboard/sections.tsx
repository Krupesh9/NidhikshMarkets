import 'server-only';
/** Async server sections for /dashboard. Each is wrapped in <Suspense> with a skeleton by the page. */
import Link from 'next/link';
import { BarChart3, Briefcase, CalendarClock, FlaskConical, Gauge, Landmark, Newspaper, Star, TrendingUp } from 'lucide-react';
import { getMarketData, type NewsItem, type Quote } from '@/lib/data';
import { getHeadlines } from '@/lib/news';
import { getCalendarEvents, type CalendarEvent } from '@/lib/calendar';
import { addDays, todayET } from '@/lib/calendar/dates';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Delta } from '@/components/ui/delta';
import { EmptyState } from '@/components/ui/empty-state';
import { MockBanner } from '@/components/shell/MockBanner';
import { fmt, cn } from '@/lib/utils';
import { CompanyLogo } from '@/components/ui/company-logo';
import { TrendLine } from '@/components/ui/trend-line';
import { getMarketTiles } from '@/lib/markets/global';

function SectionTitle({ icon: Icon, children, action }: { icon: typeof Star; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
      <CardTitle className="flex items-center gap-2 text-sm"><Icon className="h-4 w-4 text-muted" aria-hidden /> {children}</CardTitle>
      {action}
    </CardHeader>
  );
}

/** Global markets: real index levels, commodity ETF proxies and Treasury yields, each with a 1-month line. */
export async function MarketPulse() {
  const { tiles, etfProvider, asOf } = await getMarketTiles();
  return (
    <section aria-labelledby="gm-h" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="gm-h" className="eyebrow">Global markets</h2>
        <span className="text-[11px] text-muted">Indices via <a href="https://site.financialmodelingprep.com" target="_blank" rel="noopener noreferrer" className="hover:text-info hover:underline">FMP</a> / <a href="https://fred.stlouisfed.org" target="_blank" rel="noopener noreferrer" className="hover:text-info hover:underline">FRED</a> · ETFs via {etfProvider} · {new Date(asOf).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })} · click a tile for details</span>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {tiles.map((c) => (
          <Link key={c.slug} href={`/markets/${c.slug}`}
            className="group block rounded-xl border border-border bg-panel p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-info/40 hover:shadow-lg hover:shadow-black/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info">
            <div className="flex items-center justify-between gap-2 text-xs text-muted">
              <span className="truncate font-medium text-text" title={c.label}>{c.label}</span>
              <span className="shrink-0 font-mono text-[10px]">{c.code}</span>
            </div>
            <div className="mt-2 font-mono text-xl font-semibold tabular-nums">
              {c.value == null ? '—' : c.unit === 'pct-yield' ? `${c.value.toFixed(2)}%` : fmt.price(c.value)}
            </div>
            <div className="mt-1.5">
              {c.changePct == null ? <span className="text-[11px] text-muted">no quote</span>
                : c.unit === 'pct-yield'
                  ? <Delta value={c.change ?? 0} suffix=" bp" dp={0} badge className="min-w-0 text-[11px]" />
                  : <Delta value={c.changePct} amount={c.change} badge className="min-w-0 text-[11px]" />}
            </div>
            <TrendLine values={c.spark} width={200} height={34} className="mt-3 w-full" label={`${c.label} one-month trend`} />
            <div className="mt-1.5 truncate text-[10px] text-muted" title={`${c.note} · ${c.sourceName}`}>{c.note} · {c.sourceName}</div>
          </Link>
        ))}
      </div>
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
  const md = getMarketData();
  const q = await md.getQuotes(symbols);
  const rows = [...q.data].sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct)).slice(0, 8);
  const hist = await Promise.all(rows.map((x) => md.getHistory(x.ticker, '1M').catch(() => null)));
  return (
    <Card>
      <SectionTitle icon={Star} action={<Link href="/watchlist" className="text-xs text-info hover:underline">Open watchlist →</Link>}>Watchlist movers</SectionTitle>
      <CardContent className="space-y-2">
        <MockBanner isMock={q.meta.isMock} provider={q.meta.provider}><strong>Demo data.</strong> Some quotes are simulated.</MockBanner>
        <ul className="divide-y divide-border">
          {rows.map((x, i) => (
            <li key={x.ticker}>
              <Link href={`/watchlist/${x.ticker}`} className="flex items-center gap-3 py-2 text-sm hover:bg-panel-2/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info">
                <CompanyLogo ticker={x.ticker} size={28} />
                <span className="w-12 font-mono font-semibold text-info">{x.ticker}</span>
                <Sparkline closes={(hist[i]?.data ?? []).map((b) => b.close)} up={x.changePct >= 0} label={`${x.ticker} one-month price trend`} />
                <span className="ml-auto font-mono tabular-nums">{fmt.price(x.price)}</span>
                <Delta value={x.changePct} amount={x.change} badge className="text-xs" />
              </Link>
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-muted">Quotes via {q.meta.provider || 'market data'} · sorted by today&apos;s move · line = last month{rows.length < symbols.length ? ` · no quote for ${symbols.filter((s) => !q.data.some((r) => r.ticker === s)).join(', ')}` : ''}</p>
      </CardContent>
    </Card>
  );
}

/** Tiny inline SVG trend line (server-rendered, no client JS). */
function Sparkline({ closes, up, label }: { closes: number[]; up: boolean; label: string }) {
  const w = 96, h = 28;
  if (closes.length < 2) return <span className="h-7 w-24" aria-hidden />;
  const lo = Math.min(...closes), hi = Math.max(...closes), span = hi - lo || 1;
  const pts = closes.map((c, i) => `${((i / (closes.length - 1)) * w).toFixed(1)},${(h - 2 - ((c - lo) / span) * (h - 4)).toFixed(1)}`).join(' ');
  const trendUp = closes[closes.length - 1] >= closes[0];
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`${label}: ${trendUp ? 'up' : 'down'} over the month`} className="shrink-0">
      <polyline points={pts} fill="none" stroke={trendUp ? 'rgb(var(--up))' : 'rgb(var(--down))'} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" opacity={up === trendUp ? 1 : 0.85} />
    </svg>
  );
}

const CAT_ICON: Partial<Record<CalendarEvent['category'], typeof Star>> = { earnings: TrendingUp, inflation: Gauge, jobs: Briefcase, fed: Landmark, growth: BarChart3, market: CalendarClock };
const CAT_TONE: Partial<Record<CalendarEvent['category'], string>> = { earnings: 'text-info', inflation: 'text-warn', jobs: 'text-up', fed: 'text-accent' };

/** Next key dates: watchlist earnings + high-importance macro releases (CPI, PPI, jobs, FOMC…). */
export async function UpcomingCatalysts({ symbols }: { symbols: string[] }) {
  const today = todayET();
  const { events } = await getCalendarEvents({ from: today, to: addDays(today, 45), watchlist: symbols });
  const items = events
    .filter((e) => !e.recurring && e.category !== 'market' && (e.category === 'earnings' ? e.inWatchlist : e.importance === 'high'))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 9);
  return (
    <Card>
      <SectionTitle icon={CalendarClock} action={<Link href="/calendar" className="text-xs text-info hover:underline">Full calendar →</Link>}>Upcoming catalysts</SectionTitle>
      <CardContent>
        {items.length ? (
          <ul className="divide-y divide-border">
            {items.map((c) => {
              const Icon = CAT_ICON[c.category] ?? CalendarClock;
              const days = Math.round((Date.parse(c.date) - Date.parse(today)) / 86_400_000);
              return (
                <li key={c.id} className="flex items-center gap-3 py-2.5 text-sm">
                  {c.ticker ? <CompanyLogo ticker={c.ticker} size={24} /> : <span className="inline-flex h-6 w-6 items-center justify-center rounded-lg bg-panel-2"><Icon className={cn('h-3.5 w-3.5', CAT_TONE[c.category] ?? 'text-muted')} aria-hidden /></span>}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium" title={c.detail ?? c.title}>{c.title}</span>
                    <span className="block text-[11px] text-muted">
                      {c.time ? `${c.time} · ` : ''}{c.estimated ? 'estimated · ' : ''}
                      {c.source.url ? <a href={c.source.url} target="_blank" rel="noopener noreferrer" className="hover:text-info hover:underline">{c.source.name}</a> : c.source.name}
                    </span>
                  </span>
                  <span className="whitespace-nowrap text-right font-mono text-xs tabular-nums text-muted">
                    {new Date(c.date + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}
                    <span className="block text-[10px]">{days <= 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days}d`}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState icon={CalendarClock} title="No key dates in the next 45 days" description="Earnings for your watchlist and major economic releases will show here." />
        )}
      </CardContent>
    </Card>
  );
}

/** Top news, watchlist names first: a lead story plus a two-column list. */
export async function TopNews({ symbols }: { symbols: string[] }) {
  // Watchlist headlines first (latest 5), then the broad market tape; all from public publisher feeds + Massive.
  const [mine, all] = await Promise.all([getHeadlines({ tickers: symbols, onlyMatching: true, limit: 5 }), getHeadlines({ tickers: symbols, limit: 40 })]);
  const seen = new Set<string>();
  const merged: NewsItem[] = [...mine, ...all].filter((n) => (seen.has(n.id) ? false : (seen.add(n.id), true))).slice(0, 15);
  const publishers = Array.from(new Set(merged.map((n) => n.publisher))).slice(0, 5);
  const wlSet = new Set(symbols);
  const [lead, ...rest] = merged;
  const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const Meta = ({ n }: { n: NewsItem }) => (
    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
      {n.tickers.slice(0, 3).map((t) => <Link key={t} href={`/company/${t}`} className={cn('font-mono font-semibold hover:underline', wlSet.has(t) ? 'text-accent' : 'text-info')}>{t}</Link>)}
      <span>{n.publisher}</span><span aria-hidden>·</span>
      <time dateTime={n.publishedAt}>{when(n.publishedAt)}</time>
      {n.sentiment && n.sentiment !== 'neutral' && <Badge variant={n.sentiment === 'positive' ? 'up' : 'down'}>{n.sentiment}</Badge>}
    </div>
  );
  const Title = ({ n, className }: { n: NewsItem; className?: string }) =>
    /^https?:\/\//i.test(n.url)
      ? <a href={n.url} target="_blank" rel="noopener noreferrer" className={cn('font-medium leading-snug hover:text-info', className)}>{n.title}</a>
      : <span className={cn('font-medium leading-snug', className)}>{n.title}</span>;
  return (
    <Card>
      <SectionTitle icon={Newspaper} action={<span className="text-[11px] text-muted">watchlist first · {publishers.join(', ')}</span>}>Top news</SectionTitle>
      <CardContent className="space-y-3">
        {lead ? (
          <>
            <article className="rounded-lg border border-border bg-panel-2/60 p-4">
              <Meta n={lead} />
              <h3 className="mt-1.5 text-lg"><Title n={lead} className="text-lg font-semibold" /></h3>
              {lead.summary && <p className="mt-1.5 line-clamp-3 text-sm text-muted">{lead.summary}</p>}
            </article>
            <ul className="grid gap-x-6 gap-y-3 md:grid-cols-2">
              {rest.map((n) => (
                <li key={n.id} className="border-t border-border pt-3 text-sm">
                  <Meta n={n} />
                  <div className="mt-0.5"><Title n={n} /></div>
                </li>
              ))}
            </ul>
            <p className="border-t border-border pt-3 text-[11px] text-muted">
              Headlines from {Array.from(new Set(merged.map((n) => n.publisher))).join(', ')} via publisher RSS, Google News and Massive · each headline opens the original article · refreshed every 5 min.
            </p>
          </>
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
