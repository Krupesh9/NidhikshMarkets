'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Bot, Check, Plus, Share2 } from 'lucide-react';
import { ShareButton } from '@/components/sharing/ShareButton';
import { Button } from '@/components/ui/button';
import { Tip } from '@/components/ui/tooltip';
import { toast } from '@/components/ui/toast';
import { useShell } from '@/components/shell/AppShell';

/** Event other features (e.g. the AI ChatPanel) may listen to for a prefilled prompt. */
export const CHAT_PREFILL_EVENT = 'nidhiksh:chat-prefill';

export function HeaderActions({ ticker, name, canShare }: { ticker: string; name: string; canShare: boolean }) {
  const { openChat } = useShell();
  const router = useRouter();
  const [symbols, setSymbols] = React.useState<string[] | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    fetch('/api/watchlist', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { symbols: [] }))
      .then((j: { symbols?: string[] }) => alive && setSymbols(j.symbols ?? []))
      .catch(() => alive && setSymbols([]));
    return () => { alive = false; };
  }, []);

  const inList = !!symbols?.includes(ticker);

  const toggleWatch = async () => {
    if (!symbols) return;
    setBusy(true);
    const next = inList ? symbols.filter((s) => s !== ticker) : [...symbols, ticker];
    try {
      const r = await fetch('/api/watchlist', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ symbols: next }) });
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.error?.message ?? 'Could not update watchlist');
      const j = (await r.json()) as { symbols?: string[] };
      setSymbols(j.symbols ?? next);
      toast({ title: inList ? `Removed ${ticker} from watchlist` : `Added ${ticker} to watchlist`, variant: 'success' });
      router.refresh();
    } catch (e) {
      toast({ title: 'Watchlist not updated', description: (e as Error).message, variant: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const askAi = () => {
    const prompt = `Give me a research overview of ${name} (${ticker}): recent results vs consensus, estimate revisions, insider and institutional activity, upcoming catalysts and key risks. Cite sources.`;
    openChat();
    // ChatPanel (Agent B) can listen for this to prefill its input; harmless if nobody listens.
    window.setTimeout(() => window.dispatchEvent(new CustomEvent(CHAT_PREFILL_EVENT, { detail: { prompt, ticker, context: { type: 'company', ticker } } })), 50);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" onClick={askAi}>
        <Bot aria-hidden /> Ask AI about {ticker}
      </Button>
      <Button size="sm" variant="secondary" onClick={toggleWatch} disabled={!symbols || busy} aria-pressed={inList}>
        {inList ? <Check aria-hidden /> : <Plus aria-hidden />} {inList ? 'On watchlist' : 'Add to watchlist'}
      </Button>
      {canShare ? (
        <ShareButton itemType="company" itemId={ticker} title={`${ticker} · ${name}`} size="sm" variant="outline" />
      ) : (
        <Tip content="Sharing is available on Pro and above.">
          {/* span wrapper so the tooltip still fires on a disabled button */}
          <span tabIndex={0} className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info">
            <Button size="sm" variant="outline" disabled aria-disabled>
              <Share2 aria-hidden /> Share
            </Button>
          </span>
        </Tip>
      )}
    </div>
  );
}
