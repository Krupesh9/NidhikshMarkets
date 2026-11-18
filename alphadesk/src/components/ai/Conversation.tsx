'use client';
import * as React from 'react';
import { AlertTriangle, ArrowUp, Bot, Check, CircleDashed, Copy, FileText, Loader2, Plus, Sparkles, Square, X, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { MockBanner } from '@/components/shell/MockBanner';
import { UpgradeHint } from '@/components/shell/UpgradeHint';
import { useRightRail } from '@/components/shell/RightRail';
import { useCurrentUser } from '@/components/shell/UserContext';
import { referencedCitations } from '@/lib/ai/citations';
import { DISCLAIMER, type Citation } from '@/lib/ai/types';
import type { Plan } from '@/lib/plans';
import { cn } from '@/lib/utils';
import { ShareButton } from '@/components/sharing/ShareButton';
import { BlockView } from './blocks';
import { CitationCtx, CitationDetail } from './citation';
import { Markdown } from './Markdown';
import { useResearchChat, type AiStatus, type UIMessage } from './useResearchChat';

export interface ConversationProps {
  variant: 'panel' | 'page';
  threadId?: string | null;
  onThread?: (id: string) => void;
  onDone?: () => void;
  /** ticker of the page the user is on (company page) */
  contextTicker?: string;
  /** external prefill (e.g. "Ask AI" from the company page); nonce changes per request */
  prefill?: { prompt: string; ticker?: string; nonce: number } | null;
  onPrefillConsumed?: () => void;
  /** called when the user starts a new thread */
  onNewThread?: () => void;
  className?: string;
}

const BASE_PROMPTS = [
  'Compare Apple and Microsoft on revenue growth, margins, and AI exposure over the last five years',
  'Which Information Technology companies show the most AI exposure in recent filings and calls?',
  'Find cheap Health Care stocks with upward estimate revisions',
  'What is the risk profile of my portfolio?',
];

function prompts(ticker?: string): string[] {
  if (!ticker) return BASE_PROMPTS;
  return [
    `Give me a research snapshot of ${ticker}: margins, growth and what management said on the last call`,
    `Compare ${ticker} with its closest peer on revenue growth and operating margin over 5 years`,
    `What are the key risks in ${ticker}'s latest 10-K?`,
    BASE_PROMPTS[0],
  ];
}

function UsageLine({ status }: { status: AiStatus | null }) {
  if (!status) return <Skeleton className="h-4 w-40" />;
  const u = status.usage;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] text-muted">
      <Badge variant={status.isMock ? 'warn' : 'info'} title={`Model: ${status.model}`}>{status.label}</Badge>
      <span className="truncate font-mono">{status.model}</span>
      <span aria-hidden>·</span>
      <span>{!status.gate.allowed && u.limit === 0 ? 'AI not included on your plan' : u.limit == null ? `${u.used} queries this month · unlimited` : `${u.remaining} of ${u.limit} AI queries left`}</span>
    </div>
  );
}

function Steps({ m }: { m: UIMessage }) {
  if (!m.steps.length) return null;
  return (
    <ul className="mb-2 space-y-1" aria-label="Research steps">
      {m.steps.map((s) => (
        <li key={s.id} className="flex items-center gap-1.5 text-[11px] text-muted">
          {s.status === 'start' ? <Loader2 className="h-3 w-3 animate-spin text-info" aria-hidden /> : s.status === 'done' ? <Check className="h-3 w-3 text-up" aria-hidden /> : <XCircle className="h-3 w-3 text-down" aria-hidden />}
          <span className={cn(s.status === 'start' && 'text-text')}>{s.label.replace(/…$/, s.status === 'start' ? '…' : '')}</span>
          {s.summary && s.status !== 'start' && <span className="text-muted/80">— {s.summary}</span>}
        </li>
      ))}
    </ul>
  );
}

