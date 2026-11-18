import 'server-only';
import type { Filing, FinancialPeriod, Financials, InsiderTxn, PartialProvider, SourceRef, WithMeta } from './types';
import { parseForm4 } from './secForm4';
import { factMapFromCompanyFacts, mapSecFinancials, secFilingUrl, type FactMap, type XbrlFact } from './secFinancials';
import { getNidhikshSecFundamentals } from './nidhiksh';
import { cache } from '../cache';
import { log } from '../log';

/** SEC EDGAR live adapter (filings via submissions API; companyfacts helper). Requires SEC_USER_AGENT. 24h cache. */
const NAME = 'SEC EDGAR';
const DAY_MS = 24 * 3600_000;
const TIMEOUT_MS = 8000;
let disabledUntil = 0; // simple circuit breaker after network failure

export function secEnabled(): boolean {
  return !!process.env.SEC_USER_AGENT && process.env.ALPHADESK_FORCE_MOCK !== '1' && Date.now() > disabledUntil;
}

async function secJson<T>(url: string): Promise<T> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': process.env.SEC_USER_AGENT ?? '', Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`sec: HTTP ${res.status}`);
    return (await res.json()) as T;
  } catch (e) {
    if ((e as Error).name === 'TimeoutError' || (e as Error).message.includes('fetch failed')) disabledUntil = Date.now() + 5 * 60_000;
    log.debug('sec.fetch_failed', { url, err: (e as Error).message });
    throw e;
  }
}

export async function secCikFor(ticker: string): Promise<string | null> {
  const map = await cache.wrap(
    'sec:tickers',
    async () => {
      const j = await secJson<Record<string, { cik_str: number; ticker: string }>>('https://www.sec.gov/files/company_tickers.json');
      const m: Record<string, string> = {};
      for (const v of Object.values(j)) m[v.ticker.toUpperCase()] = String(v.cik_str).padStart(10, '0');
      return m;
    },
    DAY_MS,
  );
  return map[ticker.toUpperCase().replace('.', '-')] ?? null;
}

interface Submissions {
  filings: { recent: { accessionNumber: string[]; filingDate: string[]; reportDate: string[]; form: string[]; primaryDocument: string[]; primaryDocDescription: string[] } };
}

/** Raw XBRL companyfacts (large JSON). Cached 24h. */
export async function secCompanyFacts(ticker: string): Promise<unknown | null> {
  if (!secEnabled()) return null;
  const cik = await secCikFor(ticker);
  if (!cik) return null;
  return cache.wrap(`sec:facts:${cik}`, () => secJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`), DAY_MS);
}

interface SecFin { annual: Financials | null; quarterly: Financials | null; cik: string | null; origin: 'live' | 'cache'; asOf: string }

/** Both statement sets mapped from XBRL facts. Live companyfacts (24h cache, mapped result only), else the Nidhiksh cache. */
async function secFinancials(ticker: string): Promise<SecFin | null> {
  const T = ticker.toUpperCase();
  if (secEnabled()) {
    try {
      const live = await cache.wrap(`sec:fin:${T}`, async () => {
        const cik = await secCikFor(T);
        if (!cik) return null;
        const facts = factMapFromCompanyFacts(await secJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`));
        return { annual: mapSecFinancials(T, facts, 'annual'), quarterly: mapSecFinancials(T, facts, 'quarterly'), cik, origin: 'live' as const, asOf: new Date().toISOString() };
      }, DAY_MS);
      if (live && (live.annual || live.quarterly)) return live;
    } catch (e) {
      log.debug('sec.financials_failed', { ticker: T, err: (e as Error).message });
    }
  }
  const local = getNidhikshSecFundamentals(T);
  if (!local) return null;
  const facts: FactMap = {};
  for (const [tag, list] of Object.entries(local.financial_history)) facts[tag] = list as XbrlFact[];
  for (const [tag, f] of Object.entries(local.facts)) if (f && typeof f === 'object') (facts[tag] ??= []).push(f as XbrlFact);
  const cik = local.cik ?? null;
  return { annual: mapSecFinancials(T, facts, 'annual'), quarterly: mapSecFinancials(T, facts, 'quarterly'), cik, origin: 'cache', asOf: local.available_at };
}

const FORMS = new Set(['10-K', '10-Q', '8-K', 'DEF 14A', 'S-1', '20-F', '6-K', '10-K/A', '10-Q/A']);

