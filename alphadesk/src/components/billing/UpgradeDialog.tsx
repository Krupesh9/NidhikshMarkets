'use client';
import * as React from 'react';
import Link from 'next/link';
import { Check, Lock, Mail, Sparkles } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { FEATURE_LABEL, FREE_INCLUDES, PLAN_INFO, PRO_INCLUDES, type Feature } from '@/lib/plans';
import { cn } from '@/lib/utils';

interface UpgradeCtx {
  /** Open the subscription dialog, optionally naming the feature that was clicked. */
  openUpgrade: (feature?: Feature) => void;
  ownerEmail: string | null;
}
const Ctx = React.createContext<UpgradeCtx>({ openUpgrade: () => {}, ownerEmail: null });
/** const { openUpgrade } = useUpgrade(); <button onClick={() => openUpgrade('financials')}>… */
export const useUpgrade = () => React.useContext(Ctx);

const EVT = 'nd:open-upgrade';
/** Open the dialog from code that sits above the provider (e.g. AppShell keyboard shortcuts). */
export function requestUpgrade(feature?: Feature) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EVT, { detail: feature }));
}

export function upgradeMailto(ownerEmail: string | null, userEmail?: string, feature?: Feature): string | null {
  if (!ownerEmail) return null;
  const subject = 'Nidhiksh Pulse — upgrade to Pro ($100/mo)';
  const body = `Hi,\n\nI'd like to upgrade my Nidhiksh Pulse account${userEmail ? ` (${userEmail})` : ''} to Pro ($100/month)${feature ? ` — I want ${FEATURE_LABEL[feature]}` : ''}.\n\nThanks`;
  return `mailto:${ownerEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** Mounted once in AppShell. Radix Dialog gives focus trap, Escape to close and focus return. */
export function UpgradeProvider({ ownerEmail, userEmail, currentPlan, children }: { ownerEmail: string | null; userEmail?: string; currentPlan: string; children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const [feature, setFeature] = React.useState<Feature | undefined>();
  const value = React.useMemo<UpgradeCtx>(() => ({ openUpgrade: (f) => { setFeature(f); setOpen(true); }, ownerEmail }), [ownerEmail]);
  React.useEffect(() => {
    const on = (e: Event) => { setFeature((e as CustomEvent<Feature | undefined>).detail); setOpen(true); };
    window.addEventListener(EVT, on);
    return () => window.removeEventListener(EVT, on);
  }, []);
  const paid = currentPlan === 'PRO_PLUS';
  const mailto = upgradeMailto(ownerEmail, userEmail, feature);
  return (
    <Ctx.Provider value={value}>
      {children}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl gap-5 p-6">
          <div className="space-y-1.5 pr-6">
            <div className="flex items-center gap-2 text-accent"><Sparkles className="h-4 w-4" aria-hidden /><span className="eyebrow text-accent">Nidhiksh Pulse Pro</span></div>
            <DialogTitle className="text-xl font-semibold tracking-tight">
              {feature ? `${FEATURE_LABEL[feature]} is a Pro feature` : 'Upgrade to Pro'}
            </DialogTitle>
            <DialogDescription className="text-sm text-muted">One plan, everything included — AI research, analyst data, financials, ownership and advanced charting.</DialogDescription>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <PlanColumn title={PLAN_INFO.FREE.label} price="$0" sub="forever" items={FREE_INCLUDES} current={!paid} />
            <PlanColumn title={PLAN_INFO.PRO_PLUS.label} price={`$${PLAN_INFO.PRO_PLUS.priceMonthly}`} sub="per month" items={PRO_INCLUDES} highlight current={paid} />
          </div>
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-panel-2/60 p-3 sm:flex-row sm:items-center">
            <p className="flex-1 text-xs text-muted"><strong className="text-text">Billing coming soon</strong> — contact the owner to upgrade. Your plan changes as soon as the owner updates it.</p>
            {mailto ? (
              <a href={mailto} className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-accent px-4 text-sm font-semibold text-accent-foreground hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info">
                <Mail className="h-4 w-4" aria-hidden /> Upgrade to Pro
              </a>
            ) : (
              <Link href="/settings#plan" onClick={() => setOpen(false)} className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-accent px-4 text-sm font-semibold text-accent-foreground hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info">
                Upgrade to Pro
              </Link>
            )}
          </div>
          <p className="text-center text-[11px] text-muted">Research only — not investment advice.</p>
        </DialogContent>
      </Dialog>
    </Ctx.Provider>
  );
}

function PlanColumn({ title, price, sub, items, highlight, current }: { title: string; price: string; sub: string; items: string[]; highlight?: boolean; current?: boolean }) {
  return (
    <div className={cn('flex flex-col rounded-lg border p-4', highlight ? 'border-accent/60 bg-accent/[0.06] shadow-[0_0_0_1px_rgb(var(--accent)/0.15)]' : 'border-border bg-panel-2/40')}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{title}</h3>
        {current && <span className="rounded border border-border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">Current</span>}
        {highlight && !current && <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent-foreground">Recommended</span>}
      </div>
      <div className="mt-2 flex items-baseline gap-1.5"><span className="font-mono text-3xl font-semibold tabular-nums">{price}</span><span className="text-xs text-muted">{sub}</span></div>
      <ul className="mt-3 space-y-1.5 text-xs">
        {items.map((i) => (
          <li key={i} className="flex gap-2"><Check className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', highlight ? 'text-accent' : 'text-up')} aria-hidden /><span>{i}</span></li>
        ))}
      </ul>
    </div>
  );
}

/** Small inline "Pro" chip with a lock — for locked buttons, nav items and range pills. */
export function ProChip({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-0.5 rounded bg-accent/15 px-1 py-px text-[9px] font-semibold uppercase leading-none tracking-wide text-accent', className)}>
      <Lock className="h-2.5 w-2.5" aria-hidden />Pro
    </span>
  );
}

/** A small control that looks like its unlocked twin but opens the upgrade dialog. */
export function LockedButton({ feature, children, className, title, label }: { feature: Feature; children: React.ReactNode; className?: string; title?: string; label?: string }) {
  const { openUpgrade } = useUpgrade();
  return (
    <button type="button" onClick={() => openUpgrade(feature)} className={cn('inline-flex items-center gap-1', className)} title={title ?? `${FEATURE_LABEL[feature]} — Pro feature`} aria-label={`${label ?? FEATURE_LABEL[feature]} — locked, Pro feature`}>
      {children}<ProChip />
    </button>
  );
}
