'use client';
import * as React from 'react';
import { ArrowUpRight, Gauge, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import type { ProviderUsage, UsageStatus } from '@/lib/usage-meter';
import { useApiUsage } from './useApiUsage';

const TONE: Record<UsageStatus, { bar: string; chip: string; text: string }> = {
  ok: { bar: 'bg-up', chip: 'border-up/40 bg-up/10 text-up', text: 'text-up' },
  near: { bar: 'bg-warn', chip: 'border-warn/40 bg-warn/10 text-warn', text: 'text-warn' },
  limit_reached: { bar: 'bg-down', chip: 'border-down/40 bg-down/10 text-down', text: 'text-down' },
  blocked: { bar: 'bg-down', chip: 'border-down/40 bg-down/10 text-down', text: 'text-down' },
};

// Same clock as the server's status labels and the daily reset (US Eastern), so times line up.
const TZ = 'America/New_York';
const time = (iso: string | null) => (iso ? `${new Date(iso).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' })} ET` : null);
const sinceLabel = (iso: string | null) => {
  if (!iso) return null;
  const day = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: TZ });
  return day(new Date(iso)) === day(new Date()) ? time(iso) : `${new Date(iso).toLocaleString('en-US', { timeZone: TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} ET`;
};

function Bar({ pct, status, label }: { pct: number; status: UsageStatus; label: string }) {
  const w = status === 'blocked' && pct < 100 ? Math.max(pct, 4) : Math.min(100, pct);
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-border" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(100, pct))} aria-label={label}>
      <div className={cn('h-full rounded-full transition-[width]', TONE[status].bar)} style={{ width: `${w}%` }} />
    </div>
  );
}

function Chip({ p }: { p: ProviderUsage }) {
  return (
    <span className={cn('inline-flex max-w-full items-center rounded border px-1.5 py-0.5 text-[11px] font-medium leading-tight', TONE[p.status].chip)} title={p.lastError?.endpoint ? `Last error: HTTP ${p.lastError.status || 'network'} on ${p.lastError.endpoint}` : undefined}>
      {p.statusLabel}
    </span>
  );
}

function Row({ p }: { p: ProviderUsage }) {
  const day = p.limits.find((l) => l.per === 'day');
  const minute = p.limits.find((l) => l.per === 'minute');
  const second = p.limits.find((l) => l.per === 'second');
  const dayStatus: UsageStatus = p.status === 'blocked' ? 'blocked' : day && day.used >= day.max ? 'limit_reached' : day && day.used >= day.max * 0.8 ? 'near' : 'ok';
  const minStatus: UsageStatus = p.status === 'blocked' ? 'blocked' : minute && minute.used >= minute.max ? 'limit_reached' : minute && minute.used >= minute.max * 0.8 ? 'near' : 'ok';
  return (
    <li className={cn('grid grid-cols-2 gap-x-4 gap-y-2 px-3 py-3 text-sm md:grid-cols-[minmax(0,1.6fr)_minmax(0,0.9fr)_minmax(0,1.3fr)_minmax(0,0.8fr)_minmax(0,1.5fr)] md:items-center', !p.configured && 'opacity-60')}>
      <div className="col-span-2 flex min-w-0 items-center gap-2.5 md:col-span-1">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-panel-2 text-[11px] font-semibold text-text ring-1 ring-border" aria-hidden>{p.name.replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase()}</span>
        <div className="min-w-0">
          <div className="truncate font-medium">{p.name}</div>
          <div className="truncate text-[11px] text-muted">{p.plan} · {p.configured ? 'Configured' : 'Not configured'}</div>
        </div>
      </div>

      <div className="text-xs">
        <div className="text-[10px] uppercase tracking-wide text-muted md:hidden">Limit</div>
        <div className="font-mono tabular-nums">{p.countOnly ? <span className="text-muted">No published limit</span> : p.limitLabel}</div>
        {second && (minute || day) && <div className="font-mono text-[11px] tabular-nums text-muted">{second.label}</div>}
        {p.budget && <div className="text-[11px] text-muted">App stops at {p.budget.max}</div>}
      </div>

      <div className="min-w-0 text-xs">
        <div className="text-[10px] uppercase tracking-wide text-muted md:hidden">Used today</div>
        {day ? (
          <div className="space-y-1">
            <div className="flex items-baseline justify-between gap-2 font-mono tabular-nums">
              <span><span className={cn('font-semibold', TONE[dayStatus].text)}>{day.used}</span><span className="text-muted"> / {day.max}</span></span>
              <span className="text-[11px] text-muted">{Math.round(day.pct)}%</span>
            </div>
            <Bar pct={day.pct} status={dayStatus} label={`${p.name}: ${day.used} of ${day.max} calls used today`} />
          </div>
        ) : (
          <div className="font-mono tabular-nums">{p.usedToday.toLocaleString('en-US')} <span className="text-muted">calls</span></div>
        )}
        {p.errorsToday > 0 && <div className="mt-0.5 text-[11px] text-muted">{p.errorsToday} failed</div>}
      </div>

      <div className="text-xs">
        <div className="text-[10px] uppercase tracking-wide text-muted md:hidden">This minute</div>
        {minute ? (
          <div className="space-y-1">
            <div className="font-mono tabular-nums"><span className={cn('font-semibold', TONE[minStatus].text)}>{minute.used}</span><span className="text-muted"> / {minute.max}</span></div>
            <Bar pct={minute.pct} status={minStatus} label={`${p.name}: ${minute.used} of ${minute.max} calls this minute`} />
          </div>
        ) : (
          <div className="font-mono tabular-nums text-muted">{p.usedThisMinute}</div>
        )}
      </div>

      <div className="col-span-2 flex min-w-0 flex-wrap items-center justify-between gap-2 md:col-span-1">
        <div className="min-w-0 space-y-0.5">
          <Chip p={p} />
          <div className="text-[11px] text-muted">
            {p.lastSuccessAt ? `Last success ${sinceLabel(p.lastSuccessAt)}` : p.usedToday ? 'No successful call yet' : p.configured ? 'No calls yet' : '—'}
            {p.lastError && p.status !== 'blocked' && p.lastError.status !== 0 && <> · last error {p.lastError.status} at {sinceLabel(p.lastError.at)}</>}
          </div>
        </div>
        {p.upgradeUrl && (p.status !== 'ok' || !p.countOnly) && (
          <a href={p.upgradeUrl} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-0.5 rounded text-[11px] text-info hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info">
            Upgrade plan <ArrowUpRight className="h-3 w-3" aria-hidden />
          </a>
        )}
      </div>
    </li>
  );
}

