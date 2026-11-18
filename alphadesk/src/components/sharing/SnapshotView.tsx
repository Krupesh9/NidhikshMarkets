'use client';
/** Read-only renderers for each share snapshot type. */
import * as React from 'react';
import Link from 'next/link';
import { Bot, Filter, Lock, User } from 'lucide-react';
import type { SourceRef } from '@/lib/data/types';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Delta } from '@/components/ui/delta';
import { SourceChip } from '@/components/ui/source-chip';
import { Sparkline } from '@/components/ui/sparkline';
import { fmt, cn } from '@/lib/utils';
import { Markdown } from './Markdown';
import type { BasketSnapshot, CompanySnapshot, HoldingRow, NoteSnapshot, PortfolioSnapshot, ScreenSnapshot, ShareItemType, ThreadSnapshot } from './snapshot';

/** Shown in place of premium share content for Free / signed-out viewers (content is redacted server-side). */
function LockedShare({ what }: { what: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
        <span className="flex h-10 w-10 items-center justify-center rounded-full border border-accent/40 bg-accent/15 text-accent"><Lock className="h-4 w-4" aria-hidden /></span>
        <h2 className="text-base font-semibold">{what} is a Pro feature</h2>
        <p className="max-w-sm text-xs text-muted">This shared item contains premium research. Upgrade to Pro ($100/mo) to view it.</p>
        <Link href="/settings#plan" className="mt-1 inline-flex h-9 items-center gap-2 rounded-md bg-accent px-4 text-sm font-semibold text-accent-foreground hover:bg-accent/90">Unlock with Pro</Link>
      </CardContent>
    </Card>
  );
}

export function SnapshotView({ itemType, snapshot }: { itemType: ShareItemType; snapshot: Record<string, unknown> }) {
  const locked = Array.isArray(snapshot.__locked) ? (snapshot.__locked as string[]) : [];
  if (locked.includes('ai')) return <LockedShare what="AI research" />;
  if (itemType === 'company' && locked.length) {
    return (
      <div className="space-y-4">
        <CompanyView s={snapshot as unknown as CompanySnapshot} />
        <LockedShare what="Financial statements and analyst research" />
      </div>
    );
  }
  switch (itemType) {
    case 'note': return <NoteView s={snapshot as unknown as NoteSnapshot} />;
    case 'thread': return <ThreadView s={snapshot as unknown as ThreadSnapshot} />;
    case 'screen': return <ScreenView s={snapshot as unknown as ScreenSnapshot} />;
    case 'portfolio': return <HoldingsView kind="portfolio" s={snapshot as unknown as PortfolioSnapshot} />;
    case 'basket': return <HoldingsView kind="basket" s={snapshot as unknown as BasketSnapshot} />;
    case 'company': return <CompanyView s={snapshot as unknown as CompanySnapshot} />;
    default: return <p className="text-sm text-muted">Unsupported item type.</p>;
  }
}

function Sources({ sources }: { sources?: SourceRef[] }) {
  if (!sources?.length) return null;
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm">Sources ({sources.length})</CardTitle></CardHeader>
      <CardContent>
        <ol className="space-y-1.5 text-xs">
          {sources.map((s, i) => (
            <li key={s.id + i} className="flex items-start gap-2">
              <SourceChip source={s} index={i + 1} label={s.kind} />
              <span className="min-w-0 text-muted">{s.name}{s.locator ? ` · ${s.locator}` : ''}</span>
            </li>
          ))}
        </ol>
        <p className="mt-2 text-[11px] text-muted">Click a citation to open the excerpt in the side panel.</p>
      </CardContent>
    </Card>
  );
}

function NoteView({ s }: { s: NoteSnapshot }) {
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-4 pt-4">
          <div>
            <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">Question</div>
            <p className="text-sm font-medium">{s.question || '—'}</p>
          </div>
          <div>
            <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">Answer</div>
            <Markdown text={s.answerMarkdown ?? ''} sources={s.sources ?? []} />
          </div>
        </CardContent>
      </Card>
      <Sources sources={s.sources} />
    </div>
  );
}

function ThreadView({ s }: { s: ThreadSnapshot }) {
  const all = (s.messages ?? []).flatMap((m) => m.citations ?? []);
  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {(s.messages ?? []).map((m, i) => {
          const isUser = m.role === 'user';
          return (
            <div key={i} className={cn('rounded-lg border p-3', isUser ? 'border-border bg-panel-2' : 'border-border bg-panel')}>
              <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted">
                {isUser ? <User className="h-3.5 w-3.5" aria-hidden /> : <Bot className="h-3.5 w-3.5" aria-hidden />} {isUser ? 'Question' : 'Assistant'}
              </div>
              {isUser ? <p className="text-sm">{m.content}</p> : <Markdown text={m.content} sources={m.citations ?? []} />}
            </div>
          );
        })}
        {!s.messages?.length && <p className="text-sm text-muted">This thread had no messages when it was shared.</p>}
      </div>
      <Sources sources={dedupe(all)} />
    </div>
  );
}

