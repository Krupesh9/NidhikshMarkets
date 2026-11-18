'use client';
/** Client body of /shared/[token]: provides its own right rail (the page lives outside the app shell). */
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Clock, Globe, Trash2, Users } from 'lucide-react';
import { RightRail, RightRailProvider } from '@/components/shell/RightRail';
import { MockBanner } from '@/components/shell/MockBanner';
import { Logo } from '@/components/shell/Logo';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Toaster, toast } from '@/components/ui/toast';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SnapshotView } from './SnapshotView';
import { CommentThread, relTime, type CommentItem } from './CommentThread';
import { ITEM_LABEL, type ShareItemType } from './snapshot';

export interface SharedItemProps {
  share: { id: string; token: string; itemType: ShareItemType; itemId: string; title: string; snapshot: Record<string, unknown>; createdByName?: string; visibility: 'org' | 'link'; createdAt: string; expiresAt: string | null };
  comments: CommentItem[];
  viewer: { signedIn: boolean; canComment: boolean; canDelete: boolean; name?: string };
}

const ORIGINAL_HREF: Partial<Record<ShareItemType, (id: string) => string>> = {
  portfolio: (id) => `/portfolios/${id}`,
  basket: (id) => `/baskets/${id}`,
  thread: (id) => `/research/${id}`,
  screen: (id) => `/screener?screen=${id}`,
  note: () => `/research`,
  company: (id) => `/company/${encodeURIComponent(id)}`,
};

export function SharedItemPage({ share, comments, viewer }: SharedItemProps) {
  const router = useRouter();
  const [revoking, setRevoking] = React.useState(false);
  const s = share.snapshot;
  const captured = typeof s.capturedAt === 'string' ? s.capturedAt : share.createdAt;
  const tickers = Array.isArray(s.tickers) ? (s.tickers as string[]) : [];

  const revoke = async () => {
    if (!window.confirm('Revoke this share? The link will stop working for everyone.')) return;
    setRevoking(true);
    try {
      const r = await fetch(`/api/shares/${encodeURIComponent(share.token)}`, { method: 'DELETE' });
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error?.message ?? `HTTP ${r.status}`);
      toast({ title: 'Share revoked', variant: 'success' });
      router.push('/shared');
    } catch (e) {
      toast({ title: 'Could not revoke', description: (e as Error).message, variant: 'error' });
      setRevoking(false);
    }
  };

  const original = !share.itemId.startsWith('adhoc') && viewer.canComment ? ORIGINAL_HREF[share.itemType]?.(share.itemId) : undefined;

  return (
    <TooltipProvider delayDuration={250}>
      <RightRailProvider>
        <div className="flex min-h-screen">
          <div className="min-w-0 flex-1">
            <header className="sticky top-0 z-20 flex h-12 items-center justify-between gap-3 border-b border-border bg-bg/90 px-4 backdrop-blur">
              <Link href={viewer.signedIn ? '/dashboard' : '/login'} aria-label="Nidhiksh Pulse home"><Logo /></Link>
              {viewer.signedIn ? (
                <Link href="/shared" className="inline-flex items-center gap-1 text-xs text-muted hover:text-text"><ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Team feed</Link>
              ) : (
                <Button asChild size="sm" variant="secondary"><Link href={`/login?callbackUrl=${encodeURIComponent(`/shared/${share.token}`)}`}>Sign in</Link></Button>
              )}
            </header>
            <main id="main" className="mx-auto max-w-4xl space-y-4 px-4 py-6">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="accent">{ITEM_LABEL[share.itemType]}</Badge>
                  <Badge variant="outline">
                    {share.visibility === 'link' ? <><Globe className="h-3 w-3" aria-hidden /> Anyone with link</> : <><Users className="h-3 w-3" aria-hidden /> Organisation</>}
                  </Badge>
                  <Badge variant="outline">Read-only snapshot</Badge>
                  {tickers.slice(0, 8).map((t) => <Badge key={t} variant="info" className="font-mono">{t}</Badge>)}
                </div>
                <h1 className="text-xl font-semibold tracking-tight">{share.title}</h1>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                  <span>Shared by <span className="text-text">{share.createdByName ?? 'a colleague'}</span> · {relTime(share.createdAt)}</span>
                  <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" aria-hidden /> Data as captured {new Date(captured).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                  {share.expiresAt && <span>Expires {new Date(share.expiresAt).toLocaleDateString()}</span>}
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  {original && <Button asChild size="sm" variant="secondary"><Link href={original}>Open live version</Link></Button>}
                  {viewer.canDelete && <Button size="sm" variant="ghost" onClick={revoke} disabled={revoking}><Trash2 aria-hidden /> {revoking ? 'Revoking…' : 'Revoke share'}</Button>}
                </div>
              </div>
              <MockBanner isMock={s.isMock === true} />
              <SnapshotView itemType={share.itemType} snapshot={s} />
              <p className="text-[11px] text-muted">Research only — not investment advice. Figures reflect the moment of capture and may be stale.</p>
              <div className="border-t border-border pt-4">
                <CommentThread shareId={share.id} token={share.token} initial={comments} canComment={viewer.canComment} signedIn={viewer.signedIn} />
              </div>
            </main>
          </div>
          <RightRail />
        </div>
        <Toaster />
      </RightRailProvider>
    </TooltipProvider>
  );
}
