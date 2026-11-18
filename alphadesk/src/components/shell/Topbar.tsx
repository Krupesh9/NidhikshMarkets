'use client';
import * as React from 'react';
import Link from 'next/link';
import { signOut } from 'next-auth/react';
import { Bot, FlaskConical, LogOut, Search, Settings, Database, Keyboard } from 'lucide-react';
import { PLAN_INFO, formatLimit, hasFeature } from '@/lib/plans';
import { ProChip } from '@/components/billing/UpgradeDialog';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Kbd } from '@/components/ui/kbd';
import { Tip } from '@/components/ui/tooltip';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useCurrentUser } from './UserContext';
import { Logo } from './Logo';
import { useApiUsage } from '@/components/settings/useApiUsage';

export function PlanBadge() {
  const { user } = useCurrentUser();
  const v = user.plan === 'PRO_PLUS' ? 'accent' : 'outline';
  return <Badge variant={v}>{PLAN_INFO[user.plan].label}</Badge>;
}

export function UsageMeter({ className }: { className?: string }) {
  const { user, usage } = useCurrentUser();
  const limit = PLAN_INFO[user.plan].limits.aiQueriesPerMonth;
  const pct = limit === Infinity ? 0 : limit === 0 ? 100 : Math.min(100, (usage.aiQueries / limit) * 100);
  const label = limit === 0 ? 'AI not included on Free' : `${usage.aiQueries} / ${formatLimit(limit)} AI queries this month`;
  return (
    <Tip content={label}>
      <Link href={user.canSettings ? "/settings#usage" : "#"} className={cn('hidden items-center gap-2 rounded px-1.5 py-1 text-[11px] text-muted hover:bg-panel-2 lg:flex', className)} aria-label={label}>
        <Bot className="h-3.5 w-3.5" aria-hidden />
        <span className="font-mono tabular-nums">{limit === 0 ? '—' : limit === Infinity ? `${usage.aiQueries} / ∞` : `${usage.aiQueries}/${limit}`}</span>
        {limit !== Infinity && (
          <span className="h-1.5 w-14 overflow-hidden rounded-full bg-border" aria-hidden>
            <span className={cn('block h-full', pct > 90 ? 'bg-down' : pct > 70 ? 'bg-warn' : 'bg-info')} style={{ width: `${pct}%` }} />
          </span>
        )}
      </Link>
    </Tip>
  );
}

export function MockIndicator() {
  const { dataMode, user } = useCurrentUser();
  // ADMIN/owner only: amber dot when a data provider's API limit is reached or the provider is rejecting calls
  const alerts = useApiUsage(user.role === 'ADMIN' && user.canSettings !== false, 60_000).data?.alerts ?? [];
  const pill = (
    <span className={cn('relative hidden items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] sm:inline-flex', dataMode.isMock ? 'border-warn/40 bg-warn/10 text-warn' : 'border-up/40 bg-up/10 text-up')}>
      {dataMode.isMock ? <FlaskConical className="h-3 w-3" aria-hidden /> : <Database className="h-3 w-3" aria-hidden />}
      {dataMode.label}
      {alerts.length > 0 && <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-warn ring-2 ring-bg" aria-hidden />}
    </span>
  );
  if (alerts.length) {
    const msg = alerts.map((a) => a.message).join(' · ');
    return (
      <Tip content={<>{msg}<div className="text-muted">Open Settings → Data sources</div></>}>
        <Link href="/settings#api-usage" aria-label={`API limit warning: ${msg}`} className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info">{pill}</Link>
      </Tip>
    );
  }
  return <Tip content={`Data sources: ${dataMode.providers.join(' → ')}`}>{pill}</Tip>;
}

export function Topbar({ onSearch, onChat, onShortcuts }: { onSearch: () => void; onChat: () => void; onShortcuts: () => void }) {
  const { user } = useCurrentUser();
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-bg/80 px-4 backdrop-blur-md md:px-8">
      <Link href="/dashboard" className="md:hidden" aria-label="Nidhiksh Pulse home"><Logo size={24} showName={false} /></Link>
      <button
        onClick={onSearch}
        className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-panel px-2.5 text-sm text-muted hover:border-info/50 md:max-w-md"
        aria-label="Search tickers (⌘K)"
      >
        <Search className="h-4 w-4 shrink-0" aria-hidden />
        <span className="truncate">Search ticker or company…</span>
        <span className="ml-auto hidden items-center gap-0.5 sm:flex"><Kbd>⌘</Kbd><Kbd>K</Kbd></span>
      </button>
      <div className="ml-auto flex items-center gap-2">
        <MockIndicator />
        <UsageMeter />
        <PlanBadge />
        <Button variant="secondary" size="sm" onClick={onChat} aria-label={hasFeature(user, 'ai') ? 'Open AI research chat (⌘J)' : 'AI research chat — locked, Pro feature'}>
          <Bot /> <span className="hidden sm:inline">Ask AI</span>
          {hasFeature(user, 'ai') ? <Kbd className="hidden lg:inline-flex">⌘J</Kbd> : <ProChip />}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger className="flex h-8 w-8 items-center justify-center rounded-full bg-panel-2 text-xs font-semibold text-text ring-1 ring-border hover:ring-info focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info" aria-label="User menu">
            {user.name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="text-text">
              <div className="truncate">{user.name}</div>
              <div className="truncate text-[11px] font-normal text-muted">{user.email} · {user.role}</div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {user.canSettings && <DropdownMenuItem asChild><Link href="/settings"><Settings /> Settings</Link></DropdownMenuItem>}
            <DropdownMenuItem onSelect={onShortcuts}><Keyboard /> Keyboard shortcuts</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => signOut({ callbackUrl: '/login' })}><LogOut /> Sign out</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