function dedupe(src: SourceRef[]): SourceRef[] {
  const seen = new Set<string>();
  return src.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)));
}

/** Human-readable filter chips from the screener filter object ({field: {min,max}|{any:[]}|value}). */
export function describeFilters(filters: Record<string, unknown>): string[] {
  return Object.entries(filters ?? {}).map(([k, v]) => {
    const name = k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const o = v as Record<string, unknown>;
      const parts: string[] = [];
      if (o.min != null) parts.push(`≥ ${o.min}`);
      if (o.max != null) parts.push(`≤ ${o.max}`);
      if (Array.isArray(o.any)) parts.push(`any of ${o.any.join(', ')}`);
      if (Array.isArray(o.in)) parts.push(`in ${o.in.join(', ')}`);
      if (parts.length) return `${name} ${parts.join(' and ')}`;
      return `${name}: ${JSON.stringify(v)}`;
    }
    if (Array.isArray(v)) return `${name}: ${v.join(', ')}`;
    return `${name}: ${String(v)}`;
  });
}

const PCT_COLS = /pct|growth|revision|yield|margin|shortinterest/i;
function Cell({ col, v }: { col: string; v: unknown }) {
  if (v == null) return <span className="text-muted">—</span>;
  if (Array.isArray(v) && v.every((x) => typeof x === 'number')) return <Sparkline data={v as number[]} width={64} height={18} color={(v as number[])[v.length - 1] >= (v as number[])[0] ? 'up' : 'down'} />;
  if (Array.isArray(v)) return <span className="text-xs">{v.join(', ')}</span>;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return <span className="text-xs text-muted">{typeof o.headline === 'string' ? o.headline : JSON.stringify(o).slice(0, 80)}</span>;
  }
  if (typeof v === 'number') {
    if (/changePct/i.test(col)) return <Delta value={v} className="text-xs" />;
    if (/marketCap|insiderBuying|value/i.test(col)) return <>{fmt.money(v)}</>;
    if (PCT_COLS.test(col)) return <>{fmt.pct(v, 1)}</>;
    if (/^(pe|evEbitda|forwardPe|priceToSales)$/i.test(col)) return <>{fmt.multiple(v)}</>;
    return <>{fmt.num(v, Math.abs(v) < 100 ? 2 : 0)}</>;
  }
  if (col === 'ticker') return <Link href={`/company/${encodeURIComponent(String(v))}`} className="font-mono font-semibold text-info hover:underline">{String(v)}</Link>;
  return <>{String(v)}</>;
}

function ScreenView({ s }: { s: ScreenSnapshot }) {
  const rows = s.rows ?? [];
  const cols = s.columns?.length ? s.columns : rows[0] ? Object.keys(rows[0]).slice(0, 10) : [];
  const chips = describeFilters(s.filters ?? {});
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Filter className="h-4 w-4 text-info" aria-hidden /> Filters applied</CardTitle></CardHeader>
        <CardContent>
          {chips.length ? <div className="flex flex-wrap gap-1.5">{chips.map((c) => <Badge key={c} variant="info">{c}</Badge>)}</div> : <p className="text-xs text-muted">No filters (full universe).</p>}
          {s.sort?.length ? <p className="mt-2 text-xs text-muted">Sorted by {s.sort.map((x) => `${x.id} ${x.desc ? '↓' : '↑'}`).join(', ')}</p> : null}
          {s.description ? <p className="mt-2 text-sm text-muted">{s.description}</p> : null}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Results at capture <span className="font-normal text-muted">({s.resultCount ?? rows.length} matched{rows.length < (s.resultCount ?? 0) ? `, first ${rows.length} shown` : ''})</span></CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {rows.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-panel-2 text-muted">
                  <tr>{cols.map((c) => <th key={c} scope="col" className="whitespace-nowrap px-3 py-2 text-left font-medium">{c}</th>)}</tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className="border-t border-border hover:bg-panel-2/60">
                      {cols.map((c) => <td key={c} className="whitespace-nowrap px-3 py-1.5 font-mono tabular-nums"><Cell col={c} v={r[c]} /></td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="p-4 text-sm text-muted">The author shared the screen definition only — no result rows were captured. Open it in the Screener to run it live.</p>
          )}
        </CardContent>
      </Card>
      <Sources sources={s.sources} />
    </div>
  );
}

