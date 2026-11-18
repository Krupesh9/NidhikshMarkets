'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Command } from 'cmdk';
import { Building2, CornerDownLeft } from 'lucide-react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { NAV } from '@/config/nav';
import type { UniverseItem } from '@/lib/data/types';

let universeCache: UniverseItem[] | null = null;

/** ⌘K palette: ticker search over universe → /company/[ticker], plus navigation commands. */
export function CommandMenu({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const [items, setItems] = React.useState<UniverseItem[]>(universeCache ?? []);
  const [q, setQ] = React.useState('');
  React.useEffect(() => {
    if (!open || universeCache) return;
    fetch('/api/market/universe').then((r) => r.json()).then((j) => { universeCache = j.data; setItems(j.data); }).catch(() => {});
  }, [open]);
  React.useEffect(() => { if (!open) setQ(''); }, [open]);
  const go = (href: string) => { onOpenChange(false); router.push(href); };
  const typed = q.trim().toUpperCase();
  const exact = /^[A-Z][A-Z0-9.\-]{0,9}$/.test(typed) && !items.some((i) => i.ticker === typed);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <DialogPrimitive.Content className="fixed left-1/2 top-[15vh] z-50 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-lg border border-border bg-panel shadow-2xl" aria-describedby={undefined}>
          <DialogPrimitive.Title className="sr-only">Search tickers and commands</DialogPrimitive.Title>
          <Command label="Search" className="flex flex-col" loop>
            <Command.Input value={q} onValueChange={setQ} autoFocus placeholder="Search ticker or company…  (e.g. NVDA, Lilly)" className="h-12 border-b border-border bg-transparent px-4 text-sm outline-none placeholder:text-muted" />
            <Command.List className="max-h-[360px] overflow-y-auto p-1 scrollbar-thin">
              <Command.Empty className="px-3 py-6 text-center text-sm text-muted">No matches. Try a ticker symbol.</Command.Empty>
              {exact && (
                <Command.Item value={`open ${typed}`} onSelect={() => go(`/company/${typed}`)} className="flex cursor-pointer items-center gap-2 rounded px-3 py-2 text-sm aria-selected:bg-panel-2">
                  <Building2 className="h-4 w-4 text-muted" /> Open <span className="font-mono">{typed}</span>
                </Command.Item>
              )}
              <Command.Group heading="Companies" className="px-1 text-[11px] text-muted [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5">
                {items.map((i) => (
                  <Command.Item key={i.ticker} value={`${i.ticker} ${i.name} ${i.sector}`} onSelect={() => go(`/company/${i.ticker}`)} className="flex cursor-pointer items-center gap-3 rounded px-3 py-2 text-sm text-text aria-selected:bg-panel-2">
                    <span className="w-14 font-mono font-semibold">{i.ticker}</span>
                    <span className="flex-1 truncate">{i.name}</span>
                    <span className="hidden text-[11px] text-muted sm:inline">{i.sector}</span>
                  </Command.Item>
                ))}
              </Command.Group>
              <Command.Group heading="Go to" className="px-1 text-[11px] text-muted [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5">
                {NAV.map((n) => (
                  <Command.Item key={n.href} value={`go ${n.label}`} onSelect={() => go(n.href)} className="flex cursor-pointer items-center gap-3 rounded px-3 py-2 text-sm text-text aria-selected:bg-panel-2">
                    <n.icon className="h-4 w-4 text-muted" /> {n.label}
                  </Command.Item>
                ))}
              </Command.Group>
            </Command.List>
            <div className="flex items-center gap-3 border-t border-border px-3 py-1.5 text-[11px] text-muted">
              <span className="inline-flex items-center gap-1"><CornerDownLeft className="h-3 w-3" /> open</span>
              <span>↑↓ navigate</span>
              <span>esc close</span>
            </div>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
