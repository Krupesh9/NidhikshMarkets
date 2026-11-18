'use client';
import * as React from 'react';
import { CalendarDays, FileText, Newspaper } from 'lucide-react';
import type { Catalyst, Filing, NewsItem, SourceRef } from '@/lib/data/types';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { cn, fmt } from '@/lib/utils';
import { daysUntil, upcomingCatalysts } from './lib/helpers';
import { useOpenSource } from './MetricButton';

const SENT: Record<NonNullable<NewsItem['sentiment']>, string> = { positive: 'bg-up', neutral: 'bg-muted', negative: 'bg-down' };
const CAT_LABEL: Record<Catalyst['type'], string> = { earnings: 'Earnings', fda: 'FDA', investor_day: 'Investor day', product: 'Product', dividend: 'Dividend', conference: 'Conference', macro: 'Macro' };
const FORM_FILTERS = ['All', '10-K', '10-Q', '8-K'] as const;

const isMockId = (id: string) => id.startsWith('mock:');

function newsSource(n: NewsItem): SourceRef {
  return { id: n.id, name: `${n.publisher}: ${n.title}`, url: n.url, kind: isMockId(n.id) ? 'mock' : 'news', excerpt: n.summary ?? n.title, locator: fmt.date(n.publishedAt) };
}
function filingSource(f: Filing): SourceRef {
  const ex = f.excerpts?.[0];
  return { id: f.id, name: `${f.ticker} ${f.form} filed ${f.filedAt}`, url: f.url, kind: isMockId(f.id) ? 'mock' : 'filing', excerpt: ex?.text ?? `${f.form}: ${f.title}.${f.periodOfReport ? ` Period of report ${f.periodOfReport}.` : ''}${f.accession ? ` Accession ${f.accession}.` : ''}`, locator: ex?.locator };
}

export function NewsFilingsPanel({ ticker, news, filings, catalysts, catalystsMock }: { ticker: string; news: NewsItem[]; filings: Filing[]; catalysts: Catalyst[]; catalystsMock: boolean }) {
  const open = useOpenSource();
  const [form, setForm] = React.useState<(typeof FORM_FILTERS)[number]>('All');
  const shownFilings = filings.filter((f) => (form === 'All' ? ['10-K', '10-Q', '8-K', '10-K/A', '10-Q/A', '20-F', '6-K'].includes(f.form) : f.form === form)).slice(0, 25);
  const upcoming = upcomingCatalysts(catalysts).slice(0, 8);
  const sortedNews = [...news].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, 15);

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <section aria-labelledby="news-h" className="lg:col-span-1">
        <h3 id="news-h" className="mb-2 text-xs font-semibold">News timeline</h3>
        {sortedNews.length === 0 ? (
          <EmptyState icon={Newspaper} title="No recent news" description={`No headlines found for ${ticker}. Ask the AI to search filings and transcripts instead.`} />
        ) : (
          <ol className="relative max-h-[520px] space-y-3 overflow-y-auto border-l border-border pl-4 pr-1 scrollbar-thin">
            {sortedNews.map((n) => (
              <li key={n.id} className="relative">
                <span className={cn('absolute -left-[21px] top-1.5 h-2 w-2 rounded-full ring-2 ring-panel', SENT[n.sentiment ?? 'neutral'])} aria-hidden />
                <div className="text-[10px] text-muted"><time dateTime={n.publishedAt}>{fmt.date(n.publishedAt)}</time> · {n.publisher}{n.sentiment && n.sentiment !== 'neutral' ? ` · ${n.sentiment}` : ''}</div>
                <button type="button" onClick={() => open(newsSource(n), { title: 'News' })} className="text-left text-xs font-medium leading-snug text-info hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info">
                  {n.title}
                </button>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section aria-labelledby="filings-h">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 id="filings-h" className="text-xs font-semibold">SEC filings</h3>
          <div role="group" aria-label="Filter filings by form" className="inline-flex rounded-md border border-border bg-panel-2 p-0.5">
            {FORM_FILTERS.map((f) => (
              <button key={f} type="button" onClick={() => setForm(f)} aria-pressed={form === f}
                className={cn('rounded px-1.5 py-0.5 font-mono text-[10px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info', form === f ? 'bg-accent text-accent-foreground' : 'text-muted hover:text-text')}>{f}</button>
            ))}
          </div>
        </div>
        {shownFilings.length === 0 ? (
          <EmptyState icon={FileText} title={form === 'All' ? 'No filings found' : `No ${form} filings`} description={form === 'All' ? `EDGAR returned no periodic filings for ${ticker} (non-US issuers file 20-F/6-K).` : 'Try a different form filter.'} />
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {shownFilings.map((f) => (
              <li key={f.id} className="flex items-start gap-2 px-2.5 py-2">
                <Badge variant={f.form.startsWith('10-K') ? 'accent' : f.form.startsWith('10-Q') ? 'info' : 'default'} className="mt-0.5 w-11 justify-center font-mono">{f.form}</Badge>
                <div className="min-w-0 flex-1">
                  <button type="button" onClick={() => open(filingSource(f), { title: 'Filing' })} className="line-clamp-2 text-left text-xs text-info hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info">{f.title}</button>
                  <div className="font-mono text-[10px] tabular-nums text-muted">Filed {f.filedAt}{f.periodOfReport ? ` · period ${f.periodOfReport}` : ''}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="cat-h">
        <h3 id="cat-h" className="mb-2 text-xs font-semibold">Upcoming catalysts</h3>
        {upcoming.length === 0 ? (
          <EmptyState icon={CalendarDays} title="No scheduled catalysts" description="No upcoming earnings, FDA dates or investor days on file. Check the 8-K feed for newly announced events." />
        ) : (
          <ul className="space-y-2">
            {upcoming.map((c) => {
              const d = daysUntil(c.date);
              const src: SourceRef = { id: c.id, name: `${c.title}${catalystsMock ? ' (simulated)' : ''}`, kind: catalystsMock || isMockId(c.id) ? 'mock' : 'news', excerpt: `${c.title} — ${fmt.date(c.date)} (${c.confirmed ? 'confirmed' : 'estimated'}). ${c.description ?? ''}`.trim(), locator: CAT_LABEL[c.type] };
              return (
                <li key={c.id}>
                  <button type="button" onClick={() => open(src, { title: 'Catalyst' })} className="flex w-full items-center gap-3 rounded-md border border-border bg-panel-2/40 px-2.5 py-2 text-left hover:border-info/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info">
                    <div className="w-12 shrink-0 text-center">
                      <div className="text-[10px] uppercase text-muted">{new Date(c.date).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })}</div>
                      <div className="font-mono text-lg font-semibold leading-none tabular-nums">{c.date.slice(8, 10)}</div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium">{c.title}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-muted">
                        <Badge variant={c.type === 'earnings' ? 'accent' : c.type === 'fda' ? 'warn' : 'default'} className="text-[10px]">{CAT_LABEL[c.type]}</Badge>
                        <span>{c.confirmed ? 'Confirmed' : 'Estimated'}</span>
                      </div>
                    </div>
                    <span className="shrink-0 font-mono text-xs tabular-nums text-muted">{d === 0 ? 'today' : `in ${d}d`}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
