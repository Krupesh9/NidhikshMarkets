'use client';
import * as React from 'react';
import type { ChatStreamEvent, Citation, ProviderId, StoredStructured, StructuredBlock, ToolStep, UsageInfo } from '@/lib/ai/types';

export interface UIMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations: Citation[];
  blocks: StructuredBlock[];
  steps: ToolStep[];
  isMock?: boolean;
  provider?: string | null;
  model?: string | null;
  streaming?: boolean;
  error?: string;
  gate?: { reason: string; upgradeTo?: string };
  question?: string;
  noteId?: string;
  createdAt?: string;
}

export interface AiStatus {
  provider: ProviderId;
  model: string;
  label: string;
  keySource: 'user' | 'env' | 'none';
  isMock: boolean;
  gate: { allowed: boolean; reason: string | null; upgradeTo: string | null };
  usage: UsageInfo;
}

interface ThreadMessageDTO {
  id: string;
  role: string;
  content: string;
  citations: Citation[];
  toolCalls: unknown[];
  structured: StoredStructured;
  provider: string | null;
  model: string | null;
  createdAt: string;
}

const uid = () => Math.random().toString(36).slice(2, 10);

export function fromDto(m: ThreadMessageDTO, prevUser?: string): UIMessage {
  const s = m.structured ?? {};
  return {
    id: m.id,
    role: m.role === 'user' ? 'user' : 'assistant',
    content: m.content,
    citations: (m.citations ?? []).map((c, i) => ({ ...c, n: c.n ?? i + 1 })),
    blocks: s.blocks ?? [],
    steps: s.steps ?? ((m.toolCalls as ToolStep[]) ?? []),
    isMock: s.isMock,
    provider: m.provider,
    model: m.model,
    question: s.question ?? prevUser,
    createdAt: m.createdAt,
  };
}

/** Parse an SSE body into ChatStreamEvents. */
async function* readSse(res: Response): AsyncGenerator<ChatStreamEvent> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const data = chunk.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
      if (!data) continue;
      try { yield JSON.parse(data) as ChatStreamEvent; } catch { /* skip malformed */ }
    }
  }
}

