/**
 * Share snapshot model (pure — safe on client, server and in tests).
 *
 * A snapshot freezes exactly what the author saw at share time so colleagues see the same context:
 *   note      → question, answer markdown, cited sources, tickers
 *   thread    → title, messages (with citations), page context
 *   screen    → filters applied, columns, sort, result rows (capped), result count
 *   portfolio → positions (with prices at capture), key metrics, benchmark
 *   basket    → thesis, holdings (target weights, rationale), key metrics
 * Every snapshot carries `capturedAt` and `isMock`.
 */
import { z } from 'zod';
import type { SourceRef } from '@/lib/data/types';
import { assertFeature, type GateResult } from '@/lib/plans';
import { sanitizeMarkdown, sanitizeText } from '@/lib/sanitize';

export const SHARE_ITEM_TYPES = ['note', 'screen', 'portfolio', 'basket', 'thread', 'company'] as const;
export type ShareItemType = (typeof SHARE_ITEM_TYPES)[number];
export type ShareVisibility = 'org' | 'link';

export const ITEM_LABEL: Record<ShareItemType, string> = { note: 'Research note', screen: 'Screen', portfolio: 'Portfolio', basket: 'Basket', thread: 'AI thread', company: 'Company' };

/** Max serialized snapshot size (bytes, approx chars). */
export const MAX_SNAPSHOT_BYTES = 512_000;
export const MAX_SCREEN_ROWS = 250;
export const MAX_COMMENT_LEN = 4_000;

export interface SnapshotBase { capturedAt: string; isMock?: boolean; sources?: SourceRef[]; tickers?: string[] }
export interface NoteSnapshot extends SnapshotBase { question: string; answerMarkdown: string; structured?: Record<string, unknown>; threadId?: string | null }
export interface ThreadSnapshot extends SnapshotBase { title?: string; question?: string; messages: { role: string; content: string; citations?: SourceRef[] }[]; context?: Record<string, unknown> }
export interface ScreenSnapshot extends SnapshotBase { name?: string; description?: string | null; filters: Record<string, unknown>; columns: string[]; sort?: { id: string; desc: boolean }[]; rows: Record<string, unknown>[]; resultCount?: number }
export interface HoldingRow { ticker: string; quantity?: number; costBasis?: number; price?: number; marketValue?: number; weight?: number; targetWeight?: number; changePct?: number; pnl?: number; sector?: string | null; rationale?: string | null }
export interface PortfolioSnapshot extends SnapshotBase { name?: string; description?: string | null; benchmark?: string; positions: HoldingRow[]; metrics: Record<string, number | string | null> }
export interface BasketSnapshot extends SnapshotBase { name?: string; description?: string | null; thesis?: string | null; holdings: HoldingRow[]; metrics: Record<string, number | string | null> }
export interface CompanySnapshot extends SnapshotBase {
  ticker: string; name?: string; sector?: string; industry?: string; description?: string;
  quote: { price?: number; change?: number; changePct?: number; ts?: string } | null;
  metrics: Record<string, number | string | null>;
  financials: Record<string, number | string | null>[];
  estimates: { rating?: { buy: number; hold: number; sell: number }; priceTarget?: { mean: number; high: number; low: number }; periods: Record<string, number | string | null>[] } | null;
  news: { title: string; publisher?: string; url?: string; publishedAt?: string }[];
}
export type AnySnapshot = NoteSnapshot | ThreadSnapshot | ScreenSnapshot | PortfolioSnapshot | BasketSnapshot | CompanySnapshot;

const sourceRef = z.object({
  id: z.string(), name: z.string(), url: z.string().optional(), excerpt: z.string().optional(), locator: z.string().optional(),
  kind: z.enum(['filing', 'transcript', 'news', 'price', 'estimate', 'ownership', 'mock']).catch('mock'),
});

export const createShareSchema = z.object({
  itemType: z.enum(SHARE_ITEM_TYPES),
  itemId: z.string().min(1).max(200),
  title: z.string().max(200).optional(),
  snapshot: z.record(z.string(), z.unknown()).optional().default({}),
  visibility: z.enum(['org', 'link']).default('org'),
  /** optional expiry in days for link shares */
  expiresInDays: z.number().int().min(1).max(365).optional(),
});
export type CreateShareInput = z.infer<typeof createShareSchema>;

/** Plan gate for sharing a given item type. Baskets need custom basket sharing (Pro Plus); everything else Pro+. */
export function shareGate(user: { plan: string }, itemType: ShareItemType): GateResult {
  const general = assertFeature(user, 'sharing');
  if (!general.allowed) return general;
  if (itemType === 'basket') return assertFeature(user, 'customBasketSharing');
  return { allowed: true };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, max = 2000) => sanitizeText(v, max);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