function fmtMetric(k: string, v: number | string | null): string {
  if (v == null) return '—';
  if (typeof v === 'string') return v;
  if (/%|pct/i.test(k)) return fmt.pct(v, 2);
  if (/weight/i.test(k)) return v <= 1.5 ? `${(v * 100).toFixed(1)}%` : `${v.toFixed(1)}%`;
  if (/exposure|p&l|long|short|value|nav/i.test(k)) return fmt.money(v);
  return fmt.num(v, Number.isInteger(v) ? 0 : 2);
}

function HoldingsView({ kind, s }: { kind: 'portfolio' | 'basket'; s: PortfolioSnapshot | BasketSnapshot }) {
  const rows: HoldingRow[] = kind === 'portfolio' ? (s as PortfolioSnapshot).positions ?? [] : (s as BasketSnapshot).holdings ?? [];
  const metrics = Object.entries(s.metrics ?? {});
  const thesis = kind === 'basket' ? (s as BasketSnapshot).thesis : null;
  const hasQty = rows.some((r) => r.quantity != null);
  const hasMv = rows.some((r) => r.marketValue != null);
  const hasTarget = rows.some((r) => r.targetWeight != null);
  return (
    <div className="space-y-4">
      {thesis ? (
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Thesis</CardTitle></CardHeader><CardContent><Markdown text={thesis} /></CardContent></Card>
      ) : null}
      {s.description ? <p className="text-sm text-muted">{s.description}</p> : null}
      {metrics.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {metrics.map(([k, v]) => (
            <div key={k} className="rounded-lg border border-border bg-panel p-3">
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted">{k}</div>
              <div className={cn('mt-1 font-mono text-base font-semibold tabular-nums', typeof v === 'number' && /p&l|move/i.test(k) && (v > 0 ? 'text-up' : v < 0 ? 'text-down' : ''))}>{fmtMetric(k, v)}</div>
            </div>
          ))}
        </div>
      )}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">{kind === 'portfolio' ? 'Positions' : 'Holdings'} at capture ({rows.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          {rows.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-panel-2 text-muted">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left font-medium">Ticker</th>
                    <th scope="col" className="px-3 py-2 text-left font-medium">Sector</th>
                    {hasQty && <th scope="col" className="px-3 py-2 text-right font-medium">Qty</th>}
                    {hasQty && <th scope="col" className="px-3 py-2 text-right font-medium">Cost</th>}
                    <th scope="col" className="px-3 py-2 text-right font-medium">Price</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Day</th>
                    {hasMv && <th scope="col" className="px-3 py-2 text-right font-medium">Mkt value</th>}
                    {hasMv && <th scope="col" className="px-3 py-2 text-right font-medium">Weight</th>}
                    {hasMv && <th scope="col" className="px-3 py-2 text-right font-medium">Unrl. P&amp;L</th>}
                    {hasTarget && <th scope="col" className="px-3 py-2 text-right font-medium">Target wt</th>}
                    {kind === 'basket' && <th scope="col" className="px-3 py-2 text-left font-medium">Rationale</th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.ticker} className="border-t border-border">
                      <td className="px-3 py-1.5"><Link href={`/company/${encodeURIComponent(r.ticker)}`} className="font-mono font-semibold text-info hover:underline">{r.ticker}</Link></td>
                      <td className="px-3 py-1.5 text-muted">{r.sector ?? '—'}</td>
                      {hasQty && <td className={cn('px-3 py-1.5 text-right font-mono tabular-nums', (r.quantity ?? 0) < 0 && 'text-down')}>{fmt.num(r.quantity)}</td>}
                      {hasQty && <td className="px-3 py-1.5 text-right font-mono tabular-nums">{fmt.price(r.costBasis)}</td>}
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums">{fmt.price(r.price)}</td>
                      <td className="px-3 py-1.5 text-right"><Delta value={r.changePct} className="justify-end text-xs" /></td>
                      {hasMv && <td className="px-3 py-1.5 text-right font-mono tabular-nums">{fmt.money(r.marketValue)}</td>}
                      {hasMv && <td className="px-3 py-1.5 text-right font-mono tabular-nums">{r.weight != null ? `${(r.weight * 100).toFixed(1)}%` : '—'}</td>}
                      {hasMv && <td className={cn('px-3 py-1.5 text-right font-mono tabular-nums', (r.pnl ?? 0) > 0 ? 'text-up' : (r.pnl ?? 0) < 0 ? 'text-down' : '')}>{fmt.money(r.pnl)}</td>}
                      {hasTarget && <td className="px-3 py-1.5 text-right font-mono tabular-nums">{r.targetWeight != null ? `${(r.targetWeight <= 1.5 ? r.targetWeight * 100 : r.targetWeight).toFixed(1)}%` : '—'}</td>}
                      {kind === 'basket' && <td className="max-w-xs truncate px-3 py-1.5 text-muted" title={r.rationale ?? ''}>{r.rationale ?? '—'}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="p-4 text-sm text-muted">No holdings were captured.</p>
          )}
        </CardContent>
      </Card>
      <Sources sources={s.sources} />
    </div>
  );
}