export function useResearchChat(opts: { threadId?: string | null; onThread?: (id: string) => void; onDone?: () => void } = {}) {
  // starts null so a provided thread id is (re)loaded on mount
  const [threadId, setThreadId] = React.useState<string | null>(null);
  const [messages, setMessages] = React.useState<UIMessage[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [loadingThread, setLoadingThread] = React.useState(false);
  const [status, setStatus] = React.useState<AiStatus | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);
  const cbs = React.useRef(opts);
  cbs.current = opts;

  const refreshStatus = React.useCallback(async () => {
    try {
      const r = await fetch('/api/ai/status', { cache: 'no-store' });
      if (r.ok) setStatus(await r.json());
    } catch { /* ignore */ }
  }, []);

  React.useEffect(() => { void refreshStatus(); }, [refreshStatus]);

  const load = React.useCallback(async (id: string) => {
    abortRef.current?.abort();
    setLoadingThread(true);
    setThreadId(id);
    try {
      const r = await fetch(`/api/ai/threads/${encodeURIComponent(id)}`, { cache: 'no-store' });
      if (!r.ok) throw new Error('Thread not found');
      const { thread } = await r.json();
      let prevUser: string | undefined;
      setMessages((thread.messages as ThreadMessageDTO[]).map((m) => {
        const ui = fromDto(m, prevUser);
        if (m.role === 'user') prevUser = m.content;
        return ui;
      }));
    } catch (e) {
      setMessages([{ id: uid(), role: 'assistant', content: '', citations: [], blocks: [], steps: [], error: (e as Error).message }]);
    } finally {
      setLoadingThread(false);
    }
  }, []);

  React.useEffect(() => {
    if (opts.threadId && opts.threadId !== threadId) void load(opts.threadId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.threadId]);

  const reset = React.useCallback(() => {
    abortRef.current?.abort();
    setThreadId(null);
    setMessages([]);
    setBusy(false);
  }, []);

  const stop = React.useCallback(() => abortRef.current?.abort(), []);

  const patch = (id: string, f: (m: UIMessage) => UIMessage) => setMessages((ms) => ms.map((m) => (m.id === id ? f(m) : m)));

  const send = React.useCallback(
    async (text: string, context?: { ticker?: string; route?: string }) => {
      const q = text.trim();
      if (!q || busy) return;
      const ac = new AbortController();
      abortRef.current = ac;
      const userId = uid();
      const asstId = uid();
      setMessages((ms) => [
        ...ms,
        { id: userId, role: 'user', content: q, citations: [], blocks: [], steps: [] },
        { id: asstId, role: 'assistant', content: '', citations: [], blocks: [], steps: [], streaming: true, question: q },
      ]);
      setBusy(true);
      try {
        const res = await fetch('/api/ai/chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ threadId: threadId ?? undefined, message: q, context }),
          signal: ac.signal,
        });
        if (!res.ok || !res.body) {
          let j: { error?: { code?: string; message?: string; details?: { upgradeTo?: string } } } = {};
          try { j = await res.json(); } catch { /* ignore */ }
          if (j.error?.code === 'upgrade_required') {
            patch(asstId, (m) => ({ ...m, streaming: false, gate: { reason: j.error?.message ?? 'AI research needs an upgrade.', upgradeTo: j.error?.details?.upgradeTo } }));
          } else {
            patch(asstId, (m) => ({ ...m, streaming: false, error: j.error?.message ?? `Request failed (HTTP ${res.status}).` }));
          }
          return;
        }
        for await (const ev of readSse(res)) {
          switch (ev.type) {
            case 'meta':
              if (ev.threadId !== threadId) {
                setThreadId(ev.threadId);
                cbs.current.onThread?.(ev.threadId);
              }
              patch(asstId, (m) => ({ ...m, provider: ev.provider, model: ev.model }));
              break;
            case 'text':
              patch(asstId, (m) => ({ ...m, content: m.content + ev.delta }));
              break;
            case 'tool':
              patch(asstId, (m) => {
                const steps = m.steps.some((s) => s.id === ev.id) ? m.steps.map((s) => (s.id === ev.id ? { ...s, status: ev.status, summary: ev.summary } : s)) : [...m.steps, { id: ev.id, name: ev.name, label: ev.label, status: ev.status, summary: ev.summary }];
                return { ...m, steps };
              });
              break;
            case 'block':
              patch(asstId, (m) => ({ ...m, blocks: [...m.blocks, ev.block] }));
              break;
            case 'citations':
              patch(asstId, (m) => ({ ...m, citations: ev.citations }));
              break;
            case 'done':
              patch(asstId, (m) => ({ ...m, id: ev.messageId ?? m.id, content: ev.content, citations: ev.citations, blocks: ev.blocks, isMock: ev.isMock, streaming: false, provider: ev.provider, model: ev.model }));
              setStatus((s) => (s ? { ...s, usage: ev.usage } : s));
              break;
            case 'error':
              patch(asstId, (m) => ({ ...m, streaming: false, error: ev.message }));
              break;
          }
        }
        patch(asstId, (m) => (m.streaming ? { ...m, streaming: false } : m));
      } catch (e) {
        const aborted = (e as Error).name === 'AbortError';
        patch(asstId, (m) => ({ ...m, streaming: false, error: aborted ? (m.content ? undefined : 'Stopped.') : 'Connection lost. Try again.' }));
      } finally {
        setBusy(false);
        abortRef.current = null;
        cbs.current.onDone?.();
      }
    },
    [busy, threadId],
  );

  const markSaved = React.useCallback((messageId: string, noteId: string) => patch(messageId, (m) => ({ ...m, noteId })), []);

  return { threadId, messages, busy, loadingThread, status, send, stop, reset, load, refreshStatus, markSaved };
}
