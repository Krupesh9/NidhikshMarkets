'use client';
import * as React from 'react';
import { Check, CreditCard, Mail, Minus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { upgradeMailto } from '@/components/billing/UpgradeDialog';
import { FREE_INCLUDES, PLAN_INFO, PLANS, PRO_INCLUDES, type Plan } from '@/lib/plans';
import { cn } from '@/lib/utils';
import { planComparisonRows, priceLabel } from './billing';

const BLURB: Record<Plan, string> = {
  FREE: 'The essentials: quotes, basic charts, news, filings, calendar and your watchlist.',
  PRO_PLUS: 'Everything: AI research assistant, analyst data, financials, ownership, advanced charts and team seats.',
};
const INCLUDES: Record<Plan, string[]> = { FREE: FREE_INCLUDES, PRO_PLUS: PRO_INCLUDES };

/** Plan & billing. No self-serve plan changes: Stripe isn't wired, so upgrades go through the owner. */
export function PlanBilling({ plan, userEmail, ownerEmail, isAdmin }: { plan: Plan; userEmail: string; ownerEmail: string | null; isAdmin: boolean }) {
  const rows = React.useMemo(() => planComparisonRows(), []);
  const mailto = upgradeMailto(ownerEmail, userEmail);
  const paid = plan === 'PRO_PLUS';
  return (
    <Card id="plan" className="scroll-mt-28">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><CreditCard className="h-4 w-4 text-muted" aria-hidden /> Plan &amp; billing</CardTitle>
        <CardDescription>You&apos;re on <strong className="text-text">{PLAN_INFO[plan].priceLabel}</strong>.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          {PLANS.map((p) => {
            const info = PLAN_INFO[p];
            const current = plan === p;
            return (
              <div key={p} className={cn('flex flex-col rounded-lg border p-4', p === 'PRO_PLUS' ? 'border-accent/60 bg-accent/[0.05]' : 'border-border bg-panel-2/40')}>
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">{info.label}</h3>
                  {current ? <Badge variant="accent">Current plan</Badge> : p === 'PRO_PLUS' ? <Badge variant="info">Everything</Badge> : null}
                </div>
                <div className="mt-2 font-mono text-2xl font-semibold tabular-nums">{priceLabel(p)}</div>
                <p className="mt-1 text-xs text-muted">{BLURB[p]}</p>
                <ul className="mt-3 flex-1 space-y-1.5 text-xs">
                  {INCLUDES[p].map((i) => <li key={i} className="flex gap-2"><Check className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', p === 'PRO_PLUS' ? 'text-accent' : 'text-up')} aria-hidden />{i}</li>)}
                </ul>
                {p === 'PRO_PLUS' && !paid && (
                  mailto ? (
                    <a href={mailto} className="mt-4 inline-flex h-9 items-center justify-center gap-2 rounded-md bg-accent px-4 text-sm font-semibold text-accent-foreground hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info">
                      <Mail className="h-4 w-4" aria-hidden /> Upgrade to Pro
                    </a>
                  ) : (
                    <span className="mt-4 rounded-md border border-border px-3 py-2 text-center text-xs text-muted">Ask your workspace admin to upgrade you.</span>
                  )
                )}
              </div>
            );
          })}
        </div>
        <div role="note" className="rounded-md border border-border bg-panel-2/60 px-3 py-2 text-xs text-muted">
          <strong className="text-text">Billing coming soon</strong> — contact the owner to upgrade.
          {isAdmin ? ' As an admin you can set members’ plans under Team.' : ' Plans are changed by your workspace admin.'}
        </div>
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-xs">
            <caption className="sr-only">Plan comparison</caption>
            <thead className="bg-panel-2 text-muted">
              <tr>
                <th scope="col" className="px-3 py-2 text-left font-medium">Feature</th>
                {PLANS.map((p) => <th key={p} scope="col" className={cn('px-3 py-2 text-center font-medium', plan === p && 'text-accent')}>{PLAN_INFO[p].label}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label} className="border-t border-border">
                  <th scope="row" className="px-3 py-1.5 text-left font-normal">{r.label}</th>
                  {PLANS.map((p) => {
                    const v = r.values[p];
                    return (
                      <td key={p} className="px-3 py-1.5 text-center font-mono tabular-nums">
                        {v === true ? <Check className="mx-auto h-3.5 w-3.5 text-up" aria-label="Included" /> : v === false ? <Minus className="mx-auto h-3.5 w-3.5 text-muted" aria-label="Not included" /> : v}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
