'use client';
import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Plus, Star, X } from 'lucide-react';
import { useQuotes } from '@/components/shell/useQuotes';
import { Delta } from '@/components/ui/delta';
import { CompanyLogo } from '@/components/ui/company-logo';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { cn, fmt } from '@/lib/utils';

const TICKER = /^[A-Z][A-Z0-9.\-]{0,9}$/;

export function WatchlistPane({ symbols: initial }: { symbols: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const [symbols, setSymbols] = React.useState(initial);
  const [draft, setDraft] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => setSymbols(initial), [initial]);
  const { quotes, loading } = useQuotes(symbols);
  const active = decodeURIComponent(pathname.split('/')[2] ?? '').toUpperCase();

  const save = async (next: string[], msg: string) => {
    setBusy(true);
    const prev = symbols;
    setSymbols(next);
    try {
      const r = await fetch('/api/watchlist', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ symbols: next }) });
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.error?.message ?? 'Could not update watchlist');
      toast({ title: msg, variant: 'success' });
      return true;
    } catch (e) {
      setSymbols(prev);
      toast({ title: 'Watchlist not updated', description: (e as Error).message, variant: 'error' });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = draft.trim().toUpperCase();
    if (!TICKER.test(t)) return toast({ title: 'Enter a ticker like AAPL', variant: 'error' });
    if (symbols.includes(t)) { setDraft(''); router.push(`/watchlist/${t}`); return; }
    if (await save([...symbols, t], `Added ${t}`)) { setDraft(''); router.push(`/watchlist/${t}`); router.refresh(); }
  };

  const remove = async (t: string) => {
    const next = symbols.filter((s) => s !== t);
    if (!(await save(next, `Removed ${t}`))) return;
    if (t === active) router.push(next[0] ? `/watchlist/${next[0]}` : '/watchlist');
    router.refresh();
  };

  return (
    <aside aria-label="Watchlist" className="w-full shrink-0 rounded-xl border border-border bg-panel shadow-sm shadow-black/10 lg:sticky lg:top-[7.5rem] lg:w-[25rem]">
      <div className="flex items-center justify-between border-b border-border px-4 py-3.5">
        <h1 className="flex items-center gap-1.5 text-sm font-semibold"><Star className="h-4 w-4 text-accent" aria-hidden /> Watchlist</h1>
        <span className="text-[11px] text-muted">{symbols.length} names</span>
      </div>
      <form onSubmit={add} className="flex gap-1.5 border-b border-border p-3">
        <label htmlFor="wl-add" className="sr-only">Add ticker</label>
        <input id="wl-add" value={draft} onChange={(e) => setDraft(e.target.value.toUpperCase())} placeholder="Add ticker…" autoComplete="off" spellCheck={false} maxLength={10}
          className="h-8 min-w-0 flex-1 rounded-md border border-border bg-panel-2 px-2 font-mono text-sm placeholder:font-sans placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info" />
        <button type="submit" disabled={busy || !draft.trim()} aria-label="Add to watchlist"
          className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-accent text-accent-foreground disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info">
          <Plus className="h-4 w-4" aria-hidden />
        </button>
      </form>
      {symbols.length === 0 ? (
        <p className="p-3 text-xs text-muted">No names yet. Add a ticker above.</p>
      ) : (
        <ul className="flex gap-1 overflow-x-auto p-2 scrollbar-thin lg:max-h-[calc(100vh-15rem)] lg:flex-col lg:overflow-y-auto lg:overflow-x-visible">
          {symbols.map((t) => {
            const q = quotes[t];
            const on = t === active;
            return (
              <li key={t} className="group relative shrink-0">
                <Link href={`/watchlist/${t}`} aria-current={on ? 'page' : undefined}
                  className={cn('flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors hover:bg-panel-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info lg:pr-8',
                    on && 'bg-accent/10 shadow-[inset_2px_0_0_rgb(var(--accent))]')}>
                  <CompanyLogo ticker={t} size={28} />
                  <span className={cn('font-mono font-semibold', on ? 'text-text' : 'text-info')}>{t}</span>
                  {loading && !q ? (
                    <Skeleton className="ml-auto h-4 w-24" />
                  ) : q ? (
                    <span className="ml-auto flex items-center gap-2.5">
                      <span className="min-w-[4.5rem] text-right font-mono tabular-nums">{fmt.price(q.price)}</span>
                      <Delta value={q.changePct} amount={q.change} badge className="text-xs" />
                    </span>
                  ) : (
                    <span className="ml-auto text-xs text-muted">—</span>
                  )}
                </Link>
                <button type="button" onClick={() => remove(t)} disabled={busy} aria-label={`Remove ${t} from watchlist`}
                  className="absolute right-1.5 top-1/2 hidden -translate-y-1/2 rounded p-1 text-muted opacity-0 hover:bg-border hover:text-text focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info group-hover:opacity-100 lg:block">
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
