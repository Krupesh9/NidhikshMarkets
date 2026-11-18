'use client';
import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronsLeft, ChevronsRight, SlidersHorizontal, Star } from 'lucide-react';
import { NAV, isActive } from '@/config/nav';
import { cn, fmt } from '@/lib/utils';
import { Logo } from './Logo';
import { useQuotes } from './useQuotes';
import { Delta } from '@/components/ui/delta';
import { Skeleton } from '@/components/ui/skeleton';
import { Tip } from '@/components/ui/tooltip';

export interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  watchlist: string[];
  savedScreens: { id: string; name: string }[];
}

export function Sidebar({ collapsed, onToggle, watchlist, savedScreens }: SidebarProps) {
  const pathname = usePathname();
  const { quotes, loading } = useQuotes(watchlist);
  return (
    <aside
      aria-label="Primary"
      className={cn('sticky top-0 hidden h-screen shrink-0 flex-col border-r border-border bg-panel transition-[width] duration-200 md:flex', collapsed ? 'w-14' : 'w-60')}
    >
      <div className={cn('flex h-12 items-center border-b border-border', collapsed ? 'justify-center' : 'justify-between px-3')}>
        <Link href="/dashboard" className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info" aria-label="NidhikshDesk home">
          <Logo showName={!collapsed} />
        </Link>
        {!collapsed && (
          <button onClick={onToggle} className="rounded p-1 text-muted hover:bg-panel-2 hover:text-text" aria-label="Collapse sidebar (⌘B)">
            <ChevronsLeft className="h-4 w-4" />
          </button>
        )}
      </div>
      <nav className="flex flex-col gap-0.5 p-2">
        {NAV.map((item) => {
          const active = isActive(item, pathname);
          const link = (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-muted transition-colors hover:bg-panel-2 hover:text-text',
                active && 'bg-accent/10 text-text shadow-[inset_2px_0_0_rgb(var(--accent))]',
                collapsed && 'justify-center px-0',
              )}
            >
              <item.icon className={cn('h-4 w-4 shrink-0', active && 'text-accent')} aria-hidden />
              {!collapsed && <span>{item.label}</span>}
              {collapsed && <span className="sr-only">{item.label}</span>}
            </Link>
          );
          return collapsed ? <Tip key={item.href} content={item.label} side="right">{link}</Tip> : link;
        })}
      </nav>
      {!collapsed && (
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto border-t border-border p-3 scrollbar-thin">
          <section aria-labelledby="wl-h">
            <h2 id="wl-h" className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted">
              <Star className="h-3 w-3" aria-hidden /> Watchlist
            </h2>
            {watchlist.length === 0 ? (
              <p className="text-xs text-muted">Add tickers from any company page.</p>
            ) : (
              <ul className="space-y-0.5">
                {watchlist.map((t) => {
                  const q = quotes[t];
                  return (
                    <li key={t}>
                      <Link href={`/company/${t}`} className="flex items-center justify-between rounded px-1.5 py-1 text-xs hover:bg-panel-2">
                        <span className="font-mono font-medium">{t}</span>
                        {loading && !q ? (
                          <Skeleton className="h-3 w-20" />
                        ) : q ? (
                          <span className="flex items-center gap-2">
                            <span className="font-mono tabular-nums">{fmt.price(q.price)}</span>
                            <Delta value={q.changePct} showArrow={false} className="w-14 justify-end text-[11px]" />
                          </span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
          <section aria-labelledby="ss-h">
            <h2 id="ss-h" className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted">
              <SlidersHorizontal className="h-3 w-3" aria-hidden /> Saved screens
            </h2>
            {savedScreens.length === 0 ? (
              <p className="text-xs text-muted">Save a screen from the Screener.</p>
            ) : (
              <ul className="space-y-0.5">
                {savedScreens.map((s) => (
                  <li key={s.id}>
                    <Link href={`/screener?screen=${s.id}`} className="block truncate rounded px-1.5 py-1 text-xs text-muted hover:bg-panel-2 hover:text-text">{s.name}</Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
      {collapsed && (
        <button onClick={onToggle} className="mx-auto mb-3 mt-auto rounded p-1.5 text-muted hover:bg-panel-2 hover:text-text" aria-label="Expand sidebar (⌘B)">
          <ChevronsRight className="h-4 w-4" />
        </button>
      )}
    </aside>
  );
}
