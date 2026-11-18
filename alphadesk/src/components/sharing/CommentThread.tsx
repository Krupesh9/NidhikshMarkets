'use client';
import * as React from 'react';
import Link from 'next/link';
import { MessageSquare, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { Inline } from './Markdown';
import { MAX_COMMENT_LEN } from './snapshot';

export interface CommentItem { id: string; authorId: string; authorName?: string; body: string; createdAt: string | Date }

export function relTime(d: string | Date): string {
  const t = new Date(d).getTime();
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const initials = (n?: string) => (n ?? '?').split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();

export function CommentThread({ shareId, token, initial, canComment, signedIn }: { shareId: string; token: string; initial: CommentItem[]; canComment: boolean; signedIn: boolean }) {
  const [comments, setComments] = React.useState(initial);
  const [body, setBody] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    try {
      const r = await fetch('/api/comments', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ shareId, body }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error?.message ?? `HTTP ${r.status}`);
      setComments((c) => [...c, j.comment]);
      setBody('');
    } catch (err) {
      toast({ title: 'Comment not posted', description: (err as Error).message, variant: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="comments-h" className="space-y-3">
      <h2 id="comments-h" className="flex items-center gap-2 text-sm font-semibold">
        <MessageSquare className="h-4 w-4 text-muted" aria-hidden /> Discussion <span className="font-normal text-muted">({comments.length})</span>
      </h2>
      {comments.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted">No comments yet.{canComment ? ' Start the discussion — ask a question or add a counterpoint.' : ''}</p>
      ) : (
        <ol className="space-y-2">
          {comments.map((c) => (
            <li key={c.id} className="flex gap-3 rounded-md border border-border bg-panel p-3">
              <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-panel-2 text-[11px] font-semibold text-muted">{initials(c.authorName)}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-2 text-xs">
                  <span className="font-medium text-text">{c.authorName ?? 'Unknown'}</span>
                  <time dateTime={new Date(c.createdAt).toISOString()} className="text-muted" title={new Date(c.createdAt).toLocaleString()}>{relTime(c.createdAt)}</time>
                </div>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm"><Inline text={c.body} /></p>
              </div>
            </li>
          ))}
        </ol>
      )}
      {canComment ? (
        <form onSubmit={submit} className="space-y-2">
          <label htmlFor="comment-body" className="sr-only">Add a comment</label>
          <Textarea
            id="comment-body" value={body} maxLength={MAX_COMMENT_LEN} onChange={(e) => setBody(e.target.value)} placeholder="Add a comment… (**bold**, `code`, links supported)" rows={3}
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit(e); }}
          />
          <div className="flex items-center justify-between text-[11px] text-muted">
            <span>⌘/Ctrl + Enter to post</span>
            <Button type="submit" size="sm" disabled={busy || !body.trim()}><Send aria-hidden /> {busy ? 'Posting…' : 'Comment'}</Button>
          </div>
        </form>
      ) : signedIn ? (
        <p className="text-xs text-muted">Only members of the sharing organisation can comment.</p>
      ) : (
        <p className="text-xs text-muted">
          <Link href={`/login?callbackUrl=${encodeURIComponent(`/shared/${token}`)}`} className="text-info hover:underline">Sign in</Link> to join the discussion.
        </p>
      )}
    </section>
  );
}
