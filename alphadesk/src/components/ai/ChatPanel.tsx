'use client';
import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bot, Maximize2 } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Kbd } from '@/components/ui/kbd';
import { Conversation } from './Conversation';

/** Event other screens dispatch to prefill the chat (after useShell().openChat()). The input is prefilled, never auto-sent. */
export const CHAT_PREFILL_EVENT = 'nidhiksh:chat-prefill';
export interface ChatPrefillDetail { prompt: string; ticker?: string; context?: unknown }

function tickerFromPath(path: string | null): string | undefined {
  const m = path?.match(/^\/company\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]).toUpperCase() : undefined;
}

/**
 * Global AI research chat slide-over (⌘J / topbar button, from every screen).
 * Keep the export name and props: ChatPanel({ open, onOpenChange }).
 * The active thread id survives close/reopen (the conversation reloads from the server).
 */
export function ChatPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const pathname = usePathname();
  const [threadId, setThreadId] = React.useState<string | null>(null);
  const [prefill, setPrefill] = React.useState<{ prompt: string; ticker?: string; nonce: number } | null>(null);
  const [prefillTicker, setPrefillTicker] = React.useState<string | undefined>();
  const pathTicker = tickerFromPath(pathname);

  // a ticker supplied by "Ask AI" applies until the user navigates elsewhere
  React.useEffect(() => setPrefillTicker(undefined), [pathname]);

  React.useEffect(() => {
    const onPrefill = (e: Event) => {
      const d = (e as CustomEvent<ChatPrefillDetail>).detail;
      if (!d || typeof d.prompt !== 'string') return;
      const t = typeof d.ticker === 'string' && d.ticker.trim() ? d.ticker.trim().toUpperCase() : undefined;
      setPrefill({ prompt: d.prompt.slice(0, 4000), ticker: t, nonce: Date.now() });
      if (t) setPrefillTicker(t);
      onOpenChange(true);
    };
    window.addEventListener(CHAT_PREFILL_EVENT, onPrefill);
    return () => window.removeEventListener(CHAT_PREFILL_EVENT, onPrefill);
  }, [onOpenChange]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="py-3">
          <SheetTitle className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-accent" aria-hidden /> AI research <Kbd className="ml-1">⌘J</Kbd>
          </SheetTitle>
          <SheetDescription className="flex items-center gap-2">
            <span>Ask about any company, screen or portfolio. Every number is cited.</span>
            <Link
              href={threadId ? `/research/${threadId}` : '/research'}
              onClick={() => onOpenChange(false)}
              className="ml-auto inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-info hover:bg-panel-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info"
            >
              <Maximize2 className="h-3 w-3" aria-hidden /> Full page
            </Link>
          </SheetDescription>
        </SheetHeader>
        <Conversation
          variant="panel"
          threadId={threadId}
          onThread={setThreadId}
          onNewThread={() => setThreadId(null)}
          contextTicker={prefillTicker ?? pathTicker}
          prefill={prefill}
          onPrefillConsumed={() => setPrefill(null)}
        />
      </SheetContent>
    </Sheet>
  );
}
