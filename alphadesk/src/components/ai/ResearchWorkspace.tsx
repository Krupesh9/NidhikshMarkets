'use client';
import * as React from 'react';
import Link from 'next/link';
import { MessageSquare, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { Conversation } from './Conversation';

interface ThreadRow { id: string; title: string; tickers: string[]; updatedAt: string }

function ago(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function ThreadList({ threads, activeId, loading, onDelete }: { threads: ThreadRow[] | null; activeId: string | null; loading: boolean; onDelete: (id: string) => void }) {
  if (loading && !threads) {
    return <div className="space-y-2 p-2" role="status" aria-label="Loading threads">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>;
  }
  if (!threads?.length) {
    return <p className="p-3 text-xs text-muted">No threads yet. Ask a question to start one — it is saved here automatically.</p>;
  }
  return (
    <ul className="space-y-0.5 p-1.5">
      {threads.map((t) => (
        <li key={t.id} className="group relative">
          <Link
            href={`/research/${t.id}`}
            aria-current={t.id === activeId ? 'page' : undefined}
            className={cn('block rounded-md px-2.5 py-2 pr-8 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info', t.id === activeId ? 'bg-panel-2 text-text' : 'text-muted hover:bg-panel-2/60 hover:text-text')}
          >
            <span className="line-clamp-2 leading-snug">{t.title}</span>
            <span className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted">
              {t.tickers.slice(0, 3).map((x) => <span key={x} className="font-mono text-info">{x}</span>)}
              <span>{ago(t.updatedAt)}</span>
            </span>
          </Link>
          <button
            type="button"
            onClick={() => onDelete(t.id)}
            className="absolute right-1.5 top-2 rounded p-1 text-muted opacity-0 hover:bg-down/15 hover:text-down focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info group-hover:opacity-100"
            aria-label={`Delete thread ${t.title}`}
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** /research and /research/[threadId]: thread sidebar + full-width conversation (citations open in the right rail). */
export function ResearchWorkspace({ threadId: initial }: { threadId?: string }) {
  const [threads, setThreads] = React.useState<ThreadRow[] | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [active, setActive] = React.useState<string | null>(initial ?? null);

  const loadThreads = React.useCallback(async () => {
    try {
      const r = await fetch('/api/ai/threads', { cache: 'no-store' });
      if (r.ok) setThreads((await r.json()).threads);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, []);
  React.useEffect(() => { void loadThreads(); }, [loadThreads]);

  const onThread = React.useCallback((id: string) => {
    setActive(id);
    // update the URL without remounting the page mid-stream
    try { window.history.replaceState(window.history.state, '', `/research/${id}`); } catch { /* ignore */ }
    void loadThreads();
  }, [loadThreads]);

  const onDelete = async (id: string) => {
    const r = await fetch(`/api/ai/threads/${id}`, { method: 'DELETE' });
    if (!r.ok) return toast({ title: 'Could not delete thread', variant: 'error' });
    setThreads((ts) => ts?.filter((t) => t.id !== id) ?? null);
    toast({ title: 'Thread deleted' });
    if (id === active) window.location.assign('/research');
  };

  return (
    <div className="flex h-[calc(100dvh-8.5rem)] min-h-[480px] overflow-hidden rounded-lg border border-border bg-panel">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border md:flex" aria-label="Research threads">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="flex items-center gap-1.5 text-xs font-semibold"><MessageSquare className="h-3.5 w-3.5 text-muted" aria-hidden /> Threads</span>
          <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-xs">
            <Link href="/research"><Plus /> New</Link>
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
          <ThreadList threads={threads} activeId={active} loading={loading} onDelete={onDelete} />
        </div>
      </aside>
      <Conversation key={initial ?? 'new'} variant="page" threadId={initial ?? null} onThread={onThread} onDone={loadThreads} />
    </div>
  );
}
