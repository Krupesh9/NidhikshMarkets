'use client';
import * as React from 'react';
import Link from 'next/link';
import { Bot, Briefcase, Building2, FileText, Globe, Layers, MessageSquare, Share2, SlidersHorizontal, Users, type LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { relTime } from './CommentThread';
import { ITEM_LABEL, SHARE_ITEM_TYPES, type ShareItemType } from './snapshot';

export interface FeedCard {
  id: string; token: string; itemType: ShareItemType; title: string; visibility: 'org' | 'link'; createdAt: string;
  createdById: string; createdByName: string; commentCount: number; isMock: boolean;
  preview: { text: string; tickers: string[]; stats: string[] };
}

export const TYPE_ICON: Record<ShareItemType, LucideIcon> = { note: FileText, screen: SlidersHorizontal, portfolio: Briefcase, basket: Layers, thread: Bot, company: Building2 };

export function ShareCard({ c, compact }: { c: FeedCard; compact?: boolean }) {
  const Icon = TYPE_ICON[c.itemType];
  return (
    <Link href={`/shared/${c.token}`} className="group block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info">
      <Card className={cn('h-full transition-colors group-hover:border-info/50', compact ? 'p-3' : 'p-4')}>
        <div className="flex items-start gap-3">
          <span className="mt-0.5 rounded-md bg-panel-2 p-1.5 text-info"><Icon className="h-4 w-4" aria-hidden /></span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
              <span className="font-medium uppercase tracking-wide">{ITEM_LABEL[c.itemType]}</span>
              <span aria-hidden>·</span>
              <span>{c.createdByName}</span>
              <span aria-hidden>·</span>
              <time dateTime={c.createdAt} title={new Date(c.createdAt).toLocaleString()}>{relTime(c.createdAt)}</time>
              {c.visibility === 'link' ? <Globe className="h-3 w-3" aria-label="Link share" /> : <Users className="h-3 w-3" aria-label="Organisation share" />}
            </div>
            <h3 className="mt-0.5 truncate text-sm font-semibold group-hover:text-info">{c.title}</h3>
            {!compact && c.preview.text && <p className="mt-1 line-clamp-2 text-xs text-muted">{c.preview.text}</p>}
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {c.preview.tickers.slice(0, compact ? 3 : 6).map((t) => <Badge key={t} variant="info" className="font-mono">{t}</Badge>)}
              {!compact && c.preview.stats.map((s) => <Badge key={s} variant="outline">{s}</Badge>)}
              {c.isMock && <Badge variant="warn">demo data</Badge>}
              <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted"><MessageSquare className="h-3 w-3" aria-hidden /> {c.commentCount}</span>
            </div>
          </div>
        </div>
      </Card>
    </Link>
  );
}

export function SharedFeed({ items, members, meId }: { items: FeedCard[]; members: { id: string; name: string }[]; meId: string }) {
  const [type, setType] = React.useState<'all' | ShareItemType>('all');
  const [author, setAuthor] = React.useState<string>('all');
  const counts = React.useMemo(() => Object.fromEntries(SHARE_ITEM_TYPES.map((t) => [t, items.filter((i) => i.itemType === t).length])), [items]);
  const shown = items.filter((i) => (type === 'all' || i.itemType === type) && (author === 'all' || i.createdById === author));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Filter by type" className="flex flex-wrap gap-1 rounded-md border border-border bg-panel p-1">
          {(['all', ...SHARE_ITEM_TYPES] as const).map((t) => (
            <button
              key={t} role="tab" aria-selected={type === t} onClick={() => setType(t)}
              className={cn('rounded px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info', type === t ? 'bg-panel-2 text-text' : 'text-muted hover:text-text')}
            >
              {t === 'all' ? `All (${items.length})` : `${ITEM_LABEL[t]}s (${counts[t]})`}
            </button>
          ))}
        </div>
        <Select value={author} onValueChange={setAuthor}>
          <SelectTrigger className="h-9 w-48" aria-label="Filter by author"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All authors</SelectItem>
            <SelectItem value={meId}>Shared by me</SelectItem>
            {members.filter((m) => m.id !== meId).map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {shown.length ? (
        <div className="grid gap-3 md:grid-cols-2">{shown.map((c) => <ShareCard key={c.id} c={c} />)}</div>
      ) : items.length ? (
        <EmptyState icon={Share2} title="Nothing matches these filters" description="Try another type or author." action={<Button size="sm" variant="secondary" onClick={() => { setType('all'); setAuthor('all'); }}>Clear filters</Button>} />
      ) : (
        <EmptyState
          icon={Share2}
          title="No shared research yet"
          description="Share an AI research note, a screen, a portfolio or a basket with the Share button — colleagues see a frozen snapshot with sources and can comment."
          action={<Button asChild size="sm"><Link href="/research">Start a research question</Link></Button>}
        />
      )}
    </div>
  );
}