function sources(v: unknown): SourceRef[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  return v.slice(0, 200).flatMap((s) => {
    const p = sourceRef.safeParse(s);
    if (!p.success || seen.has(p.data.id) || seen.size >= 100) return [];
    seen.add(p.data.id);
    const r = p.data;
    const safeUrl = r.url && /^https?:\/\//i.test(r.url) ? r.url : undefined;
    return [{ id: str(r.id, 300), name: str(r.name, 300), kind: r.kind, ...(safeUrl ? { url: safeUrl } : {}), ...(r.excerpt ? { excerpt: str(r.excerpt, 4000) } : {}), ...(r.locator ? { locator: str(r.locator, 300) } : {}) }];
  });
}
const tickers = (v: unknown) => (Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string').map((t) => t.toUpperCase().slice(0, 12)).slice(0, 100) : []);

function holdings(v: unknown): HoldingRow[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 500).flatMap((h) => {
    if (!isObj(h) || typeof h.ticker !== 'string') return [];
    const row: HoldingRow = { ticker: h.ticker.toUpperCase().slice(0, 12) };
    for (const k of ['quantity', 'costBasis', 'price', 'marketValue', 'weight', 'targetWeight', 'changePct', 'pnl'] as const) {
      const n = num(h[k]);
      if (n !== undefined) row[k] = n;
    }
    if (typeof h.sector === 'string') row.sector = str(h.sector, 80);
    if (typeof h.rationale === 'string') row.rationale = str(h.rationale, 1000);
    return [row];
  });
}

function metrics(v: unknown): Record<string, number | string | null> {
  if (!isObj(v)) return {};
  const out: Record<string, number | string | null> = {};
  for (const [k, x] of Object.entries(v).slice(0, 40)) {
    if (typeof x === 'number' && Number.isFinite(x)) out[str(k, 60)] = x;
    else if (typeof x === 'string') out[str(k, 60)] = str(x, 200);
    else if (x === null) out[str(k, 60)] = null;
  }
  return out;
}

