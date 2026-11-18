'use client';
/**
 * <ShareButton itemType="note" itemId={note.id} snapshot={{ question, answerMarkdown, sources, tickers }} />
 *
 * Opens a dialog to share with the org or via link, then shows a copyable URL.
 * - `snapshot` may be an object or a function (called at share time, so it captures the latest view state).
 *   The server merges it over a snapshot built from the stored record, sanitises it, and freezes it.
 *   Suggested keys per type:
 *     note:      { question, answerMarkdown, sources: SourceRef[], tickers }
 *     thread:    { title, question, messages: [{role, content, citations}], context }
 *     screen:    { name, description, filters, columns, sort, rows (≤250), resultCount }
 *     portfolio: { name, benchmark, positions: [{ticker, quantity, costBasis, price, marketValue, weight, pnl, sector}], metrics: {label: number|string} }
 *     basket:    { name, thesis, holdings: [{ticker, targetWeight, rationale, sector}], metrics }
 *   Include `isMock: true` when the data shown was simulated.
 * - For items not persisted yet, pass itemId="adhoc:<anything>" and a complete snapshot.
 * - Plan gating: Pro+ for sharing, Pro Plus for baskets. Shows an inline <UpgradeHint/> instead of failing.
 */
import * as React from 'react';
import Link from 'next/link';
import { Check, Copy, Globe, Link2, Share2, Users } from 'lucide-react';
import { Button, type ButtonProps } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/toast';
import { UpgradeHint } from '@/components/shell/UpgradeHint';
import { useCurrentUser } from '@/components/shell/UserContext';
import type { GateResult, Plan } from '@/lib/plans';
import { cn } from '@/lib/utils';
import { ITEM_LABEL, shareGate, type ShareItemType, type ShareVisibility } from './snapshot';

export interface ShareButtonProps {
  itemType: ShareItemType;
  itemId: string;
  snapshot?: Record<string, unknown> | (() => Record<string, unknown>);
  /** title shown in the feed (defaults to the stored item's name) */
  title?: string;
  label?: string;
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
  className?: string;
  defaultVisibility?: ShareVisibility;
  onShared?: (r: { token: string; url: string }) => void;
}

function usePlan(): Plan | null {
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useCurrentUser().user.plan;
  } catch {
    return null;
  }
}

export function ShareButton({ itemType, itemId, snapshot, title, label = 'Share', variant = 'outline', size = 'sm', className, defaultVisibility = 'org', onShared }: ShareButtonProps) {
  const plan = usePlan();
  const [open, setOpen] = React.useState(false);
  const [visibility, setVisibility] = React.useState<ShareVisibility>(defaultVisibility);
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<{ token: string; url: string } | null>(null);
  const [gate, setGate] = React.useState<GateResult | null>(null);
  const [copied, setCopied] = React.useState(false);

  const clientGate = plan ? shareGate({ plan }, itemType) : { allowed: true };

  const onOpenChange = (o: boolean) => {
    setOpen(o);
    if (!o) { setResult(null); setGate(null); setCopied(false); }
  };

  const create = async () => {
    setBusy(true);
    setGate(null);
    try {
      const snap = typeof snapshot === 'function' ? snapshot() : snapshot ?? {};
      const r = await fetch('/api/shares', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ itemType, itemId, snapshot: snap, visibility, ...(title ? { title } : {}) }) });
      const j = await r.json().catch(() => ({}));
      if (r.status === 402) { setGate({ allowed: false, reason: j?.error?.message, upgradeTo: j?.error?.details?.upgradeTo }); return; }
      if (!r.ok) throw new Error(j?.error?.message ?? `HTTP ${r.status}`);
      const url = `${window.location.origin}${j.path}`;
      setResult({ token: j.token, url });
      onShared?.({ token: j.token, url });
      toast({ title: `${ITEM_LABEL[itemType]} shared`, description: visibility === 'link' ? 'Anyone with the link can view.' : 'Visible to your organisation in Shared.', variant: 'success' });
    } catch (e) {
      toast({ title: 'Could not share', description: (e as Error).message, variant: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast({ title: 'Copy failed', description: 'Select the link and copy it manually.', variant: 'error' });
    }
  };

  const effectiveGate = gate ?? (clientGate.allowed ? null : clientGate);

  return (
    <>
      <Button type="button" variant={variant} size={size} className={className} onClick={() => setOpen(true)} aria-haspopup="dialog">
        <Share2 aria-hidden /> {label}
      </Button>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Share {ITEM_LABEL[itemType].toLowerCase()}</DialogTitle>
            <DialogDescription>
              Colleagues see a frozen snapshot of exactly what you see now — question, sources, filters and holdings as of this moment.
            </DialogDescription>
          </DialogHeader>

          {effectiveGate && !effectiveGate.allowed ? (
            <UpgradeHint gate={effectiveGate} />
          ) : result ? (
            <div className="space-y-3">
              <Label htmlFor="share-url">Share link</Label>
              <div className="flex gap-2">
                <Input id="share-url" readOnly value={result.url} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
                <Button type="button" variant="secondary" onClick={copy} aria-label="Copy link">
                  {copied ? <Check aria-hidden /> : <Copy aria-hidden />} {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
              <p className="text-xs text-muted">
                {visibility === 'link' ? 'Anyone with this link can view (read-only). Commenting requires sign-in.' : 'Only signed-in members of your organisation can open this link.'}{' '}
                <Link href={`/shared/${result.token}`} className="text-info hover:underline">Open</Link>
              </p>
            </div>
          ) : (
            <fieldset className="space-y-2">
              <legend className="mb-1 text-xs font-medium text-muted">Who can view</legend>
              {([
                { v: 'org', icon: Users, title: 'My organisation', desc: 'Appears in the team Shared feed. Members can comment.' },
                { v: 'link', icon: Globe, title: 'Anyone with the link', desc: 'Read-only, works signed out. Also listed in the team feed.' },
              ] as const).map((o) => (
                <label key={o.v} className={cn('flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors focus-within:ring-2 focus-within:ring-info', visibility === o.v ? 'border-info bg-info/10' : 'border-border hover:bg-panel-2')}>
                  <input type="radio" name="share-visibility" value={o.v} checked={visibility === o.v} onChange={() => setVisibility(o.v)} className="sr-only" />
                  <o.icon className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden />
                  <span>
                    <span className="block text-sm font-medium">{o.title}</span>
                    <span className="block text-xs text-muted">{o.desc}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          )}

          <DialogFooter>
            {result ? (
              <Button type="button" onClick={() => onOpenChange(false)}>Done</Button>
            ) : (
              <>
                <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
                {!(effectiveGate && !effectiveGate.allowed) && (
                  <Button type="button" onClick={create} disabled={busy}>
                    <Link2 aria-hidden /> {busy ? 'Creating…' : 'Create link'}
                  </Button>
                )}
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
