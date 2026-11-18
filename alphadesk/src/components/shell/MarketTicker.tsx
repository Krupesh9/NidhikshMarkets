'use client';
import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn, fmt } from '@/lib/utils';

interface Tile { slug: string; short: string; value: number | null; change: number | null; changePct: number | null; unit: 'price' | 'pct-yield' }

/**
 * Scrolling market banner under the top bar on every screen except Home (which shows the full tiles).
 * Refreshes every 60s; pauses on hover/focus; static and scrollable when reduced motion is on.
 */
export function MarketTicker() {
  const pathname = usePathname();
  const hidden = pathname === '/dashboard';
  const [tiles, setTiles] = React.useState<Tile[] | null>(null);

  React.useEffect(() => {
    if (hidden) return;
    let alive = true;
    const load = () => fetch('/api/markets/strip', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((j) => { if (alive && j?.tiles) setTiles(j.tiles); }).catch(() => {});
    load();
    const id = window.setInterval(() => { if (document.visibilityState === 'visible') load(); }, 60_000);
    return () => { alive = false; window.clearInterval(id); };
  }, [hidden]);

  if (hidden) return null;
  const items = (tiles ?? []).filter((t) => t.value != null);
  const row = (dup: boolean) => (
    <ul className="flex shrink-0 items-center gap-8 pr-8" aria-hidden={dup || undefined}>
      {items.map((t) => {
        const pct = t.changePct ?? 0;
        const tone = pct > 0 ? 'text-up' : pct < 0 ? 'text-down' : 'text-muted';
        const val = t.unit === 'pct-yield' ? `${t.value!.toFixed(2)}%` : fmt.price(t.value!);
        const chg = t.unit === 'pct-yield'
          ? `${(t.change ?? 0) > 0 ? '+' : ''}${Math.round(t.change ?? 0)} bp`
          : `${(t.change ?? 0) > 0 ? '+' : ''}${fmt.price(t.change ?? 0)} (${pct > 0 ? '+' : ''}${pct.toFixed(2)}%)`;
        return (
          <li key={t.slug + (dup ? '-d' : '')}>
            <Link href={`/markets/${t.slug}`} tabIndex={dup ? -1 : undefined} className="flex items-center gap-2 whitespace-nowrap text-xs hover:text-info focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info">
              <span className="font-medium text-muted">{t.short}</span>
              <span className="font-mono tabular-nums">{val}</span>
              <span className={cn('font-mono tabular-nums', tone)}>{pct > 0 ? '▲' : pct < 0 ? '▼' : '•'} {chg}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
  return (
    <div className="group sticky top-16 z-10 h-9 overflow-hidden border-b border-border bg-panel/80 backdrop-blur" role="region" aria-label="Market ticker">
      {items.length === 0 ? (
        <div className="flex h-full items-center px-6 text-[11px] text-muted">Loading markets…</div>
      ) : (
        <div className="nd-marquee flex h-full w-max items-center pl-6 group-hover:[animation-play-state:paused] group-focus-within:[animation-play-state:paused]">
          {row(false)}
          {row(true)}
        </div>
      )}
      <span className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-bg to-transparent" aria-hidden />
      <span className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-bg to-transparent" aria-hidden />
    </div>
  );
}
