import 'server-only';
import fs from 'node:fs';
import type Database from 'better-sqlite3';
import type { Bar, Filing, HistoryRange, NewsItem, PartialProvider, Quote, SourceRef, WithMeta } from './types';
import { sliceRange } from './mock';
import { MOCK_BY_TICKER } from './mock/universe';
import { log } from '../log';

/**
 * Read-only adapter over the local Nidhiksh Markets cache (SQLite).
 * Opened with { readonly: true, fileMustExist: true }; this module never writes.
 */
const DEFAULT_PATH = '/Users/krupeshpatel/Documents/ChatGPT/Nidhiksh Markets/runtime/market.sqlite';
const NAME = 'Nidhiksh local cache';

let db: Database.Database | null | undefined;

function open(): Database.Database | null {
  if (db !== undefined) return db;
  const path = process.env.NIDHIKSH_DB_PATH || DEFAULT_PATH;
  try {
    if (!fs.existsSync(path)) {
      db = null;
      return db;
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const BetterSqlite3 = require('better-sqlite3') as typeof Database;
    db = new BetterSqlite3(path, { readonly: true, fileMustExist: true });
    db.pragma('query_only = ON');
  } catch (e) {
    log.warn('nidhiksh.open_failed', { err: (e as Error).message });
    db = null;
  }
  return db;
}

function meta(sources: SourceRef[], asOf?: string) {
  return { source: sources, isMock: false, asOf: asOf ?? new Date().toISOString(), provider: NAME };
}

function instrumentId(ticker: string): number | null {
  const d = open();
  if (!d) return null;
  const row = d.prepare('SELECT id FROM instruments WHERE symbol = ? LIMIT 1').get(ticker.toUpperCase()) as { id: number } | undefined;
  return row?.id ?? null;
}

function bars(ticker: string): Bar[] {
  const d = open();
  const id = instrumentId(ticker);
  if (!d || id == null) return [];
  const rows = d
    .prepare(
      `SELECT substr(timestamp,1,10) AS date, open, high, low, close, volume FROM price_bars
       WHERE instrument_id = ? AND provider = 'alpaca' AND adjustment = 'split' AND timeframe = '1d'
       ORDER BY timestamp ASC`,
    )
    .all(id) as Bar[];
  return rows;
}

export const nidhikshProvider: PartialProvider = {
  name: NAME,

  async getHistory(ticker: string, range: HistoryRange): Promise<WithMeta<Bar[]>> {
    // the cache only holds daily bars: sliceRange returns [] for intraday (1D/1W) so the chain falls through
    const b = sliceRange(bars(ticker), range);
    return {
      data: b,
      meta: meta(b.length ? [{ id: `nidhiksh:price:${ticker.toUpperCase()}`, name: `${ticker.toUpperCase()} daily bars (Alpaca, split-adjusted, via Nidhiksh cache)`, kind: 'price' }] : [], b.at(-1)?.date),
    };
  },

  async getQuote(ticker: string): Promise<WithMeta<Quote | null>> {
    const d = open();
    const id = instrumentId(ticker);
    if (!d || id == null) return { data: null, meta: meta([]) };
    const rows = d
      .prepare(
        `SELECT timestamp, open, high, low, close, volume FROM price_bars
         WHERE instrument_id = ? AND provider = 'alpaca' AND adjustment = 'split' AND timeframe = '1d'
         ORDER BY timestamp DESC LIMIT 2`,
      )
      .all(id) as { timestamp: string; open: number; high: number; low: number; close: number; volume: number }[];
    if (!rows.length) return { data: null, meta: meta([]) };
    const [last, prev = rows[0]] = rows;
    const m = MOCK_BY_TICKER[ticker.toUpperCase()];
    const shares = m ? (m.mcapB * 1e9) / m.price : 0; // shares outstanding unknown locally; demo estimate
    const change = last.close - prev.close;
    return {
      data: {
        ticker: ticker.toUpperCase(), price: last.close, change: Math.round(change * 100) / 100,
        changePct: prev.close ? Math.round((change / prev.close) * 10000) / 100 : 0,
        open: last.open, high: last.high, low: last.low, prevClose: prev.close, volume: last.volume,
        marketCap: Math.round(shares * last.close), ts: last.timestamp,
      },
      meta: meta([{ id: `nidhiksh:price:${ticker.toUpperCase()}`, name: `${ticker.toUpperCase()} last daily close (Alpaca via Nidhiksh cache)`, kind: 'price' }], last.timestamp),
    };
  },

  async getQuotes(tickers: string[]): Promise<WithMeta<Quote[]>> {
    const out: Quote[] = [];
    for (const t of tickers) {
      const q = await nidhikshProvider.getQuote!(t);
      if (q.data) out.push(q.data);
    }
    return { data: out, meta: meta([]) };
  },

  async getNews(ticker?: string): Promise<WithMeta<NewsItem[]>> {
    const d = open();
    if (!d) return { data: [], meta: meta([]) };
    const sql = `SELECT n.id, i.symbol, n.title, n.url, n.publisher, COALESCE(n.published_at, n.available_at) AS publishedAt, n.payload
                 FROM news_events n JOIN instruments i ON i.id = n.instrument_id
                 ${ticker ? 'WHERE i.symbol = ?' : ''} ORDER BY publishedAt DESC LIMIT 40`;
    const rows = (ticker ? d.prepare(sql).all(ticker.toUpperCase()) : d.prepare(sql).all()) as {
      id: number; symbol: string; title: string; url: string; publisher: string; publishedAt: string; payload: string;
    }[];
    const data: NewsItem[] = rows.map((r) => {
      let tickers = [r.symbol];
      let summary: string | undefined;
      try {
        const p = JSON.parse(r.payload) as { symbols?: string[]; summary?: string };
        if (Array.isArray(p.symbols) && p.symbols.length) tickers = p.symbols;
        if (typeof p.summary === 'string' && p.summary) summary = p.summary;
      } catch { /* ignore */ }
      return { id: `nidhiksh:news:${r.id}`, ticker: r.symbol, tickers, title: r.title, summary, publisher: r.publisher, url: r.url, publishedAt: r.publishedAt };
    });
    return { data, meta: meta(data.slice(0, 5).map((n) => ({ id: n.id, name: `${n.publisher}: ${n.title}`, url: n.url, kind: 'news' as const }))) };
  },

  async getFilings(ticker: string): Promise<WithMeta<Filing[]>> {
    const d = open();
    const id = instrumentId(ticker);
    if (!d || id == null) return { data: [], meta: meta([]) };
    const rows = d
      .prepare(`SELECT accession, form, url, event_time FROM filings WHERE instrument_id = ? ORDER BY event_time DESC LIMIT 60`)
      .all(id) as { accession: string; form: string; url: string; event_time: string }[];
    const data: Filing[] = rows.map((r) => ({
      id: `sec:${r.accession}`, ticker: ticker.toUpperCase(), form: r.form, title: `${r.form} filing`, filedAt: r.event_time.slice(0, 10), url: r.url, accession: r.accession,
    }));
    return { data, meta: meta(data.slice(0, 3).map((f) => ({ id: f.id, name: `${f.ticker} ${f.form} ${f.filedAt}`, url: f.url, kind: 'filing' as const }))) };
  },
};

/** Raw SEC fundamentals payload ({facts, financial_history}) from the local cache, for AI/fundamentals features. */
export function getNidhikshSecFundamentals(ticker: string): { facts: Record<string, unknown>; financial_history: Record<string, unknown[]>; available_at: string; cik?: string } | null {
  const d = open();
  const id = instrumentId(ticker);
  if (!d || id == null) return null;
  const row = d
    .prepare(`SELECT payload, available_at FROM fundamentals WHERE instrument_id = ? AND provider = 'sec' ORDER BY available_at DESC LIMIT 1`)
    .get(id) as { payload: string; available_at: string } | undefined;
  if (!row) return null;
  try {
    const p = JSON.parse(row.payload);
    return { facts: p.facts ?? {}, financial_history: p.financial_history ?? {}, available_at: row.available_at, cik: p.cik != null ? String(p.cik) : undefined };
  } catch {
    return null;
  }
}

export function nidhikshSymbols(): string[] {
  const d = open();
  if (!d) return [];
  return (d.prepare('SELECT symbol FROM instruments ORDER BY symbol').all() as { symbol: string }[]).map((r) => r.symbol);
}
