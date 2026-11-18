'use client';
import * as React from 'react';
import { ExternalLink, Users } from 'lucide-react';
import type { Estimates } from '@/lib/data/types';
import { cn, fmt } from '@/lib/utils';

const RATING = {
  buy: { label: 'Buy', color: 'rgb(var(--up))', chip: 'bg-up/15 text-up' },
  hold: { label: 'Hold', color: 'rgb(var(--warn))', chip: 'bg-warn/15 text-warn' },
  sell: { label: 'Sell', color: 'rgb(var(--down))', chip: 'bg-down/15 text-down' },
} as const;
type Key = keyof typeof RATING;

const ACTION_LABEL: Record<NonNullable<Estimates['analystActions']>[number]['action'], string> = {
  upgraded: 'Upgraded', downgraded: 'Downgraded', maintained: 'Maintained', initiated: 'Initiated', reiterated: 'Reiterated', 'target-raised': 'Target raised', 'target-lowered': 'Target lowered',
};

function NeedsFeed({ what }: { what: string }) {
  return (
    <div className="flex h-full min-h-[160px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border px-6 text-center">
      <Users className="h-5 w-5 text-muted" aria-hidden />
      <p className="text-sm font-medium">{what} not available yet</p>
      <p className="max-w-sm text-xs text-muted">Connect an analyst-ratings feed — the Benzinga add-on on your Massive plan, or an <code className="font-mono">FMP_API_KEY</code> — to see this like Google Finance.</p>
    </div>
  );
}

