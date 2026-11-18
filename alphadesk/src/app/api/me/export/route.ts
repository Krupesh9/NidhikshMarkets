import { NextResponse } from 'next/server';
import { withApi } from '@/lib/http';
import { db } from '@/lib/db';
import { auditAsync } from '@/lib/audit';

export const dynamic = 'force-dynamic';

const json = (s: string | null | undefined, fallback: unknown) => {
  if (!s) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
};

/**
 * GET /api/me/export → JSON download of the signed-in user's own content (scoped to their user id AND org):
 * watchlists, saved screens, portfolios + positions, baskets + holdings, research threads + messages, notes.
 * Never includes credentials, sessions, audit logs or other members' data.
 */
export const GET = withApi(
  async ({ user, correlationId }) => {
    const scope = { orgId: user.orgId, userId: user.id };
    const [watchlists, screens, portfolios, baskets, threads, notes] = await Promise.all([
      db.watchlist.findMany({ where: scope, orderBy: { createdAt: 'asc' } }),
      db.savedScreen.findMany({ where: scope, orderBy: { createdAt: 'asc' } }),
      db.portfolio.findMany({ where: scope, include: { positions: true }, orderBy: { createdAt: 'asc' } }),
      db.basket.findMany({ where: scope, include: { holdings: true }, orderBy: { createdAt: 'asc' } }),
      db.chatThread.findMany({ where: scope, include: { messages: { orderBy: { createdAt: 'asc' } } }, orderBy: { createdAt: 'asc' } }),
      db.researchNote.findMany({ where: { orgId: user.orgId, authorId: user.id }, orderBy: { createdAt: 'asc' } }),
    ]);
    const out = {
      format: 'nidhiksh-pulse.user-export', version: 1, exportedAt: new Date().toISOString(),
      user: { email: user.email, name: user.name, role: user.role, plan: user.plan },
      watchlists: watchlists.map((w) => ({ name: w.name, symbols: json(w.symbols, []), createdAt: w.createdAt })),
      savedScreens: screens.map((s) => ({ name: s.name, description: s.description, filters: json(s.filters, {}), columns: json(s.columns, []), sort: json(s.sort, []), createdAt: s.createdAt })),
      portfolios: portfolios.map((p) => ({
        name: p.name, description: p.description, benchmark: p.benchmark, baseCurrency: p.baseCurrency, createdAt: p.createdAt,
        positions: p.positions.map((x) => ({ ticker: x.ticker, quantity: x.quantity, costBasis: x.costBasis, targetWeight: x.targetWeight, sector: x.sector, country: x.country, openedAt: x.openedAt })),
      })),
      baskets: baskets.map((b) => ({
        name: b.name, description: b.description, thesis: b.thesis, createdAt: b.createdAt,
        holdings: b.holdings.map((h) => ({ ticker: h.ticker, targetWeight: h.targetWeight, rationale: h.rationale, sector: h.sector })),
      })),
      researchThreads: threads.map((t) => ({
        title: t.title, tickers: json(t.tickers, []), context: json(t.context, {}), createdAt: t.createdAt,
        messages: t.messages.map((m) => ({ role: m.role, content: m.content, citations: json(m.citations, []), structured: json(m.structured, {}), provider: m.provider, model: m.model, createdAt: m.createdAt })),
      })),
      notes: notes.map((n) => ({ title: n.title, question: n.question, answerMarkdown: n.answerMarkdown, citations: json(n.citations, []), structured: json(n.structured, {}), tickers: json(n.tickers, []), createdAt: n.createdAt })),
    };
    await auditAsync({ orgId: user.orgId, userId: user.id, action: 'settings.data.export', target: user.id, correlationId });
    const date = new Date().toISOString().slice(0, 10);
    return new NextResponse(JSON.stringify(out, null, 2), {
      headers: { 'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="pulse-my-data-${date}.json"`, 'cache-control': 'no-store' },
    });
  },
  { rateLimit: 'mutation' },
);