export const secProvider: PartialProvider = {
  name: NAME,

  async getFinancials(ticker: string, period: FinancialPeriod): Promise<WithMeta<Financials | null>> {
    const f = await secFinancials(ticker);
    const data = f ? (period === 'annual' ? f.annual : f.quarterly) : null;
    const last = data?.rows.at(-1);
    const accn = last?.sourceId?.replace(/^sec:/, '');
    const src: SourceRef[] = last && accn ? [{
      id: last.sourceId!, name: `${data!.ticker} ${period === 'annual' ? '10-K' : '10-Q/10-K'} XBRL financial data (SEC EDGAR${f!.origin === 'cache' ? ', via Nidhiksh cache' : ''})`,
      url: f!.cik ? secFilingUrl(f!.cik, accn) : undefined, kind: 'filing',
      excerpt: `${data!.rows.length} ${period} periods mapped from us-gaap XBRL facts; latest period ended ${last.periodEnd} (accession ${accn}).`,
      locator: 'XBRL companyfacts',
    }] : [];
    return { data, meta: { source: src, isMock: false, asOf: f?.asOf ?? new Date().toISOString(), provider: f?.origin === 'cache' ? 'SEC EDGAR (Nidhiksh cache)' : NAME } };
  },
  /** Insider transactions from the latest Form 4 filings (raw XML), refreshed hourly. */
  async getInsiders(ticker: string): Promise<WithMeta<InsiderTxn[]>> {
    const T = ticker.toUpperCase();
    const empty = { data: [] as InsiderTxn[], meta: { source: [], isMock: false, asOf: new Date().toISOString(), provider: NAME } };
    if (!secEnabled()) return empty;
    const cik = await secCikFor(T);
    if (!cik) return empty;
    const cikInt = String(Number(cik));
    const data = await cache.wrap(`sec:form4:${cik}`, async () => {
      const sub = await secJson<Submissions>(`https://data.sec.gov/submissions/CIK${cik}.json`);
      const r = sub.filings.recent;
      const docs: { acc: string; url: string; xmlUrl: string }[] = [];
      for (let i = 0; i < r.form.length && docs.length < 20; i++) {
        if (r.form[i] !== '4') continue;
        const acc = r.accessionNumber[i];
        const base = `https://www.sec.gov/Archives/edgar/data/${cikInt}/${acc.replace(/-/g, '')}/`;
        const doc = r.primaryDocument[i];
        docs.push({ acc, url: base + doc, xmlUrl: base + doc.split('/').pop() });
      }
      const out: InsiderTxn[] = [];
      for (const d of docs) { // sequential: stays well under SEC's 10 requests/second
        try {
          const res = await fetch(d.xmlUrl, { headers: { 'User-Agent': process.env.SEC_USER_AGENT ?? '' }, signal: AbortSignal.timeout(TIMEOUT_MS), cache: 'no-store' });
          if (res.ok) out.push(...parseForm4(await res.text(), T, d.url, d.acc));
        } catch (e) { log.debug('sec.form4_failed', { acc: d.acc, err: (e as Error).message }); }
      }
      return out.sort((a, b) => b.date.localeCompare(a.date));
    }, 3600_000);
    return {
      data,
      meta: { source: data.slice(0, 3).map((t) => ({ id: t.id, name: `${T} Form 4 · ${t.insider} · ${t.date}`, url: t.filingUrl, kind: 'ownership' as const })), isMock: false, asOf: new Date().toISOString(), provider: `${NAME} Form 4` },
    };
  },
  async getFilings(ticker: string): Promise<WithMeta<Filing[]>> {
    const T = ticker.toUpperCase();
    const empty = { data: [] as Filing[], meta: { source: [], isMock: false, asOf: new Date().toISOString(), provider: NAME } };
    if (!secEnabled()) return empty;
    const cik = await secCikFor(T);
    if (!cik) return empty;
    const sub = await cache.wrap(`sec:sub:${cik}`, () => secJson<Submissions>(`https://data.sec.gov/submissions/CIK${cik}.json`), DAY_MS);
    const r = sub.filings.recent;
    const cikInt = String(Number(cik));
    const data: Filing[] = [];
    for (let i = 0; i < r.form.length && data.length < 40; i++) {
      if (!FORMS.has(r.form[i])) continue;
      const acc = r.accessionNumber[i];
      data.push({
        id: `sec:${acc}`, ticker: T, form: r.form[i], title: r.primaryDocDescription[i] || `${r.form[i]} filing`, filedAt: r.filingDate[i],
        periodOfReport: r.reportDate[i] || undefined, accession: acc,
        url: `https://www.sec.gov/Archives/edgar/data/${cikInt}/${acc.replace(/-/g, '')}/${r.primaryDocument[i]}`,
      });
    }
    return {
      data,
      meta: { source: data.slice(0, 3).map((f) => ({ id: f.id, name: `${T} ${f.form} ${f.filedAt}`, url: f.url, kind: 'filing' as const })), isMock: false, asOf: new Date().toISOString(), provider: NAME },
    };
  },
};