/** Settings → Data sources → "API usage & limits": calls per provider vs. its limit; refreshes every 30s. */
export function ApiUsage() {
  const { data, error, loading, refresh } = useApiUsage(true, 30_000);
  const hit = data?.providers.filter((p) => p.status === 'limit_reached' || p.status === 'blocked') ?? [];
  const near = data?.providers.filter((p) => p.status === 'near') ?? [];
  return (
    <section id="api-usage" aria-labelledby="api-usage-title" className="scroll-mt-28 space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 id="api-usage-title" className="flex items-center gap-2 text-sm font-semibold"><Gauge className="h-4 w-4 text-muted" aria-hidden /> API usage &amp; limits</h3>
          <p className="text-xs text-muted">
            Calls this app made to each provider against its free-tier limit.
            {data && <> {hit.length ? <strong className="text-down">{hit.length} at limit</strong> : <span className="text-up">None at limit</span>}{near.length ? <>, <strong className="text-warn">{near.length} near limit</strong></> : null}.</>}
          </p>
        </div>
        <button onClick={refresh} className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-muted hover:bg-panel-2 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info" aria-label="Refresh API usage">
          <RefreshCw className="h-3 w-3" aria-hidden /> {data ? `Updated ${time(data.asOf)}` : 'Refresh'}
        </button>
      </div>

      {error === 'forbidden' ? (
        <p className="rounded-md border border-border px-3 py-3 text-xs text-muted">API usage is visible to the workspace owner only.</p>
      ) : loading && !data ? (
        <div className="space-y-2" role="status" aria-label="Loading API usage">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : !data ? (
        <p className="rounded-md border border-border px-3 py-3 text-xs text-muted">Couldn’t load API usage. <button className="text-info hover:underline" onClick={refresh}>Try again</button></p>
      ) : (
        <>
          <div className="overflow-hidden rounded-md border border-border">
            <div className="hidden grid-cols-[minmax(0,1.6fr)_minmax(0,0.9fr)_minmax(0,1.3fr)_minmax(0,0.8fr)_minmax(0,1.5fr)] gap-x-4 border-b border-border bg-panel-2/60 px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-muted md:grid">
              <span>Provider</span><span>Limit</span><span>Used today</span><span>This minute</span><span>Status</span>
            </div>
            <ul className="divide-y divide-border">
              {data.providers.map((p) => <Row key={p.id} p={p} />)}
            </ul>
          </div>
          <p className="text-[11px] leading-relaxed text-muted">
            {data.note} Daily counters reset at midnight US Eastern; per-minute counters are a rolling 60 seconds. “Blocked by provider” means the provider itself
            rejected a call (HTTP 429 or a limit notice) — it clears on the next successful call. Errors record the endpoint path only, never keys or query strings.
          </p>
        </>
      )}
    </section>
  );
}
