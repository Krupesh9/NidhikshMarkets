import { z } from 'zod';
import { withApi, notFound, upgradeRequired } from '@/lib/http';
import { researchRepo } from '@/lib/repos';
import { getUsage, incrementAiQueries } from '@/lib/usage';
import { getMarketData } from '@/lib/data';
import { sanitizeText, sanitizeTicker } from '@/lib/sanitize';
import { audit } from '@/lib/audit';
import { getProvider, runAgent } from '@/lib/ai';
import { authorizeAiQuery } from '@/lib/ai/gate';
import { findTickers, threadTitle } from '@/lib/ai/intent';
import type { AgentResult } from '@/lib/ai/agent';
import type { ChatStreamEvent, LLMMessage, StoredStructured } from '@/lib/ai/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const body = z.object({
  threadId: z.string().min(1).max(64).optional(),
  message: z.string().trim().min(1, 'Ask a question').max(4000),
  context: z.object({ ticker: z.string().max(12).optional(), route: z.string().max(200).optional() }).optional(),
});

/**
 * POST /api/ai/chat  { threadId?, message, context?: { ticker? } }
 * → text/event-stream of ChatStreamEvent (`data: {json}\n\n`): meta, tool, text, block, citations, done | error.
 * FREE → 402 upgrade_required (render <UpgradeHint/>). PRO counts 1 query per request.
 */
export const POST = withApi(
  async ({ user, body: b, req, correlationId, log }) => {
    const scope = { orgId: user.orgId, userId: user.id };
    const ticker = b.context?.ticker ? sanitizeTicker(b.context.ticker) ?? undefined : undefined;
    const question = sanitizeText(b.message, 4000);

    // Thread (validate before consuming quota)
    let thread = b.threadId ? await researchRepo.getThread(scope, b.threadId) : null;
    if (b.threadId && (!thread || thread.userId !== user.id)) throw notFound('Thread not found');

    const auth = await authorizeAiQuery(user, {
      getUsed: async () => (await getUsage(user)).aiQueries,
      increment: () => incrementAiQueries(user),
    });
    if (!auth.allowed) throw upgradeRequired(auth.gate.reason ?? 'AI research requires an upgrade', auth.gate.upgradeTo);

    const universe = (await getMarketData().getUniverse()).data;
    if (!thread) {
      const tickers = findTickers(question, universe);
      thread = await researchRepo.createThread(scope, { title: threadTitle(question), tickers: tickers.length ? tickers : ticker ? [ticker] : [], context: { ticker, route: b.context?.route } });
    }
    const threadId = thread.id;
    const history: LLMMessage[] = (thread.messages ?? [])
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .slice(-10)
      .map((m) => (m.role === 'user' ? { role: 'user' as const, content: m.content.slice(0, 4000) } : { role: 'assistant' as const, content: m.content.slice(0, 6000) }));
    const userMsg = await researchRepo.addMessage(scope, threadId, { role: 'user', content: question });

    const provider = await getProvider(user);
    const enc = new TextEncoder();
    const abort = new AbortController();
    req.signal.addEventListener('abort', () => abort.abort());

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (ev: ChatStreamEvent) => {
          try { controller.enqueue(enc.encode(`data: ${JSON.stringify(ev)}\n\n`)); } catch { /* client gone */ }
        };
        send({ type: 'meta', threadId, provider: provider.id, model: provider.model, userMessageId: userMsg?.id });
        let result: AgentResult | null = null;
        let partial = '';
        try {
          const gen = runAgent({ provider, history, question, context: { ticker }, toolCtx: { user }, signal: abort.signal });
          while (true) {
            const n = await gen.next();
            if (n.done) { result = n.value; break; }
            if (n.value.type === 'text') partial += n.value.delta;
            send(n.value);
          }
          const content = result.content + (result.stopNote ? `\n\n_${result.stopNote}_` : '');
          const structured: StoredStructured = { blocks: result.blocks, isMock: result.isMock, steps: result.steps, question };
          const saved = await researchRepo.addMessage(scope, threadId, {
            role: 'assistant', content, citations: result.citations, toolCalls: result.steps, structured: structured as Record<string, unknown>, provider: provider.id, model: provider.model,
          });
          audit({ orgId: user.orgId, userId: user.id, action: 'ai.answer', target: `thread:${threadId}`, correlationId, meta: { provider: provider.id, model: provider.model, tools: result.steps.map((s) => s.name), citations: result.citations.length, isMock: result.isMock } });
          send({ type: 'done', messageId: saved?.id ?? null, content, citations: result.citations, blocks: result.blocks, isMock: result.isMock, usage: auth.usage, provider: provider.id, model: provider.model });
        } catch (e) {
          const err = e as Error & { status?: number };
          log.error('ai.chat_failed', { err, provider: provider.id });
          if (partial.trim()) {
            await researchRepo.addMessage(scope, threadId, { role: 'assistant', content: partial + '\n\n_The answer was interrupted._', provider: provider.id, model: provider.model }).catch(() => null);
          }
          const msg = err.status === 401 ? `${provider.label}: the API key was rejected. Update it in Settings → AI keys.` : abort.signal.aborted ? 'Request cancelled.' : `The research assistant hit an error (${err.message?.slice(0, 160) ?? 'unknown'}). Correlation id: ${correlationId}`;
          send({ type: 'error', code: abort.signal.aborted ? 'aborted' : 'provider_error', message: msg });
        } finally {
          try { controller.close(); } catch { /* already closed */ }
        }
      },
      cancel() {
        abort.abort();
      },
    });

    return new Response(stream, {
      headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' },
    });
  },
  { body, rateLimit: 'ai', audit: 'ai.query' },
);
