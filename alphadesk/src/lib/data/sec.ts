import 'server-only';
import type { Filing, PartialProvider, WithMeta } from './types';
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

const FORMS = new Set(['10-K', '10-Q', '8-K', 'DEF 14A', 'S-1', '20-F', '6-K', '10-K/A', '10-Q/A']);

export const secProvider: PartialProvider = {
  name: NAME,
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
