import 'server-only';
import { db } from '@/lib/db';
import { parseJson, toJson } from '@/lib/json';
import type { SourceRef } from '@/lib/data/types';
import type { ChatMessageDTO, ChatThreadDTO, ResearchNoteDTO, Scope } from './types';

const mapNote = (r: NonNullable<Awaited<ReturnType<typeof db.researchNote.findFirst>>>): ResearchNoteDTO => ({
  ...r, citations: parseJson(r.citations, []), structured: parseJson(r.structured, {}), tickers: parseJson(r.tickers, []),
});
const mapMsg = (r: NonNullable<Awaited<ReturnType<typeof db.chatMessage.findFirst>>>): ChatMessageDTO => ({
  id: r.id, threadId: r.threadId, role: r.role, content: r.content, citations: parseJson(r.citations, []), toolCalls: parseJson(r.toolCalls, []),
  structured: parseJson(r.structured, {}), provider: r.provider, model: r.model, createdAt: r.createdAt,
});
const mapThread = (r: NonNullable<Awaited<ReturnType<typeof db.chatThread.findFirst>>>): ChatThreadDTO => ({
  id: r.id, orgId: r.orgId, userId: r.userId, title: r.title, tickers: parseJson(r.tickers, []), context: parseJson(r.context, {}), createdAt: r.createdAt, updatedAt: r.updatedAt,
});

export interface NoteInput { title: string; question: string; answerMarkdown: string; citations?: SourceRef[]; structured?: Record<string, unknown>; tickers?: string[]; threadId?: string | null }

export const researchRepo = {
  listNotes: async (s: Scope, opts: { ticker?: string; take?: number } = {}) => {
    const rows = await db.researchNote.findMany({
      where: { orgId: s.orgId, ...(opts.ticker ? { tickers: { contains: `"${opts.ticker.toUpperCase()}"` } } : {}) },
      orderBy: { createdAt: 'desc' }, take: opts.take ?? 50,
    });
    return rows.map(mapNote);
  },
  getNote: async (s: Scope, id: string) => {
    const r = await db.researchNote.findFirst({ where: { id, orgId: s.orgId } });
    return r ? mapNote(r) : null;
  },
  createNote: async (s: Scope, d: NoteInput) =>
    mapNote(await db.researchNote.create({
      data: { orgId: s.orgId, authorId: s.userId, title: d.title, question: d.question, answerMarkdown: d.answerMarkdown, citations: toJson(d.citations ?? []),
        structured: toJson(d.structured ?? {}), tickers: toJson((d.tickers ?? []).map((t) => t.toUpperCase())), threadId: d.threadId ?? null },
    })),
  removeNote: async (s: Scope, id: string) => (await db.researchNote.deleteMany({ where: { id, orgId: s.orgId } })).count > 0,

  listThreads: async (s: Scope, take = 50) =>
    (await db.chatThread.findMany({ where: { orgId: s.orgId, userId: s.userId }, orderBy: { updatedAt: 'desc' }, take })).map(mapThread),
  getThread: async (s: Scope, id: string): Promise<ChatThreadDTO | null> => {
    const r = await db.chatThread.findFirst({ where: { id, orgId: s.orgId }, include: { messages: { orderBy: { createdAt: 'asc' } } } });
    return r ? { ...mapThread(r), messages: r.messages.map(mapMsg) } : null;
  },
  createThread: async (s: Scope, d: { title: string; tickers?: string[]; context?: Record<string, unknown> }) =>
    mapThread(await db.chatThread.create({ data: { orgId: s.orgId, userId: s.userId, title: d.title.slice(0, 200), tickers: toJson(d.tickers ?? []), context: toJson(d.context ?? {}) } })),
  addMessage: async (s: Scope, threadId: string, m: { role: string; content: string; citations?: SourceRef[]; toolCalls?: unknown[]; structured?: Record<string, unknown>; provider?: string; model?: string }) => {
    const t = await db.chatThread.findFirst({ where: { id: threadId, orgId: s.orgId } });
    if (!t) return null;
    const [msg] = await db.$transaction([
      db.chatMessage.create({ data: { orgId: s.orgId, threadId, role: m.role, content: m.content, citations: toJson(m.citations ?? []), toolCalls: toJson(m.toolCalls ?? []), structured: toJson(m.structured ?? {}), provider: m.provider, model: m.model } }),
      db.chatThread.update({ where: { id: threadId }, data: { updatedAt: new Date() } }),
    ]);
    return mapMsg(msg);
  },
  removeThread: async (s: Scope, id: string) => (await db.chatThread.deleteMany({ where: { id, orgId: s.orgId, userId: s.userId } })).count > 0,
};
