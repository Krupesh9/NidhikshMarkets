import 'server-only';
/** Server-side share helpers: build authoritative base snapshots from stored records. */
import { getMarketData } from '@/lib/data';
import { portfolioRepo, researchRepo, screenRepo, shareRepo, type Scope } from '@/lib/repos';
import { summarizePortfolio } from '@/components/dashboard/portfolio-math';
import { loadAggregate } from '@/components/company/server/data';
import { sanitizeTicker } from '@/lib/sanitize';
import { snapshotPreview, type ShareItemType } from './snapshot';
import type { FeedCard } from './SharedFeed';

export interface BaseSnapshot { title: string; snapshot: Record<string, unknown> }

/**
 * Load the item being shared (org-scoped) and turn it into a base snapshot.
 * Returns null when the item doesn't exist in the org. Items that aren't persisted yet (e.g. an unsaved screen with
 * itemId "adhoc:...") return an empty base so the client snapshot is used as-is.
 */
export async function buildBaseSnapshot(scope: Scope, itemType: ShareItemType, itemId: string): Promise<BaseSnapshot | null> {
  if (itemId.startsWith('adhoc')) return { title: '', snapshot: {} };
  switch (itemType) {
    case 'note': {
      const n = await researchRepo.getNote(scope, itemId);
      if (!n) return null;
      return { title: n.title, snapshot: { question: n.question, answerMarkdown: n.answerMarkdown, sources: n.citations, tickers: n.tickers, structured: n.structured, threadId: n.threadId, isMock: n.citations.some((c) => c.kind === 'mock' || c.id.startsWith('mock:')) } };
    }
    case 'thread': {
      const t = await researchRepo.getThread(scope, itemId);
      if (!t) return null;
      const msgs = (t.messages ?? []).filter((m) => m.role === 'user' || m.role === 'assistant');
      const cites = msgs.flatMap((m) => m.citations);
      return {
        title: t.title,
        snapshot: { title: t.title, question: msgs.find((m) => m.role === 'user')?.content ?? '', messages: msgs.map((m) => ({ role: m.role, content: m.content, citations: m.citations })), context: t.context, tickers: t.tickers, sources: cites, isMock: msgs.some((m) => m.provider === 'mock') },
      };
    }
    case 'screen': {
      const s = await screenRepo.get(scope, itemId);
      if (!s) return null;
      return { title: s.name, snapshot: { name: s.name, description: s.description, filters: s.filters, columns: s.columns, sort: s.sort } };
    }
    case 'portfolio': {
      const p = await portfolioRepo.get(scope, itemId);
      if (!p) return null;
      const md = getMarketData();
      const tick = Array.from(new Set(p.positions.map((x) => x.ticker)));
      const q = tick.length ? await md.getQuotes(tick) : { data: [], meta: { isMock: false, source: [] } };
      const sum = summarizePortfolio(p.positions, Object.fromEntries(q.data.map((x) => [x.ticker, x])));
      return {
        title: p.name,
        snapshot: {
          name: p.name, description: p.description, benchmark: p.benchmark, tickers: tick, isMock: q.meta.isMock, sources: q.meta.source.slice(0, 20),
          positions: sum.rows.map((r) => ({ ticker: r.ticker, quantity: r.quantity, costBasis: r.costBasis, price: r.price ?? undefined, marketValue: r.marketValue, weight: r.weight, changePct: r.changePct ?? undefined, pnl: r.pnl, sector: r.sector })),
          metrics: { 'Gross exposure': sum.gross, 'Net exposure': sum.net, 'Long': sum.long, 'Short': sum.short, 'Day P&L': sum.dayPnl, 'Unrealized P&L': sum.unrealized, 'Positions': sum.positions, 'Benchmark': p.benchmark },
        },
      };
    }
    case 'company': {
      const ticker = sanitizeTicker(itemId);
      if (!ticker) return null;
      const a = await loadAggregate(ticker);
      if (!a.found) return null;
      const p = a.profile;
      const annual = a.financials.annual?.rows ?? [];
      const finSources = Object.values(a.financials.annualSources ?? {});
      const hs = a.headerSources;
      return {
        title: `${ticker}${p?.name ? ` · ${p.name}` : ''}`,
        snapshot: {
          ticker, name: p?.name, sector: p?.sector, industry: p?.industry, description: p?.description, tickers: [ticker], isMock: a.meta.isMock,
          quote: a.quote ? { price: a.quote.price, change: a.quote.change, changePct: a.quote.changePct, ts: a.quote.ts } : null,
          metrics: {
            'Market cap': a.marketCap ?? null, 'P/E': a.valuation.pe, 'EV/EBITDA': a.valuation.evEbitda, EV: a.valuation.ev,
            '52w high': a.week52.high, '52w low': a.week52.low, ...(p ? { 'Dividend yield %': p.dividendYield, Beta: p.beta } : {}),
          },
          financials: annual.slice(-5).reverse().map((r) => ({
            Period: `FY${r.fiscalYear}`, Revenue: r.revenue, 'Gross margin %': r.grossMargin, 'Operating margin %': r.operatingMargin, 'Net income': r.netIncome, EPS: r.eps, 'Free cash flow': r.freeCashFlow,
          })),
          estimates: a.estimates ? {
            rating: a.estimates.rating, priceTarget: a.estimates.priceTarget,
            periods: a.estimates.periods.slice(0, 6).map((e) => ({ Period: e.period, Metric: e.metric.toUpperCase(), Consensus: e.consensus, Analysts: e.numAnalysts, '30d revision %': e.change30dPct })),
          } : null,
          news: a.news.slice(0, 5).map((n) => ({ title: n.title, publisher: n.publisher, url: n.url, publishedAt: n.publishedAt })),
          sources: [hs.price, hs.marketCap, hs.pe, hs.evEbitda, hs.range, hs.profile, ...finSources.slice(-3), ...(a.meta.sections.estimates.sources ?? []).slice(0, 2), ...(a.meta.sections.newsFilings.sources ?? []).slice(0, 4)].filter(Boolean),
        },
      };
    }
    case 'basket': {
      const b = await portfolioRepo.getBasket(scope, itemId);
      if (!b) return null;
      const md = getMarketData();
      const tick = b.holdings.map((h) => h.ticker);
      const q = tick.length ? await md.getQuotes(tick) : { data: [], meta: { isMock: false, source: [] } };
      const qm = Object.fromEntries(q.data.map((x) => [x.ticker, x]));
      const wsum = b.holdings.reduce((a, h) => a + h.targetWeight, 0);
      const dayMove = wsum ? b.holdings.reduce((a, h) => a + h.targetWeight * (qm[h.ticker]?.changePct ?? 0), 0) / wsum : 0;
      const sectors = new Set(b.holdings.map((h) => h.sector).filter(Boolean));
      return {
        title: b.name,
        snapshot: {
          name: b.name, description: b.description, thesis: b.thesis, tickers: tick, isMock: q.meta.isMock, sources: q.meta.source.slice(0, 20),
          holdings: b.holdings.map((h) => ({ ticker: h.ticker, targetWeight: h.targetWeight, rationale: h.rationale, sector: h.sector, price: qm[h.ticker]?.price, changePct: qm[h.ticker]?.changePct })),
          metrics: { 'Holdings': b.holdings.length, 'Total target weight': Number(wsum.toFixed(4)), 'Weighted day move %': Number(dayMove.toFixed(2)), 'Sectors': sectors.size },
        },
      };
    }
  }
}

/** Org share feed as serialisable cards (previews only). */
export async function listShareCards(scope: Scope, take = 100): Promise<FeedCard[]> {
  const rows = await shareRepo.list(scope, take);
  return rows.map((s) => ({
    id: s.id, token: s.token, itemType: s.itemType, title: s.title, visibility: s.visibility, createdAt: s.createdAt.toISOString(),
    createdById: s.createdById, createdByName: s.createdByName ?? 'Unknown', commentCount: (s as typeof s & { commentCount?: number }).commentCount ?? 0,
    isMock: s.snapshot.isMock === true, preview: snapshotPreview(s.itemType, s.snapshot),
  }));
}
