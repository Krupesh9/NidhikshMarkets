'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Check, CreditCard, Minus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/components/ui/toast';
import { useCurrentUser } from '@/components/shell/UserContext';
import { PLAN_INFO, PLANS, type Plan } from '@/lib/plans';
import { cn } from '@/lib/utils';
import { planComparisonRows, priceLabel, savingsLabel, yearlySavings, type BillingCycle } from './billing';

const MAX_SAVE = Math.max(...PLANS.map(yearlySavings));

const BLURB: Record<Plan, string> = {
  FREE: 'Explore the terminal: screener, company deep dives, a small paper portfolio.',
  PRO: 'For the individual analyst: AI research with citations, sharing, bigger portfolios.',
  PRO_PLUS: 'For the desk: unlimited AI, team seats, custom basket sharing, priority refresh.',
};

export function PlanBilling() {
  const { user, refresh } = useCurrentUser();
  const router = useRouter();
  const [cycle, setCycle] = React.useState<BillingCycle>('monthly');
  const [busy, setBusy] = React.useState<Plan | null>(null);
  const rows = React.useMemo(() => planComparisonRows(), []);

  const choose = async (plan: Plan) => {
    setBusy(plan);
    try {
      const r = await fetch('/api/settings/plan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ plan, cycle }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error?.message ?? `HTTP ${r.status}`);
      toast({ title: `You're on ${PLAN_INFO[plan].label}`, description: [...(j.changes ?? []), 'Demo billing — no payment processed.'].join(' · '), variant: 'success' });
      await refresh();
      router.refresh();
    } catch (e) {
      toast({ title: 'Plan change failed', description: (e as Error).message, variant: 'error' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card id="plan" className="scroll-mt-16">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base"><CreditCard className="h-4 w-4 text-muted" aria-hidden /> Plan &amp; billing</CardTitle>
          <CardDescription>You&apos;re on <strong className="text-text">{PLAN_INFO[user.plan].label}</strong>. Changes apply immediately.</CardDescription>
        </div>
        <div role="radiogroup" aria-label="Billing cycle" className="flex rounded-md border border-border bg-panel-2 p-0.5 text-xs">
          {(['monthly', 'yearly'] as const).map((c) => (
            <button
              key={c} role="radio" aria-checked={cycle === c} onClick={() => setCycle(c)}
              className={cn('rounded px-3 py-1 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info', cycle === c ? 'bg-panel text-text shadow' : 'text-muted hover:text-text')}
            >
              {c === 'monthly' ? 'Monthly' : 'Yearly'}{c === 'yearly' && <span className="ml-1 text-up">save up to ${MAX_SAVE}</span>}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div role="note" className="rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">
          <strong>Demo billing — no payment processed.</strong> Switching plans here is a mock toggle for demonstration; Stripe is not connected.
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {PLANS.map((p) => {
            const info = PLAN_INFO[p];
            const current = user.plan === p;
            const save = cycle === 'yearly' ? savingsLabel(p) : null;
            const idx = PLANS.indexOf(p), curIdx = PLANS.indexOf(user.plan);
            return (
              <div key={p} className={cn('flex flex-col rounded-lg border p-4', current ? 'border-accent bg-accent/5' : 'border-border bg-panel-2/40')}>
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">{info.label}</h3>
                  {current && <Badge variant="accent">Current plan</Badge>}
                  {!current && p === 'PRO_PLUS' && <Badge variant="info">Teams</Badge>}
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="font-mono text-2xl font-semibold tabular-nums">{priceLabel(p, cycle)}</span>
                  {save && <Badge variant="up">{save}</Badge>}
                </div>
                {cycle === 'yearly' && info.priceMonthly > 0 && <p className="text-[11px] text-muted">vs ${(info.priceMonthly * 12).toLocaleString('en-US')} billed monthly</p>}
                {cycle === 'monthly' && info.priceMonthly > 0 && <p className="text-[11px] text-muted">or ${info.priceYearly.toLocaleString('en-US')}/yr ({savingsLabel(p)})</p>}
                <p className="mt-2 flex-1 text-xs text-muted">{BLURB[p]}</p>
                <Button
                  className="mt-3" size="sm" variant={current ? 'secondary' : idx > curIdx ? 'default' : 'outline'}
                  disabled={current || busy !== null} onClick={() => choose(p)} aria-label={current ? `${info.label} is your current plan` : `Switch to ${info.label}`}
                >
                  {current ? 'Current plan' : busy === p ? 'Switching…' : idx > curIdx ? `Upgrade to ${info.label}` : `Switch to ${info.label}`}
                </Button>
              </div>
            );
          })}
        </div>
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-xs">
            <caption className="sr-only">Plan comparison</caption>
            <thead className="bg-panel-2 text-muted">
              <tr>
                <th scope="col" className="px-3 py-2 text-left font-medium">Feature</th>
                {PLANS.map((p) => <th key={p} scope="col" className={cn('px-3 py-2 text-center font-medium', user.plan === p && 'text-accent')}>{PLAN_INFO[p].label}</th>)}
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