function MetricGrid({ metrics }: { metrics: Record<string, number | string | null> }) {
  const entries = Object.entries(metrics ?? {});
  if (!entries.length) return null;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {entries.map(([k, v]) => (
        <div key={k} className="rounded-lg border border-border bg-panel p-3">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted">{k}</div>
          <div className="mt-1 font-mono text-base font-semibold tabular-nums">{companyMetric(k, v)}</div>
        </div>
      ))}
    </div>
  );
}

function companyMetric(k: string, v: number | string | null): string {
  if (v == null) return '—';
  if (typeof v === 'string') return v;
  if (/p\/e|ebitda$/i.test(k) && !/^ev$/i.test(k)) return fmt.multiple(v);
  if (/%/.test(k)) return fmt.pct(v, 1, false);
  if (/cap|^ev$|revenue|income|cash flow/i.test(k)) return fmt.money(v);
  if (/high|low|eps|consensus/i.test(k)) return fmt.price(v);
  return fmt.num(v, Number.isInteger(v) ? 0 : 2);
}

function KvTable({ rows, caption }: { rows: Record<string, number | string | null>[]; caption: string }) {
  if (!rows.length) return null;
  const cols = Object.keys(rows[0]);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-panel-2 text-muted"><tr>{cols.map((c) => <th key={c} scope="col" className="whitespace-nowrap px-3 py-2 text-left font-medium">{c}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-border">
              {cols.map((c) => {
                const v = r[c];
                const isEps = /eps/i.test(c) || (c === 'Consensus' && r.Metric === 'EPS');
                const isMoney = c === 'Consensus' && (r.Metric === 'REVENUE' || r.Metric === 'EBITDA');
                return <td key={c} className="whitespace-nowrap px-3 py-1.5 font-mono tabular-nums">{typeof v === 'number' && isEps ? fmt.price(v) : typeof v === 'number' && isMoney ? fmt.money(v) : companyMetric(c, v)}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CompanyView({ s }: { s: CompanySnapshot }) {
  const q = s.quote;
  const est = s.estimates;
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-2 pt-4">
          <div className="flex flex-wrap items-baseline gap-3">
            <Link href={`/company/${encodeURIComponent(s.ticker)}`} className="font-mono text-lg font-semibold text-info hover:underline">{s.ticker}</Link>
            {s.name && <span className="text-sm font-medium">{s.name}</span>}
            {q?.price != null && <span className="ml-auto font-mono text-2xl font-semibold tabular-nums">{fmt.price(q.price)}</span>}
            {q?.changePct != null && <Delta value={q.changePct} className="text-sm" />}
          </div>
          <div className="flex flex-wrap gap-1.5 text-[11px] text-muted">
            {s.sector && <Badge variant="outline">{s.sector}</Badge>}
            {s.industry && <Badge variant="outline">{s.industry}</Badge>}
            {q?.ts && <span>Quote as of {new Date(q.ts).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</span>}
          </div>
          {s.description && <p className="line-clamp-4 text-sm text-muted">{s.description}</p>}
        </CardContent>
      </Card>
      <MetricGrid metrics={s.metrics} />
      {s.financials?.length ? (
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Key financials (annual)</CardTitle></CardHeader><CardContent className="p-0"><KvTable rows={s.financials} caption="Key financials" /></CardContent></Card>
      ) : null}
      {est && (est.priceTarget || est.rating || est.periods.length) ? (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Consensus estimates</CardTitle></CardHeader>
          <CardContent className="space-y-3 p-0">
            <div className="flex flex-wrap gap-4 px-4 text-xs">
              {est.rating && <span>Ratings: <span className="font-mono text-up">{est.rating.buy} buy</span> · <span className="font-mono">{est.rating.hold} hold</span> · <span className="font-mono text-down">{est.rating.sell} sell</span></span>}
              {est.priceTarget && <span>Price target: <span className="font-mono">{fmt.price(est.priceTarget.mean)}</span> <span className="text-muted">(range {fmt.price(est.priceTarget.low)}–{fmt.price(est.priceTarget.high)})</span></span>}
            </div>
            <KvTable rows={est.periods} caption="Estimate periods" />
          </CardContent>
        </Card>
      ) : null}
      {s.news?.length ? (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Top news at capture</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {s.news.map((n, i) => (
                <li key={i}>
                  <div className="text-[11px] text-muted">{n.publisher}{n.publishedAt ? ` · ${new Date(n.publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}</div>
                  {n.url ? <a href={n.url} target="_blank" rel="noopener noreferrer" className="font-medium hover:text-info">{n.title}</a> : <span className="font-medium">{n.title}</span>}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
      <Sources sources={s.sources} />
    </div>
  );
}
