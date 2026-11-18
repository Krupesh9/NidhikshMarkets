'use client';
import * as React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronsLeft, ChevronsRight, ShieldCheck } from 'lucide-react';
import { isActive, visibleNav } from '@/config/nav';
import { cn } from '@/lib/utils';
import { APP_NAME } from './Logo';
import { Tip } from '@/components/ui/tooltip';
import { ProChip, useUpgrade } from '@/components/billing/UpgradeDialog';
import { hasFeature } from '@/lib/plans';
import { useCurrentUser } from './UserContext';

export interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  /** Collapsed by the page (e.g. Watchlist uses its own left pane); hides the expand control. */
  locked?: boolean;
}

export function Sidebar({ collapsed, onToggle, locked }: SidebarProps) {
  const pathname = usePathname();
  const { user } = useCurrentUser();
  const { openUpgrade } = useUpgrade();
  return (
    <aside
      aria-label="Primary"
      className={cn('sticky top-0 hidden h-screen shrink-0 flex-col border-r border-border bg-panel transition-[width] duration-300 ease-out md:flex', collapsed ? 'w-[72px]' : 'w-64')}
    >
      <div className={cn('relative flex flex-col items-center border-b border-border', collapsed ? 'px-2 py-4' : 'px-5 pb-6 pt-7')}>
        <Link href="/dashboard" className="flex flex-col items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info" aria-label={`${APP_NAME} home`}>
          <Image src="/nidhiksh-logo.png" alt="" width={collapsed ? 36 : 64} height={collapsed ? 36 : 64} className="rounded-lg transition-all duration-300" priority />
          {!collapsed && (
            <span className="text-center">
              <span className="block text-xl font-semibold tracking-tight">Nidhiksh <span className="text-accent">Pulse</span></span>
              <span className="mt-1 block text-[10px] font-medium uppercase tracking-[0.18em] text-muted">Markets · Private research</span>
            </span>
          )}
        </Link>
        {!collapsed && (
          <button onClick={onToggle} className="absolute right-2 top-2 rounded-md p-1.5 text-muted hover:bg-panel-2 hover:text-text" aria-label="Collapse sidebar (⌘B)">
            <ChevronsLeft className="h-4 w-4" />
          </button>
        )}
      </div>
      <nav className={cn('flex flex-1 flex-col gap-1 overflow-y-auto scrollbar-thin', collapsed ? 'p-2 pt-4' : 'px-4 pt-6')}>
        {!collapsed && <span className="eyebrow mb-2 px-3">Workspace</span>}
        {visibleNav(user.canSettings).map((item) => {
          const active = isActive(item, pathname);
          const locked = !!item.feature && !hasFeature(user, item.feature);
          const link = (
            <Link
              key={item.href}
              href={item.href}
              onClick={locked ? (e) => { e.preventDefault(); openUpgrade(item.feature); } : undefined}
              aria-label={locked ? `${item.label} — locked, Pro feature` : undefined}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'group flex items-center gap-3 rounded-lg px-3 py-2.5 text-[14.5px] text-muted hover:bg-panel-2 hover:text-text',
                active && 'bg-accent/10 font-medium text-text hover:bg-accent/15',
                collapsed && 'justify-center px-0',
              )}
            >
              <item.icon className={cn('h-[18px] w-[18px] shrink-0 transition-colors', active ? 'text-accent' : 'group-hover:text-text')} aria-hidden />
              {!collapsed && <span className="flex-1">{item.label}</span>}
              {!collapsed && locked && <ProChip />}
              {!collapsed && active && <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />}
              {collapsed && <span className="sr-only">{item.label}</span>}
            </Link>
          );
          return collapsed ? <Tip key={item.href} content={item.label} side="right">{link}</Tip> : link;
        })}
      </nav>
      {!collapsed ? (
        <div className="p-4">
          <div className="rounded-xl border border-border bg-panel-2/70 p-4">
            <ShieldCheck className="h-5 w-5 text-accent" aria-hidden />
            <p className="mt-2.5 text-sm font-semibold">A private perspective.</p>
            <p className="mt-1 text-xs leading-relaxed text-muted">Source-cited research. Not investment advice.</p>
          </div>
        </div>
      ) : locked ? null : (
        <button onClick={onToggle} className="mx-auto mb-4 rounded-md p-1.5 text-muted hover:bg-panel-2 hover:text-text" aria-label="Expand sidebar (⌘B)">
          <ChevronsRight className="h-4 w-4" />
        </button>
      )}
    </aside>
  );
}