/** JSON-safe deep clone with depth/size limits (for filters/context/rows). */
function plain(v: unknown, depth = 0): unknown {
  if (depth > 6) return null;
  if (v === null || typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') return str(v, 4000);
  if (Array.isArray(v)) return v.slice(0, 500).map((x) => plain(x, depth + 1));
  if (isObj(v)) return Object.fromEntries(Object.entries(v).slice(0, 200).map(([k, x]) => [str(k, 100), plain(x, depth + 1)]));
  return null;
}

/**
 * Validate + sanitise a snapshot for its item type. `base` is the server-built snapshot from the DB record (authoritative
 * for stored content such as the note answer); `client` is what the author's screen showed (authoritative for view state
 * such as screen filters/rows and live portfolio prices). Client keys override base keys.
 */
export function normalizeSnapshot(itemType: ShareItemType, client: Record<string, unknown>, base: Record<string, unknown> = {}, now = new Date()): AnySnapshot {
  const m: Record<string, unknown> = { ...base, ...client };
  const common: SnapshotBase = {
    capturedAt: typeof m.capturedAt === 'string' && !Number.isNaN(Date.parse(m.capturedAt)) ? m.capturedAt : now.toISOString(),
    isMock: m.isMock === true,
    sources: sources(m.sources ?? m.citations),
    tickers: tickers(m.tickers),
  };
  switch (itemType) {
    case 'note':
      return { ...common, question: str(m.question, 4000), answerMarkdown: sanitizeMarkdown(m.answerMarkdown ?? m.answer ?? ''), structured: isObj(m.structured) ? (plain(m.structured) as Record<string, unknown>) : undefined, threadId: typeof m.threadId === 'string' ? m.threadId : null };
    case 'thread': {
      const msgs = Array.isArray(m.messages) ? m.messages : [];
      return {
        ...common, title: str(m.title, 200), question: str(m.question, 4000),
        messages: msgs.slice(0, 200).flatMap((x) => (isObj(x) && typeof x.content === 'string' ? [{ role: str(x.role, 20) || 'assistant', content: sanitizeMarkdown(x.content), citations: sources(x.citations) }] : [])),
        context: isObj(m.context) ? (plain(m.context) as Record<string, unknown>) : {},
      };
    }
    case 'screen': {
      const rows = Array.isArray(m.rows) ? m.rows.filter(isObj) : [];
      return {
        ...common, name: str(m.name, 200), description: typeof m.description === 'string' ? str(m.description, 1000) : null,
        filters: isObj(m.filters) ? (plain(m.filters) as Record<string, unknown>) : {},
        columns: Array.isArray(m.columns) ? m.columns.filter((c): c is string => typeof c === 'string').slice(0, 50) : [],
        sort: Array.isArray(m.sort) ? m.sort.flatMap((s) => (isObj(s) && typeof s.id === 'string' ? [{ id: s.id, desc: !!s.desc }] : [])) : [],
        rows: rows.slice(0, MAX_SCREEN_ROWS).map((r) => plain(r) as Record<string, unknown>),
        resultCount: num(m.resultCount) ?? rows.length,
      };
    }
    case 'portfolio':
      return { ...common, name: str(m.name, 200), description: typeof m.description === 'string' ? str(m.description, 1000) : null, benchmark: str(m.benchmark, 12) || undefined, positions: holdings(m.positions ?? m.holdings), metrics: metrics(m.metrics) };
    case 'company': {
      const q = isObj(m.quote) ? m.quote : null;
      const est = isObj(m.estimates) ? m.estimates : null;
      const nums = <K extends string>(o: unknown, keys: K[]): Record<K, number> | undefined =>
        isObj(o) && keys.every((k) => typeof o[k] === 'number' && Number.isFinite(o[k])) ? (Object.fromEntries(keys.map((k) => [k, o[k]])) as Record<K, number>) : undefined;
      return {
        ...common,
        ticker: str(m.ticker, 12).toUpperCase(), name: str(m.name, 200) || undefined, sector: str(m.sector, 80) || undefined, industry: str(m.industry, 120) || undefined,
        description: typeof m.description === 'string' ? str(m.description, 1500) : undefined,
        quote: q ? { price: num(q.price), change: num(q.change), changePct: num(q.changePct), ts: typeof q.ts === 'string' ? q.ts : undefined } : null,
        metrics: metrics(m.metrics),
        financials: Array.isArray(m.financials) ? m.financials.slice(0, 12).map(metrics) : [],
        estimates: est ? { rating: nums(est.rating, ['buy', 'hold', 'sell']), priceTarget: nums(est.priceTarget, ['mean', 'high', 'low']), periods: Array.isArray(est.periods) ? est.periods.slice(0, 12).map(metrics) : [] } : null,
        news: Array.isArray(m.news)
          ? m.news.slice(0, 10).flatMap((n) => (isObj(n) && typeof n.title === 'string'
            ? [{ title: str(n.title, 300), publisher: typeof n.publisher === 'string' ? str(n.publisher, 100) : undefined, url: typeof n.url === 'string' && /^https?:\/\//i.test(n.url) ? n.url : undefined, publishedAt: typeof n.publishedAt === 'string' ? n.publishedAt : undefined }]
            : []))
          : [],
      };
    }
    case 'basket':
      return { ...common, name: str(m.name, 200), description: typeof m.description === 'string' ? str(m.description, 1000) : null, thesis: typeof m.thesis === 'string' ? sanitizeMarkdown(m.thesis, 10_000) : null, holdings: holdings(m.holdings ?? m.positions), metrics: metrics(m.metrics) };
  }
}

/** Short text preview for feed cards (never includes the full snapshot). */
export function snapshotPreview(itemType: ShareItemType, s: Record<string, unknown>): { text: string; tickers: string[]; stats: string[] } {
  const t = tickers(s.tickers);
  const clip = (x: unknown, n = 220) => { const v = typeof x === 'string' ? x.replace(/[#*_`>\[\]]/g, '').replace(/\s+/g, ' ').trim() : ''; return v.length > n ? v.slice(0, n - 1) + '…' : v; };
  switch (itemType) {
    case 'note': return { text: clip(s.question) || clip(s.answerMarkdown), tickers: t, stats: [`${sources(s.sources ?? s.citations).length} sources`] };
    case 'thread': return { text: clip(s.question) || clip(Array.isArray(s.messages) && isObj(s.messages[0]) ? s.messages[0].content : ''), tickers: t, stats: [`${Array.isArray(s.messages) ? s.messages.length : 0} messages`] };
    case 'screen': {
      const f = isObj(s.filters) ? Object.keys(s.filters).length : 0;
      const rows = Array.isArray(s.rows) ? s.rows : [];
      const names = rows.slice(0, 6).map((r) => (isObj(r) && typeof r.ticker === 'string' ? r.ticker : '')).filter(Boolean);
      return { text: clip(s.description) || `Top results: ${names.join(', ') || '—'}`, tickers: t.length ? t : names, stats: [`${f} filters`, `${num(s.resultCount) ?? rows.length} results`] };
    }
    case 'company': {
      const tk = typeof s.ticker === 'string' ? s.ticker : '';
      const q = isObj(s.quote) ? s.quote : {};
      const px = num(q.price);
      return { text: clip(s.description) || `${clip(s.name) || tk} snapshot`, tickers: t.length ? t : tk ? [tk] : [], stats: [px != null ? `$${px.toFixed(2)}` : 'no quote', `${Array.isArray(s.news) ? s.news.length : 0} headlines`] };
    }
    case 'portfolio':
    case 'basket': {
      const h = holdings(s.positions ?? s.holdings);
      const tk = h.slice(0, 6).map((x) => x.ticker);
      return { text: clip(s.thesis) || clip(s.description) || `Holdings: ${tk.join(', ') || '—'}`, tickers: t.length ? t : tk, stats: [`${h.length} ${itemType === 'basket' ? 'holdings' : 'positions'}`] };
    }
  }
}

/** Approximate JSON size check. */
export function snapshotTooLarge(s: unknown): boolean {
  try { return JSON.stringify(s).length > MAX_SNAPSHOT_BYTES; } catch { return true; }
}

/** Comment body cleaner: strips HTML/control chars, dangerous links; empty → null. */
export function cleanComment(body: unknown): string | null {
  const s = sanitizeMarkdown(body, MAX_COMMENT_LEN);
  return s.length ? s : null;
}
