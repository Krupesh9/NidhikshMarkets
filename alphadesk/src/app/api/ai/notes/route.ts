import { z } from 'zod';
import { withApi } from '@/lib/http';
import { researchRepo } from '@/lib/repos';
import { sanitizeMarkdown, sanitizeText, sanitizeTicker } from '@/lib/sanitize';

export const dynamic = 'force-dynamic';

const sourceRef = z.object({
  id: z.string().max(300),
  name: z.string().max(400),
  url: z.string().max(1000).optional(),
  kind: z.enum(['filing', 'transcript', 'news', 'price', 'estimate', 'ownership', 'mock']),
  excerpt: z.string().max(4000).optional(),
  locator: z.string().max(300).optional(),
  n: z.number().int().optional(),
});

const body = z.object({
  title: z.string().max(200).optional(),
  question: z.string().min(1).max(4000),
  answerMarkdown: z.string().min(1).max(50_000),
  citations: z.array(sourceRef).max(100).default([]),
  structured: z.record(z.string(), z.unknown()).optional(),
  tickers: z.array(z.string().max(12)).max(20).optional(),
  threadId: z.string().max(64).optional(),
  messageId: z.string().max(64).optional(),
});

/** GET /api/ai/notes?ticker=AAPL → { notes } (org research notes) */
export const GET = withApi(
  async ({ user, query }) => {
    const notes = await researchRepo.listNotes({ orgId: user.orgId, userId: user.id }, { ticker: query.ticker ? sanitizeTicker(query.ticker) ?? undefined : undefined });
    return { notes };
  },
  { query: z.object({ ticker: z.string().max(12).optional() }) },
);

/**
 * POST /api/ai/notes → { note } — save an AI answer as a ResearchNote (question, answer, citations, structured blocks).
 * Share it via POST /api/shares { itemType: 'note', itemId: note.id }.
 */
export const POST = withApi(
  async ({ user, body: b }) => {
    const title = sanitizeText(b.title || b.question, 200).slice(0, 200) || 'Research note';
    const note = await researchRepo.createNote(
      { orgId: user.orgId, userId: user.id },
      {
        title,
        question: sanitizeText(b.question, 4000),
        answerMarkdown: sanitizeMarkdown(b.answerMarkdown),
        citations: b.citations.map(({ n: _n, ...s }) => s),
        structured: { ...(b.structured ?? {}), messageId: b.messageId ?? null, citationNumbers: b.citations.map((c) => c.n ?? null) },
        tickers: (b.tickers ?? []).map((t) => sanitizeTicker(t)).filter((t): t is string => !!t),
        threadId: b.threadId ?? null,
      },
    );
    return { note };
  },
  { body, rateLimit: 'mutation', audit: 'ai.note.create' },
);