/** Donut with Buy / Hold / Sell counts, consensus in the centre and share bars in the legend. */
function RatingsCard({ e, ticker }: { e: Estimates; ticker: string }) {
  const { buy, hold, sell } = e.rating;
  const total = buy + hold + sell;
  const size = 200, stroke = 22, r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const parts = (['buy', 'hold', 'sell'] as Key[]).map((k) => ({ k, n: e.rating[k] })).filter((p) => p.n > 0);
  const gap = parts.length > 1 ? 3 : 0; // px of empty arc between segments (flat ends, so small slices stay visible)
  const consensus: Key = buy >= hold && buy >= sell ? 'buy' : sell > hold ? 'sell' : 'hold';
  let offset = 0;
  return (
    <section className="rounded-xl border border-border bg-panel-2/40 p-5" aria-labelledby="ar-h">
      <h3 id="ar-h" className="text-[15px] font-semibold">Analyst ratings</h3>
      {total === 0 ? <div className="mt-4"><NeedsFeed what="Buy / hold / sell ratings" /></div> : (
        <>
          <p className="mt-1 text-xs text-muted">Based on {total} analysts currently rating {ticker} (strong buy counted as buy, strong sell as sell).</p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-10 gap-y-6">
            <figure className="relative" style={{ width: size, height: size }}>
              <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${buy} buy, ${hold} hold, ${sell} sell; consensus ${RATING[consensus].label}`}>
                <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(var(--border))" strokeWidth={stroke} opacity={0.5} />
                <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
                  {parts.map((p) => {
                    const len = Math.max((p.n / total) * c - gap, 2);
                    const el = <circle key={p.k} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={RATING[p.k].color} strokeWidth={stroke} strokeLinecap="butt"
                      strokeDasharray={`${len} ${c}`} strokeDashoffset={-offset} className="transition-[stroke-dasharray] duration-700 ease-out" />;
                    offset += (p.n / total) * c;
                    return el;
                  })}
                </g>
              </svg>
              <figcaption className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-2xl font-semibold" style={{ color: RATING[consensus].color }}>{RATING[consensus].label}</span>
                <span className="mt-0.5 text-xs text-muted">consensus · {total} analysts</span>
              </figcaption>
            </figure>
            <dl className="w-full max-w-[240px] space-y-4 text-sm">
              {(['buy', 'hold', 'sell'] as Key[]).map((k) => {
                const share = total ? (e.rating[k] / total) * 100 : 0;
                return (
                  <div key={k}>
                    <div className="flex items-center gap-3">
                      <span className="h-3 w-3 rounded-sm" style={{ background: RATING[k].color }} aria-hidden />
                      <dt className="flex-1 font-medium">{RATING[k].label}</dt>
                      <dd className="flex items-center gap-2 font-mono tabular-nums">
                        <span className="font-semibold">{e.rating[k]}</span>
                        <span className="min-w-[3rem] rounded-md px-1.5 py-0.5 text-center text-xs font-semibold text-white" style={{ background: RATING[k].color }}>{share.toFixed(0)}%</span>
                      </dd>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-border/60" aria-hidden>
                      <div className="h-full rounded-full transition-[width] duration-700 ease-out" style={{ width: `${share}%`, background: RATING[k].color }} />
                    </div>
                  </div>
                );
              })}
            </dl>
          </div>
        </>
      )}
    </section>
  );
}

/** Highest / average / lowest 12-month targets as bars, with the current price marked. */
function ForecastCard({ e, ticker, price }: { e: Estimates; ticker: string; price: number | null }) {
  const { high, mean, low } = e.priceTarget;
  const rows = [{ k: 'Highest', v: high }, { k: 'Average', v: mean }, { k: 'Median', v: e.priceTargetMedian ?? 0 }, { k: 'Lowest', v: low }].filter((x) => x.v > 0);
  const max = Math.max(...rows.map((x) => x.v), price ?? 0) * 1.05;
  const pct = (v: number) => (price ? ((v - price) / price) * 100 : null);
  return (
    <section className="rounded-xl border border-border bg-panel-2/40 p-5" aria-labelledby="fc-h">
      <h3 id="fc-h" className="text-[15px] font-semibold">12-month forecast</h3>
      {!rows.length ? <div className="mt-4"><NeedsFeed what="Price targets" /></div> : (
        <>
          <p className="mt-1 text-xs text-muted">Analyst 12-month price targets for {ticker}{rows.length < 3 ? ' (high/low need a ratings feed)' : ' (consensus across covering analysts)'}.</p>
          <div className="relative mt-6 space-y-3">
            {price != null && (
              <div className="pointer-events-none absolute inset-y-0 left-[84px] right-0" aria-hidden>
                <span className="absolute -bottom-7 -top-2 border-l border-dashed border-text/50" style={{ left: `${(price / max) * 100}%` }} />
              </div>
            )}
            {rows.map((x) => {
              const d = pct(x.v);
              return (
                <div key={x.k} className="flex items-center gap-3">
                  <span className="w-[72px] text-sm text-muted">{x.k}</span>
                  <div className="relative flex h-8 flex-1 items-center gap-2">
                    {/* short bars show the value beside the bar so it never overlaps the row label */}
                    <div className="flex h-full shrink-0 items-center justify-end rounded-md bg-info/80 px-3 font-mono text-xs font-semibold tabular-nums text-white transition-[width] duration-700 ease-out" style={{ width: `${(x.v / max) * 100}%` }}>
                      {(x.v / max) * 100 >= 40 && <span className="whitespace-nowrap">${fmt.price(x.v)}{d != null && <span className="ml-1 font-normal opacity-90">({d >= 0 ? '+' : ''}{d.toFixed(1)}%)</span>}</span>}
                    </div>
                    {(x.v / max) * 100 < 40 && <span className="whitespace-nowrap font-mono text-xs tabular-nums">${fmt.price(x.v)}{d != null && <span className="ml-1 text-muted">({d >= 0 ? '+' : ''}{d.toFixed(1)}%)</span>}</span>}
                  </div>
                </div>
              );
            })}
            {price != null && (
              <div className="relative ml-[84px] h-6">
                <span className="absolute top-1 -translate-x-1/2 whitespace-nowrap rounded-full border border-border bg-panel px-2.5 py-0.5 font-mono text-[11px] tabular-nums" style={{ left: `${(price / max) * 100}%` }}>Current ${fmt.price(price)}</span>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function ActionsTable({ e, price }: { e: Estimates; price: number | null }) {
  const rows = e.analystActions ?? [];
  if (!rows.length) return <NeedsFeed what="Analyst-by-analyst actions" />;
  const hasPt = rows.some((r) => r.priceTarget);
  const heads = ['Firm / analyst', 'Recommendation', 'Action', ...(hasPt ? ['Price target', 'Projected'] : []), 'Date', 'Coverage'];
  const right = new Set(['Price target', 'Projected', 'Coverage']);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <caption className="sr-only">Recent analyst rating actions</caption>
        <thead className="text-left text-xs text-muted">
          <tr className="border-b border-border">
            {heads.map((h) => <th key={h} scope="col" className={cn('px-3 py-2.5 font-medium', right.has(h) && 'text-right')}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 20).map((a, i) => {
            const d = a.priceTarget && price ? ((a.priceTarget - price) / price) * 100 : null;
            return (
              <tr key={`${a.firm}-${a.date}-${i}`} className="border-b border-border/60 transition-colors hover:bg-panel-2/50">
                <td className="px-3 py-3"><div className="font-medium">{a.analyst ?? a.firm}</div>{a.analyst && <div className="text-xs text-muted">{a.firm}</div>}</td>
                <td className="px-3 py-3">
                  {a.previousLabel && <span className="mr-1.5 text-xs text-muted" title="Previous rating">{a.previousLabel} →</span>}
                  <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-medium', RATING[a.rating].chip)}>{a.ratingLabel ?? RATING[a.rating].label}</span>
                </td>
                <td className={cn('px-3 py-3', a.action === 'upgraded' ? 'text-up' : a.action === 'downgraded' ? 'text-down' : 'text-muted')}>{ACTION_LABEL[a.action]}</td>
                {hasPt && <td className="px-3 py-3 text-right font-mono tabular-nums">{a.priceTarget ? `$${fmt.price(a.priceTarget)}` : '–'}</td>}
                {hasPt && <td className={cn('px-3 py-3 text-right font-mono tabular-nums', d == null ? 'text-muted' : d >= 0 ? 'text-up' : 'text-down')}>{d == null ? '–' : `${d >= 0 ? '+' : ''}${d.toFixed(1)}%`}</td>}
                <td className="px-3 py-3 font-mono text-xs tabular-nums text-muted">{fmt.date(a.date)}</td>
                <td className="px-3 py-3 text-right">
                  {a.url ? <a href={a.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-info hover:underline">News <ExternalLink className="h-3 w-3" aria-hidden /></a> : <span className="text-muted">–</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Google-Finance-style analysis block: ratings donut, 12-month forecast, analyst actions. */
export function AnalystOverview({ ticker, estimates, price }: { ticker: string; estimates: Estimates; price: number | null }) {
  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <RatingsCard e={estimates} ticker={ticker} />
        <ForecastCard e={estimates} ticker={ticker} price={price} />
      </div>
      <ActionsTable e={estimates} price={price} />
      {estimates.analystSource && (
        <p className="text-[11px] text-muted">
          Ratings, price targets and rating changes:{' '}
          {estimates.analystSource.url ? <a href={estimates.analystSource.url} target="_blank" rel="noopener noreferrer" className="text-info hover:underline">{estimates.analystSource.name}</a> : estimates.analystSource.name}
          {' '}· as of {new Date(estimates.analystSource.asOf).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })} · refreshed every 10 min. “News” searches coverage of each call. Research only, not investment advice.
        </p>
      )}
    </div>
  );
}
