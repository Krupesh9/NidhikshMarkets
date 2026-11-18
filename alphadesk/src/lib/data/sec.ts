import 'server-only';
import type { Filing, FinancialPeriod, Financials, GicsSector, InsiderTxn, PartialProvider, Profile, SourceRef, WithMeta } from './types';
import { parseForm4 } from './secForm4';
import { factMapFromCompanyFacts, mapSecFinancials, secFilingUrl, type FactMap, type XbrlFact } from './secFinancials';
import { getNidhikshSecFundamentals } from './nidhiksh';
import { cache } from '../cache';
import { log } from '../log';
import { meteredFetch } from '../usage-meter';

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
    const res = await meteredFetch('sec', url, {
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
  name?: string;
  sic?: string;
  sicDescription?: string;
  exchanges?: string[];
  website?: string;
  addresses?: { business?: { city?: string; stateOrCountry?: string } };
  filings: { recent: { accessionNumber: string[]; filingDate: string[]; reportDate: string[]; form: string[]; primaryDocument: string[]; primaryDocDescription: string[] } };
}

/** Rough SIC → GICS sector mapping for the SEC profile fallback (the SIC description is shown as the industry). */
export function sicToGics(sicCode?: string): GicsSector {
  const n = Number(sicCode);
  if (!Number.isFinite(n)) return 'Industrials';
  const inRange = (a: number, b: number) => n >= a && n <= b;
  if ([3570, 3571, 3572, 3576, 3577, 3578, 3579, 3661, 3663, 3669, 3672, 3674, 3677, 3678, 3679].includes(n) || inRange(7370, 7379) || inRange(3825, 3829)) return 'Information Technology';
  if (inRange(4800, 4899) || inRange(2710, 2799) || inRange(7810, 7841)) return 'Communication Services';
  if (inRange(2830, 2836) || inRange(3841, 3851) || inRange(8000, 8099) || n === 5122) return 'Health Care';
  if (inRange(6000, 6411) || inRange(6700, 6799)) return 'Financials';
  if (inRange(6500, 6553) || n === 6798) return 'Real Estate';
  if (inRange(1300, 1389) || inRange(2900, 2999) || n === 4922 || n === 4923) return 'Energy';
  if (inRange(4900, 4991)) return 'Utilities';
  if (inRange(1000, 1499) || inRange(2600, 2699) || inRange(2800, 2829) || inRange(2840, 2899) || inRange(3300, 3399)) return 'Materials';
  if (inRange(2000, 2199) || inRange(5400, 5499) || inRange(2840, 2844) || n === 5331 || n === 5399) return 'Consumer Staples';
  if (inRange(5000, 5999) || inRange(7000, 7099) || inRange(3711, 3716) || inRange(2300, 2399) || inRange(5800, 5899)) return 'Consumer Discretionary';
  return 'Industrials';
}

const titleCase = (s: string) => s.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()).replace(/\b(Inc|Corp|Co|Ltd|Plc|Llc|Lp)\b/g, (w) => w);

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
  /** Company profile fallback from SEC submissions (official name, SIC industry, exchange, HQ). No daily limit. */
  async getProfile(ticker: string): Promise<WithMeta<Profile | null>> {
    const T = ticker.toUpperCase();
    const empty = { data: null, meta: { source: [], isMock: false, asOf: new Date().toISOString(), provider: NAME } };
    if (!secEnabled()) return empty;
    const cik = await secCikFor(T);
    if (!cik) return empty;
    const sub = await cache.wrap(`sec:sub:${cik}`, () => secJson<Submissions>(`https://data.sec.gov/submissions/CIK${cik}.json`), DAY_MS);
    if (!sub?.name) return empty;
    const biz = sub.addresses?.business;
    const data: Profile = {
      ticker: T, name: titleCase(sub.name), sector: sicToGics(sub.sic), industry: sub.sicDescription ?? '', country: 'US',
      exchange: sub.exchanges?.[0] ?? '', description: '', employees: 0, founded: 0,
      hq: [biz?.city, biz?.stateOrCountry].filter(Boolean).map((x) => titleCase(String(x))).join(', '),
      website: sub.website ?? '', ceo: '', cik, marketCap: 0, sharesOutstanding: 0, beta: 0, dividendYield: 0,
      pe: 0, forwardPe: 0, evEbitda: 0, priceToSales: 0, week52High: 0, week52Low: 0,
    };
    return { data, meta: { source: [{ id: `sec:profile:${cik}`, name: `${T} company information (SEC EDGAR)`, url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}`, kind: 'filing' }], isMock: false, asOf: new Date().toISOString(), provider: NAME } };
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
      let failed = 0;
      for (const d of docs) { // sequential + paced (≤ ~8/s): stays under SEC's 10 requests/second even when fast
        const started = Date.now();
        try {
          const res = await meteredFetch('sec', d.xmlUrl, { headers: { 'User-Agent': process.env.SEC_USER_AGENT ?? '' }, signal: AbortSignal.timeout(TIMEOUT_MS), cache: 'no-store' });
          if (res.ok) out.push(...parseForm4(await res.text(), T, d.url, d.acc));
          else failed++;
        } catch (e) { failed++; log.debug('sec.form4_failed', { acc: d.acc, err: (e as Error).message }); }
        const wait = 125 - (Date.now() - started);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      }
      // every filing failed (e.g. SEC 429 throttling): don't cache an empty list for an hour
      if (docs.length && failed === docs.length) throw new Error('sec: all Form 4 fetches failed');
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
