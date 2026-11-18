'use client';
import { Gauge } from 'lucide-react';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { UpgradeHint } from '@/components/shell/UpgradeHint';
import { PLAN_INFO, type Plan } from '@/lib/plans';
import { cn } from '@/lib/utils';
import { usageFraction } from './billing';

export interface UsageData { period: string; aiQueries: number; aiLimit: number | null; deepDivesToday: number; deepDiveLimit: number | null; resetsAt: string; org: { users: number; aiQueries: number } | null }

function Meter({ label, used, limit, hint }: { label: string; used: number; limit: number | null; hint?: string }) {
  const lim = limit == null ? Infinity : limit;
  const f = usageFraction(used, lim);
  const tone = lim === 0 ? 'bg-muted' : f >= 1 ? 'bg-down' : f >= 0.8 ? 'bg-warn' : 'bg-info';
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-medium">{label}</span>
        <span className="font-mono tabular-nums text-muted">
          <span className="text-text">{used}</span> / {limit == null ? 'Unlimited' : limit === 0 ? 'not included' : limit}
        </span>
      </div>
      <div
        className="mt-1.5 h-2 overflow-hidden rounded-full bg-panel-2" role="meter" aria-label={label}
        aria-valuemin={0} aria-valuemax={limit == null ? used || 1 : Math.max(limit, 1)} aria-valuenow={used}
      >
        <div className={cn('h-full rounded-full transition-all', tone)} style={{ width: `${limit == null ? Math.min(100, used ? 8 : 0) : f * 100}%` }} />
      </div>
      {hint && <p className="mt-1 text-[11px] text-muted">{hint}</p>}
    </div>
  );
}

export function UsageCard({ usage, plan }: { usage: UsageData; plan: Plan }) {
  const reset = new Date(usage.resetsAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const noAi = usage.aiLimit === 0;
  const atCap = usage.aiLimit != null && usage.aiLimit > 0 && usage.aiQueries >= usage.aiLimit;
  return (
    <Card id="usage" className="scroll-mt-16">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Gauge className="h-4 w-4 text-muted" aria-hidden /> Usage</CardTitle>
        <CardDescription>Period {usage.period} · AI counter resets monthly on {reset} (UTC). Deep dives reset daily.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Meter label="AI research queries this month" used={usage.aiQueries} limit={usage.aiLimit} hint={usage.aiLimit == null ? `${PLAN_INFO[plan].label} includes unlimited AI queries.` : undefined} />
        <Meter label="Company deep dives today" used={usage.deepDivesToday} limit={usage.deepDiveLimit} />
        {noAi && <UpgradeHint reason="AI research is not included on Free." upgradeTo="PRO" />}
        {atCap && <UpgradeHint reason={`You've used all ${usage.aiLimit} AI queries this month.`} upgradeTo="PRO_PLUS" />}
        {usage.org && (
          <p className="text-xs text-muted">Organisation this month: <span className="font-mono text-text">{usage.org.aiQueries}</span> AI queries across {usage.org.users} active {usage.org.users === 1 ? 'member' : 'members'}. <Link href="#audit" className="text-info hover:underline">See audit log</Link></p>
        )}
      </CardContent>
    </Card>
  );
}