function SourcesList({ m }: { m: UIMessage }) {
  const { open } = React.useContext(CitationCtx);
  const used = referencedCitations(m.content, m.citations);
  const other = m.citations.filter((c) => !used.includes(c));
  if (!m.citations.length) return null;
  const Item = ({ c }: { c: Citation }) => (
    <li>
      <button type="button" onClick={() => open(c.n, '')} className="flex w-full items-start gap-1.5 rounded px-1 py-0.5 text-left text-[11px] text-muted hover:bg-panel-2 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info">
        <span className="mt-px font-mono text-info">[{c.n}]</span>
        <span className="min-w-0 flex-1 truncate">{c.name}{c.locator ? ` · ${c.locator}` : ''}</span>
        {(c.kind === 'mock' || c.id.startsWith('mock:') || / \(simulated/.test(c.name)) && <span className="shrink-0 text-warn">demo</span>}
      </button>
    </li>
  );
  return (
    <details className="mt-3 rounded-md border border-border/70 bg-panel-2/30 px-2 py-1.5" open={used.length > 0 && used.length <= 6}>
      <summary className="cursor-pointer select-none text-[11px] font-medium text-muted">
        Sources ({used.length} cited{other.length ? `, ${other.length} also consulted` : ''})
      </summary>
      <ul className="mt-1 space-y-0.5">
        {used.map((c) => <Item key={c.n} c={c} />)}
        {other.length > 0 && <li className="px-1 pt-1 text-[10px] uppercase tracking-wide text-muted/70">Also consulted</li>}
        {other.map((c) => <Item key={c.n} c={c} />)}
      </ul>
    </details>
  );
}

function AssistantMessage({ m, threadId, onSaved, variant }: { m: UIMessage; threadId: string | null; onSaved: (id: string, noteId: string) => void; variant: 'panel' | 'page' }) {
  const [saving, setSaving] = React.useState<'note' | null>(null);
  const [active, setActive] = React.useState<number | null>(null);
  const waiting = m.streaming && !m.content;

  const save = async (): Promise<string | null> => {
    if (m.noteId) return m.noteId;
    const r = await fetch('/api/ai/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        question: m.question ?? 'Research question',
        answerMarkdown: m.content,
        citations: m.citations,
        structured: { blocks: m.blocks, isMock: !!m.isMock, provider: m.provider, model: m.model },
        tickers: Array.from(new Set((m.question ?? '').match(/\b[A-Z]{2,5}\b/g) ?? [])).slice(0, 10),
        threadId: threadId ?? undefined,
        messageId: m.id,
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j?.error?.message ?? 'Could not save note');
    onSaved(m.id, j.note.id);
    return j.note.id as string;
  };

  const onSave = async () => {
    setSaving('note');
    try {
      await save();
      toast({ title: 'Saved as research note', description: 'Find it under Shared notes, or share it with your team.', variant: 'success' });
    } catch (e) {
      toast({ title: 'Save failed', description: (e as Error).message, variant: 'error' });
    } finally {
      setSaving(null);
    }
  };

  const copy = () => {
    navigator.clipboard?.writeText(m.content).then(() => toast({ title: 'Answer copied as markdown', variant: 'success' })).catch(() => {});
  };

  const ctx = React.useContext(CitationCtx);
  const local = React.useMemo(
    () => ({ citations: m.citations, active, open: (n: number, sentence: string) => { setActive(n); ctx.open(n, sentence, m.citations); } }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [m.citations, active, ctx.open],
  );

  return (
    <div className="flex gap-2.5">
      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent"><Bot className="h-3.5 w-3.5" aria-hidden /></div>
      <div className="min-w-0 flex-1">
        <Steps m={m} />
        {waiting && (
          <div className="space-y-2" role="status" aria-label="Researching">
            {!m.steps.length && <p className="flex items-center gap-1.5 text-[11px] text-muted"><CircleDashed className="h-3 w-3 animate-spin" aria-hidden /> Planning research…</p>}
            <Skeleton className="h-3.5 w-11/12" />
            <Skeleton className="h-3.5 w-9/12" />
            <Skeleton className="h-3.5 w-10/12" />
          </div>
        )}
        <CitationCtx.Provider value={local}>
          {m.content && <Markdown text={m.content} streaming={m.streaming} />}
          {m.blocks.map((b, i) => <BlockView key={i} block={b} />)}
          {!m.streaming && <SourcesList m={m} />}
        </CitationCtx.Provider>
        {m.gate && <UpgradeHint reason={m.gate.reason} upgradeTo={m.gate.upgradeTo as Plan | undefined} className="mt-1" />}
        {m.error && (
          <p className="mt-1 flex items-start gap-1.5 rounded-md border border-down/30 bg-down/10 px-2.5 py-1.5 text-xs text-down">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {m.error}
          </p>
        )}
        {!m.streaming && m.content && !m.gate && (
          <div className="mt-2 flex flex-wrap items-center gap-1">
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onSave} disabled={!!saving || !!m.noteId}>
              {saving === 'note' ? <Loader2 className="animate-spin" /> : m.noteId ? <Check /> : <FileText />} {m.noteId ? 'Saved' : 'Save as note'}
            </Button>
            {m.noteId ? (
              <ShareButton itemType="note" itemId={m.noteId} variant="ghost" className="h-7 px-2 text-xs" snapshot={m.isMock ? { isMock: true } : undefined} />
            ) : (
              <ShareButton
                itemType="note"
                itemId={`adhoc:${m.id}`}
                variant="ghost"
                className="h-7 px-2 text-xs"
                title={(m.question ?? 'Research answer').slice(0, 200)}
                snapshot={{ question: m.question ?? '', answerMarkdown: m.content, sources: m.citations, structured: { blocks: m.blocks }, isMock: !!m.isMock, provider: m.provider, model: m.model }}
              />
            )}
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={copy} aria-label="Copy answer"><Copy /> Copy</Button>
            {m.provider && (
              <span className={cn('ml-auto text-[10px] text-muted', variant === 'panel' && 'w-full text-right sm:w-auto')}>
                {m.provider === 'mock' ? 'Mock analyst' : m.provider === 'anthropic' ? 'Claude' : 'Gemini'} · <span className="font-mono">{m.model}</span>
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function Conversation({ variant, threadId: initialThread, onThread, onDone, contextTicker, prefill, onPrefillConsumed, onNewThread, className }: ConversationProps) {
  const rail = useRightRail();
  const { refresh } = useCurrentUser();
  const chat = useResearchChat({
    threadId: initialThread,
    onThread,
    onDone: () => {
      refresh();
      onDone?.();
    },
  });
  const [input, setInput] = React.useState('');
  const [ticker, setTicker] = React.useState<string | undefined>(contextTicker);
  const [pane, setPane] = React.useState<{ c: Citation; sentence: string } | null>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);
  const stick = React.useRef(true);

  React.useEffect(() => setTicker(contextTicker), [contextTicker]);

  React.useEffect(() => {
    if (!prefill) return;
    setInput(prefill.prompt);
    if (prefill.ticker) setTicker(prefill.ticker.toUpperCase());
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(prefill.prompt.length, prefill.prompt.length);
    });
    onPrefillConsumed?.();
  }, [prefill]); // eslint-disable-line react-hooks/exhaustive-deps

  // autoscroll while streaming unless the user scrolled up
  React.useEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [chat.messages]);
  const onScroll = () => {
    const el = listRef.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const openCitation = React.useCallback(
    (n: number, sentence: string, list?: Citation[]) => {
      const c = (list ?? []).find((x) => x.n === n);
      if (!c) return;
      if (variant === 'page') rail.open({ title: `Source [${n}]`, content: <CitationDetail citation={c} sentence={sentence} />, key: `cite:${c.id}:${sentence.slice(0, 40)}` });
      else setPane({ c, sentence });
    },
    [variant, rail],
  );
  const citeApi = React.useMemo(() => ({ citations: [] as Citation[], open: openCitation }), [openCitation]);

  const submit = (text?: string) => {
    const q = (text ?? input).trim();
    if (!q || chat.busy) return;
    stick.current = true;
    setInput('');
    void chat.send(q, { ticker, route: typeof window !== 'undefined' ? window.location.pathname : undefined });
  };

  const anyMock = chat.status?.isMock || chat.messages.some((m) => m.isMock);
  const gate = chat.status?.gate;

  return (
    <div className={cn('relative flex min-h-0 flex-1 flex-col', className)}>
      <div className="flex items-center gap-2 border-b border-border px-4 py-2">
        <UsageLine status={chat.status} />
        {variant === 'panel' && chat.messages.length > 0 && (
          <Button size="sm" variant="ghost" className="ml-auto h-7 px-2 text-xs" onClick={() => { chat.reset(); setPane(null); onNewThread?.(); }}>
            <Plus /> New
          </Button>
        )}
      </div>
      {anyMock && (
        <MockBanner className="mx-4 mt-2" isMock>
          <strong className="font-semibold">Demo mode.</strong> {chat.status?.isMock ? 'No AI key configured — the Mock analyst parses your question, calls the same research tools and writes a templated answer.' : 'Some cited figures come from simulated data.'} Add an Anthropic or Gemini key in Settings for a live model.
        </MockBanner>
      )}

      <CitationCtx.Provider value={citeApi}>
        <div ref={listRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-4 py-4 scrollbar-thin" aria-live="polite">
          {chat.loadingThread ? (
            <div className="space-y-3" role="status" aria-label="Loading thread">
              <Skeleton className="ml-auto h-8 w-2/3" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="ml-auto h-8 w-1/2" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : chat.messages.length === 0 ? (
            <div className="mx-auto flex max-w-xl flex-col items-center gap-3 py-6 text-center">
              <div className="rounded-full bg-accent/15 p-2.5 text-accent"><Sparkles className="h-5 w-5" aria-hidden /></div>
              <div>
                <p className="text-sm font-medium">Ask a research question</p>
                <p className="mt-0.5 text-xs text-muted">Answers pull filings, transcripts, estimates and news, and cite every number. {ticker ? `Context: ${ticker}.` : ''}</p>
              </div>
              <div className="grid w-full gap-1.5">
                {prompts(ticker).map((p) => (
                  <button key={p} type="button" onClick={() => submit(p)} disabled={chat.busy}
                    className="rounded-md border border-border bg-panel-2/40 px-3 py-2 text-left text-xs text-text/90 transition-colors hover:border-info/40 hover:bg-panel-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info">
                    {p}
                  </button>
                ))}
              </div>
              {gate && !gate.allowed && <UpgradeHint reason={gate.reason ?? undefined} upgradeTo={(gate.upgradeTo ?? undefined) as Plan | undefined} className="w-full text-left" />}
            </div>
          ) : (
            <div className={cn('space-y-5', variant === 'page' && 'mx-auto max-w-3xl')}>
              {chat.messages.map((m) =>
                m.role === 'user' ? (
                  <div key={m.id} className="flex justify-end">
                    <div className="max-w-[85%] whitespace-pre-wrap rounded-lg rounded-br-sm bg-info/15 px-3 py-2 text-[13px] text-text">{m.content}</div>
                  </div>
                ) : (
                  <AssistantMessage key={m.id} m={m} threadId={chat.threadId} onSaved={chat.markSaved} variant={variant} />
                ),
              )}
            </div>
          )}
        </div>
      </CitationCtx.Provider>

      {pane && (
        <div className="absolute inset-x-0 bottom-0 z-10 max-h-[60%] overflow-y-auto border-t border-border bg-panel p-4 shadow-2xl scrollbar-thin" role="dialog" aria-label={`Source ${pane.c.n}`}>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold">Source [{pane.c.n}]</span>
            <button type="button" onClick={() => setPane(null)} className="rounded p-1 text-muted hover:bg-panel-2 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info" aria-label="Close source">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <CitationDetail citation={pane.c} sentence={pane.sentence} />
        </div>
      )}

      <form
        className="border-t border-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {gate && !gate.allowed && chat.messages.length > 0 && <UpgradeHint compact reason={gate.reason ?? undefined} upgradeTo={(gate.upgradeTo ?? undefined) as Plan | undefined} className="mb-2" />}
        <div className={cn('flex items-end gap-2 rounded-lg border border-border bg-panel-2/50 p-2 focus-within:border-info/60 focus-within:ring-1 focus-within:ring-info/40', variant === 'page' && 'mx-auto max-w-3xl')}>
          <div className="min-w-0 flex-1">
            {ticker && (
              <span className="mb-1 inline-flex items-center gap-1 rounded bg-info/10 px-1.5 py-0.5 text-[10px] font-medium text-info">
                Context: {ticker}
                <button type="button" onClick={() => setTicker(undefined)} aria-label="Remove ticker context" className="hover:text-text"><X className="h-2.5 w-2.5" /></button>
              </span>
            )}
            <label htmlFor={`ai-input-${variant}`} className="sr-only">Research question</label>
            <textarea
              id={`ai-input-${variant}`}
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  submit();
                }
              }}
              rows={variant === 'page' ? 2 : 2}
              maxLength={4000}
              placeholder={ticker ? `Ask about ${ticker}, or compare it with peers…` : 'Ask about companies, screens, themes or your portfolio…'}
              className="block max-h-40 min-h-[40px] w-full resize-none bg-transparent text-[13px] text-text placeholder:text-muted focus:outline-none"
            />
          </div>
          {chat.busy ? (
            <Button type="button" size="icon-sm" variant="secondary" onClick={chat.stop} aria-label="Stop generating"><Square /></Button>
          ) : (
            <Button type="submit" size="icon-sm" variant="default" disabled={!input.trim()} aria-label="Send"><ArrowUp /></Button>
          )}
        </div>
        <p className={cn('mt-1.5 text-center text-[10px] text-muted', variant === 'page' && 'mx-auto max-w-3xl')}>{DISCLAIMER} AI answers can be wrong — verify cited sources.</p>
      </form>
    </div>
  );
}
