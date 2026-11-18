#!/usr/bin/env node
/**
 * Build top-institutional-holder (Form 13F) snapshots from the SEC's free bulk "Form 13F data sets".
 *
 *   node scripts/build-13f.mjs            # downloads the latest two quarterly data sets into .cache/13f/ (skipped if present)
 *   node scripts/build-13f.mjs --offline  # never hit the network for the zips (uses whatever is cached)
 *
 * Output (committed — public SEC data):
 *   data/13f/holders-<YYYYQn>.json   per ticker: top 10 holders by value + QoQ change
 *   data/13f/latest.json             same payload + `file` pointer; statically imported by src/lib/data/sec13f.ts
 *
 * Requires SEC_USER_AGENT (env, or read from .env — never printed). SEC fair access: <= 10 req/s (we throttle to ~6/s).
 * Data set page: https://www.sec.gov/data-research/sec-markets-data/form-13f-data-sets
 * Values in INFOTABLE are whole dollars for filings on/after 2023-01-03 (FORM13F_readme: "market value is reported
 * rounded to the nearest dollar. Previously, market value was reported in thousands").
 *
 * Universe: S&P 500 (State Street SPY holdings — includes CUSIP) + Nasdaq-100 (api.nasdaq.com) + data/13f/extra-tickers.json
 * (watchlist names). Tickers without a CUSIP from SPY are mapped by issuer-name matching against the 13F NAMEOFISSUER.
 * Pure helpers are exported for tests (src/lib/data/__tests__/sec13f*.test.ts).
 */
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, '.cache', '13f');
const OUT = path.join(ROOT, 'data', '13f');
export const DATASET_PAGE = 'https://www.sec.gov/data-research/sec-markets-data/form-13f-data-sets';
const SPY_URL = 'https://www.ssga.com/library-content/products/fund-data/etfs/us/holdings-daily-us-en-spy.xlsx';
const NDX_URL = 'https://api.nasdaq.com/api/quote/list-type/nasdaq100';
const TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json';
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const TOP_N = 10;

/** Explicit share-class CUSIPs (name matching can't tell classes of one issuer apart). */
export const CLASS_CUSIPS = { GOOGL: '02079K305', GOOG: '02079K107', 'BRK.B': '084670702', 'BRK.A': '084670108' };
/** Watchlist ETFs (not in company_tickers.json, so no SEC name to match on). */
const FIXED_CUSIPS = { SPY: '78462F103', IVV: '464287200', VOO: '922908363', QQQ: '46090E103' };
const NON_COMMON = /PFD|PREF|\bWT\b|WARRANT|RIGHT|\bUNIT|NOTE|DEB|BOND|\bSR\b|ETF|FUND|\bFD|INDEX|\bTR\b|TRUST/i;
const COMMON = /\bCOM|\bORD|\bSHS\b|\bCL [A-Z]\b|CAP STK|\bADR|\bADS|COMMON|^SHS?$/i;

/**
 * Other CUSIPs that are the same issuer's same security (e.g. a re-domiciled company trading under a new CUSIP while many
 * filers still report the old one): same normalised name, common-stock class, not claimed by another ticker. Issuers with
 * several tickers (share classes) never get aliases.
 */
export function aliasCusips(primary, aggregates, claimed, multiClassNorms) {
  const p = aggregates.find((a) => a.cusip === primary);
  if (!p || multiClassNorms.has(p.norm)) return [];
  if (NON_COMMON.test(p.cls ?? '') || NON_COMMON.test(p.name ?? '')) return []; // funds/trusts share one registrant name
  return aggregates.filter((a) => a.cusip !== primary && a.norm === p.norm && !claimed.has(a.cusip) && COMMON.test(a.cls ?? '') && !NON_COMMON.test(a.cls ?? '')).map((a) => a.cusip);
}

/** Merge per-filer maps (cik -> {shares,value}) of several CUSIPs. */
export function mergeHoldings(maps) {
  const out = new Map();
  for (const m of maps) {
    if (!m) continue;
    for (const [cik, h] of m) {
      const o = out.get(cik) ?? { shares: 0, value: 0 };
      o.shares += h.shares; o.value += h.value;
      out.set(cik, o);
    }
  }
  return out;
}

// ---------------------------------------------------------------- pure helpers (tested)

const MONTHS = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };
/** "30-JUN-2026" -> "2026-06-30" (null when unparseable). */
export function secDate(s) {
  const m = /^(\d{2})-([A-Z]{3})-(\d{4})$/.exec((s ?? '').trim().toUpperCase());
  return m && MONTHS[m[2]] ? `${m[3]}-${MONTHS[m[2]]}-${m[1]}` : null;
}
/** "2026-06-30" -> "2026Q2" */
export function quarterLabel(iso) { return `${iso.slice(0, 4)}Q${Math.ceil(Number(iso.slice(5, 7)) / 3)}`; }

/** Split a TSV header + line into a record keyed by column name. */
export function parseTsvRow(header, line) {
  const cells = line.replace(/\r$/, '').split('\t');
  const o = {};
  for (let i = 0; i < header.length; i++) o[header[i]] = (cells[i] ?? '').trim();
  return o;
}

/**
 * One INFOTABLE row -> { accession, cusip, name, cls, shares, value } or null when it isn't a plain long equity position:
 * PUT/CALL option rows and principal-amount (PRN) rows are excluded.
 */
export function parseInfoRow(r) {
  if ((r.PUTCALL ?? '').trim() !== '') return null;
  if ((r.SSHPRNAMTTYPE ?? '').trim().toUpperCase() !== 'SH') return null;
  const cusip = (r.CUSIP ?? '').trim().toUpperCase();
  if (!/^[0-9A-Z]{9}$/.test(cusip) || cusip === '000000000') return null;
  const shares = Number(r.SSHPRNAMT);
  const value = Number(r.VALUE);
  if (!Number.isFinite(shares) || !Number.isFinite(value) || shares <= 0 || value < 0) return null;
  return { accession: r.ACCESSION_NUMBER, cusip, name: (r.NAMEOFISSUER ?? '').trim(), cls: (r.TITLEOFCLASS ?? '').trim(), shares, value };
}

/**
 * Choose which 13F-HR filings count for each (filer, period).
 * filings: [{ accession, cik, period, filingDate (ISO), type ('13F-HR'|'13F-HR/A'), amendmentType ('RESTATEMENT'|'NEW HOLDINGS'|'') }]
 * Rule: the latest original-or-restatement filing is the base (it replaces everything before it); "NEW HOLDINGS"
 * amendments filed on/after that base are added on top. Returns Map<accession, {cik, period}>.
 */
export function selectFilings(filings) {
  const groups = new Map();
  for (const f of filings) {
    if (f.type !== '13F-HR' && f.type !== '13F-HR/A') continue;
    const k = `${f.cik}|${f.period}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(f);
  }
  const keep = new Map();
  const ord = (a, b) => (a.filingDate === b.filingDate ? (a.accession < b.accession ? -1 : 1) : a.filingDate < b.filingDate ? -1 : 1);
  for (const list of groups.values()) {
    list.sort(ord);
    const isAdd = (f) => f.type === '13F-HR/A' && /NEW HOLDINGS/i.test(f.amendmentType ?? '');
    const bases = list.filter((f) => !isAdd(f));
    const base = bases[bases.length - 1];
    for (const f of list) {
      if (f === base || (isAdd(f) && (!base || ord(f, base) > 0))) keep.set(f.accession, { cik: f.cik, period: f.period });
    }
  }
  return keep;
}

const ABBR = {
  HOLDINGS: 'HLDGS', HOLDING: 'HLDGS', HLDG: 'HLDGS', INTERNATIONAL: 'INTL', TECHNOLOGIES: 'TECH', TECHNOLOGY: 'TECH', TECHNOLOGI: 'TECH', TECHS: 'TECH',
  SYSTEMS: 'SYS', SYSTEM: 'SYS', FINANCIAL: 'FINL', FINANCL: 'FINL', SERVICES: 'SVCS', SERVICE: 'SVCS', SVC: 'SVCS', PHARMACEUTICALS: 'PHARM',
  PHARMACEUTICAL: 'PHARM', PHARMACEUTCLS: 'PHARM', PHARMA: 'PHARM', MANUFACTURING: 'MFG', COMMUNICATIONS: 'COMM', COMMUNICATION: 'COMM', COMMUNICATNS: 'COMM',
  BANCORPORATION: 'BANCORP', AMERICA: 'AMER', AMERICAN: 'AMERN', AMERN: 'AMERN', LABORATORIES: 'LABS', LABORATORY: 'LABS', PRODUCTS: 'PRODS', PRODUCT: 'PRODS',
  RESOURCES: 'RES', ENTERTAINMENT: 'ENTMT', INDUSTRIES: 'INDS', INDUSTRY: 'INDS', MANAGEMENT: 'MGMT', SEMICONDUCTOR: 'SEMICONDUCTOR', SEMICONDUCTORS: 'SEMICONDUCTOR',
  PROPERTIES: 'PPTYS', PROPERTY: 'PPTYS', INVESTMENT: 'INVT', INVESTMENTS: 'INVT', NATIONAL: 'NATL', ELECTRIC: 'ELEC', ENERGY: 'ENRGY', ENERGIES: 'ENRGY',
  BRANDS: 'BRANDS', MATERIALS: 'MATLS', SOLUTIONS: 'SOLUTIONS', NETWORKS: 'NETWORKS', MORTGAGE: 'MTG', REALTY: 'RLTY', HEALTHCARE: 'HEALTHCARE', HLTHCARE: 'HEALTHCARE',
  THERAPEUTICS: 'THERAPEUTICS', BIOSCIENCES: 'BIOSCIENCES', CORPORATE: 'CORP', DEVICES: 'DEVICES', SCIENCES: 'SCIENCES', SCIENCE: 'SCIENCES', COMPANIES: 'COS',
  LIFE: 'LIFE', ENTERPRISES: 'ENTERPRISES', GROUP: 'GROUP', GRP: 'GROUP', MACHINES: 'MACHS', BUSINESS: 'BUSINESS', PETROLEUM: 'PETE', TRUST: 'TR', DIGITAL: 'DIGITAL',
};
const DROP = new Set([
  'INC', 'INCORPORATED', 'CORP', 'CORPORATION', 'CO', 'COMPANY', 'LTD', 'LIMITED', 'PLC', 'LLC', 'LP', 'L', 'P', 'THE', 'NEW', 'DEL', 'DE', 'COM', 'COMMON',
  'STOCK', 'STK', 'SHS', 'SH', 'ORD', 'ORDINARY', 'CL', 'CLASS', 'A', 'B', 'C', 'SA', 'NV', 'N', 'V', 'AG', 'SE', 'ADR', 'ADS', 'SPONSORED', 'SPON', 'CAP',
  'PAR', 'USD', 'VALUE', 'REIT', 'HOLDCO', 'MD', 'NY', 'NJ', 'PA', 'VA', 'OH', 'NC', 'TX', 'IND', 'CALIF', 'MASS', 'MINN', 'WIS', 'DEPOSITARY', 'RECEIPTS', 'SHARES', 'SHARE',
]);
/** Normalised issuer name for matching ("Apple Inc. Common Stock" == "APPLE INC" -> "APPLE"). */
export function normalizeIssuer(name) {
  let s = String(name ?? '').toUpperCase().trim();
  // SEC conformed-name suffixes: "THOMSON REUTERS CORP /CAN/", "ONEOK INC /NEW/", "ARM HOLDINGS PLC /UK"
  for (let i = 0; i < 2; i++) s = s.replace(/\s*\/[A-Z ]{1,6}\/?\s*$/, '');
  s = s
    .replace(/&AMP;/g, '&').replace(/\s*&\s*/g, ' AND ').replace(/\bCOMMON STOCK\b|\bCLASS [A-Z]\b|\bCL [A-Z]\b|\bSERIES [A-Z]\b/g, ' ')
    .replace(/[.,'’()/\\\-]/g, ' ').replace(/[^A-Z0-9 ]/g, ' ');
  const toks = s.split(/\s+/).filter(Boolean).map((t) => ABBR[t] ?? t).filter((t) => !DROP.has(t));
  return toks.join(' ');
}

/**
 * Pick the CUSIP for an issuer name among 13F CUSIP aggregates [{cusip, norm, value}]: exact normalised match first,
 * then compact (no-space) equality, then token-prefix match (13F names are often truncated) where the shorter name covers
 * >= 2/3 of the longer one's tokens. Among matches the CUSIP reported by the most filers wins (`n`; robust to a single
 * filer's mis-keyed value), then the highest total value.
 */
export function matchCusip(names, aggregates) {
  const targets = Array.from(new Set(names.map(normalizeIssuer).filter((n) => n.length >= 2)));
  if (!targets.length) return null;
  // score = number of info-table rows whose issuer name matches (a single mis-keyed row can't win), then total value
  const best = (pred) => {
    let top = null, topScore = 0;
    for (const a of aggregates) {
      const sc = variants(a).reduce((s, [v, rows]) => s + (pred(v) ? rows : 0), 0);
      if (sc > 0 && (!top || sc > topScore || (sc === topScore && a.value > top.value))) { top = a; topScore = sc; }
    }
    return top && topScore >= Math.min(3, top.n ?? 3) ? top : null;
  };
  const compact = (s) => s.replace(/ /g, '');
  const variants = (a) => a.norms ?? [[a.norm, a.n ?? 1]];
  const exact = best((v) => targets.includes(v));
  if (exact) return { cusip: exact.cusip, how: 'name-exact' };
  const tc = targets.map(compact);
  const cmp = best((v) => tc.includes(compact(v)));
  if (cmp) return { cusip: cmp.cusip, how: 'name-compact' };
  // token prefix; the shorter name's last token may itself be truncated ("COCA COLA EUROPACIFIC PARTNE")
  const covers = (short, long) => {
    const st = short.split(' '), lt = long.split(' ');
    if (st.length > lt.length || st.length / lt.length < 2 / 3 || short === long) return false;
    return st.every((tok, i) => tok === lt[i] || (i === st.length - 1 && tok.length >= 4 && lt[i].startsWith(tok)));
  };
  const pre = best((v) => v.length >= 8 && targets.some((t) => t.length >= 8 && (covers(v, t) || covers(t, v))));
  if (pre) return { cusip: pre.cusip, how: 'name-prefix' };
  return null;
}

/** QoQ change in shares; a position absent last quarter counts as +100% (new). */
export function qoqChange(shares, priorShares) {
  const prior = priorShares ?? 0;
  const changeShares = shares - prior;
  const changePct = prior > 0 ? (changeShares / prior) * 100 : shares > 0 ? 100 : 0;
  return { changeShares, changePct: Math.round(changePct * 100) / 100 };
}

const KEEP_UPPER = new Set(['LLC', 'LP', 'LLP', 'PLC', 'NA', 'N.A.', 'FMR', 'UBS', 'AG', 'USA', 'US', 'II', 'III', 'IV', 'BNY', 'JPMORGAN', 'TIAA', 'CREF', 'AXA', 'BMO', 'RBC', 'TD', 'HSBC', 'ING', 'DFA', 'AQR', 'PNC', 'SA', 'NV', 'ETF', 'S&P', 'ABN', 'AMRO', 'BNP', 'CIBC', 'DWS', 'SG', 'T.', 'UBS', 'APG', 'NBIM', 'MFS', 'IFM']);
/** "VANGUARD GROUP INC" -> "Vanguard Group Inc"; mixed-case names are left as filed. */
export function prettyHolder(name) {
  // drop SEC conformed-name state suffixes: "BANK OF AMERICA CORP /DE/" -> "BANK OF AMERICA CORP"
  const n = String(name ?? '').trim().replace(/\s+/g, ' ').replace(/\s*\/[A-Za-z ]{1,6}\/?\s*$/, '');
  if (/[a-z]/.test(n)) return n;
  return n.split(' ').map((w) => {
    if (KEEP_UPPER.has(w) || KEEP_UPPER.has(w.replace(/[,.]$/, ''))) return w;
    if (/^[A-Z]{2,4}$/.test(w) && !/[AEIOUY]/.test(w)) return w; // acronyms like "BNY", "JPM"
    return w.toLowerCase().replace(/(^|[-'/&.(])([a-z])/g, (_m, p, c) => p + c.toUpperCase());
  }).join(' ');
}

/** App ticker form: "BRK-B"/"BRK/B" -> "BRK.B". */
export function normTicker(t) { return String(t ?? '').trim().toUpperCase().replace(/[-/]/g, '.'); }

/** Aggregate per-filer rows of one period into the ranked top-N holder list for a CUSIP. */
export function rankHolders({ cur, prior, names, period, sharesOutstanding, topN = TOP_N }) {
  const total = Array.from(cur.values()).reduce((s, h) => s + h.shares, 0);
  const basis = sharesOutstanding && sharesOutstanding > 0 ? 'outstanding' : '13f';
  const denom = basis === 'outstanding' ? sharesOutstanding : total;
  const ranked = Array.from(cur.entries()).sort((a, b) => b[1].value - a[1].value).slice(0, topN);
  return {
    basis,
    total,
    holders: ranked.map(([cik, h]) => {
      const { changeShares, changePct } = qoqChange(h.shares, prior?.get(cik)?.shares);
      return {
        holder: prettyHolder(names.get(cik) ?? `CIK ${cik}`), cik, shares: h.shares, value: Math.round(h.value),
        pctOfShares: denom > 0 ? Math.round((h.shares / denom) * 1e6) / 1e4 : 0, changeShares, changePct, reportDate: period,
      };
    }),
  };
}

// ---------------------------------------------------------------- IO

function secUserAgent() {
  if (process.env.SEC_USER_AGENT) return process.env.SEC_USER_AGENT;
  const envFile = path.join(ROOT, '.env');
  if (existsSync(envFile)) {
    const m = /^SEC_USER_AGENT=(.*)$/m.exec(readFileSync(envFile, 'utf8'));
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  }
  return '';
}
const SEC_UA = secUserAgent();
let lastSec = 0;
async function secFetch(url, init = {}) {
  const wait = lastSec + 160 - Date.now(); // <= ~6 req/s
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastSec = Date.now();
  const res = await fetch(url, { ...init, headers: { 'User-Agent': SEC_UA, 'Accept-Encoding': 'gzip, deflate', ...(init.headers ?? {}) } });
  if (!res.ok) throw new Error(`SEC ${res.status} for ${url}`);
  return res;
}

function zipEndDate(name) {
  const r = /(\d{2}[a-z]{3}\d{4})_form13f\.zip$/i.exec(name);
  if (r) return secDate(`${r[1].slice(0, 2)}-${r[1].slice(2, 5)}-${r[1].slice(5)}`) ?? '';
  const q = /(\d{4})q(\d)_form13f\.zip$/i.exec(name);
  return q ? `${q[1]}-${String(Number(q[2]) * 3).padStart(2, '0')}-28` : '';
}

async function listDatasets() {
  const html = await (await secFetch(DATASET_PAGE)).text();
  const hrefs = Array.from(new Set(Array.from(html.matchAll(/href="([^"]+_form13f\.zip)"/gi), (m) => m[1])));
  return hrefs.map((h) => ({ url: new URL(h, 'https://www.sec.gov').href, name: path.basename(h), end: zipEndDate(h) }))
    .filter((d) => d.end).sort((a, b) => (a.end < b.end ? 1 : -1));
}

async function ensureZip(ds, offline) {
  const file = path.join(CACHE, ds.name);
  if (existsSync(file) && statSync(file).size > 1e6) return { file, downloaded: false, bytes: statSync(file).size };
  if (offline) throw new Error(`missing ${file} (offline)`);
  const t0 = Date.now();
  const res = await secFetch(ds.url);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(file + '.part'));
  renameSync(file + '.part', file);
  const bytes = statSync(file).size;
  console.log(`  downloaded ${ds.name}: ${(bytes / 1e6).toFixed(1)} MB in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return { file, downloaded: true, bytes };
}

/** Stream a TSV member of a zip line by line via the `unzip` CLI (no full-file buffering). */
async function streamTsv(zip, member, onRow) {
  const child = spawn('unzip', ['-p', zip, member], { stdio: ['ignore', 'pipe', 'inherit'] });
  const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
  let header = null;
  let n = 0;
  for await (const line of rl) {
    if (!header) { header = line.replace(/^﻿/, '').split('\t').map((h) => h.trim()); continue; }
    if (!line) continue;
    onRow(parseTsvRow(header, line));
    n++;
  }
  await new Promise((r) => child.on('close', r));
  return n;
}

async function loadSpy() {
  const { default: ExcelJS } = await import('exceljs');
  const res = await fetch(SPY_URL, { headers: { 'User-Agent': BROWSER_UA } });
  if (!res.ok) throw new Error(`SPY ${res.status}`);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await res.arrayBuffer()));
  const ws = wb.worksheets[0];
  let cols = null;
  const out = [];
  ws.eachRow((row) => {
    const vals = (row.values ?? []).map((v) => (v == null ? '' : typeof v === 'object' && 'text' in v ? String(v.text) : String(v)).trim());
    if (!cols) {
      const t = vals.indexOf('Ticker');
      if (t > 0) cols = { name: vals.indexOf('Name'), ticker: t, id: vals.indexOf('Identifier') };
      return;
    }
    const ticker = vals[cols.ticker];
    if (!ticker || ticker === '-' || !/^[A-Z.]{1,6}$/.test(ticker) || ticker === 'CASH_USD') return;
    const id = (vals[cols.id] ?? '').toUpperCase();
    out.push({ ticker: normTicker(ticker), name: vals[cols.name], cusip: /^[0-9A-Z]{9}$/.test(id) ? id : null });
  });
  return out;
}

async function loadNdx() {
  const res = await fetch(NDX_URL, { headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Nasdaq ${res.status}`);
  const j = await res.json();
  return (j?.data?.data?.rows ?? []).map((r) => ({ ticker: normTicker(r.symbol), name: r.companyName }));
}

async function sharesOutstandingFrames(period) {
  // dei:EntityCommonStockSharesOutstanding instant frames (one call each, all filers). Prefer the report quarter, then the
  // following quarter (10-Q covers are dated after quarter end), then the prior one.
  const y = Number(period.slice(0, 4));
  const q = Math.ceil(Number(period.slice(5, 7)) / 3);
  const frames = [[y, q], q === 4 ? [y + 1, 1] : [y, q + 1], q === 1 ? [y - 1, 4] : [y, q - 1]];
  const byCik = new Map();
  for (const [fy, fq] of frames) {
    try {
      const j = await (await secFetch(`https://data.sec.gov/api/xbrl/frames/dei/EntityCommonStockSharesOutstanding/shares/CY${fy}Q${fq}I.json`)).json();
      for (const d of j.data ?? []) if (!byCik.has(d.cik) && d.val > 0) byCik.set(d.cik, { val: d.val, end: d.end, accn: d.accn });
    } catch (e) {
      console.warn(`  frames CY${fy}Q${fq}I unavailable: ${e.message}`);
    }
  }
  return byCik;
}

function readJson(file, fallback) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return fallback; }
}

// ---------------------------------------------------------------- main

async function main() {
  const t0 = Date.now();
  const offline = process.argv.includes('--offline');
  if (!SEC_UA && !offline) throw new Error('SEC_USER_AGENT is not set (env or .env) — required by SEC fair-access policy');
  mkdirSync(CACHE, { recursive: true });
  mkdirSync(OUT, { recursive: true });

  // 1) data sets: latest two
  let datasets;
  if (offline) {
    const { readdirSync } = await import('node:fs');
    datasets = readdirSync(CACHE).filter((f) => f.endsWith('_form13f.zip')).map((name) => ({ name, url: '', end: zipEndDate(name) })).sort((a, b) => (a.end < b.end ? 1 : -1));
  } else {
    datasets = await listDatasets();
  }
  const [latestDs, priorDs] = datasets;
  if (!latestDs || !priorDs) throw new Error('could not find two 13F data sets');
  console.log(`data sets: ${latestDs.name} (latest), ${priorDs.name} (prior)`);
  const zips = [];
  for (const ds of [latestDs, priorDs]) zips.push({ ds, ...(await ensureZip(ds, offline)) });

  // 2) submissions + cover pages (both zips)
  const filings = [];
  const managerName = new Map(); // cik -> latest filed manager name
  const periodCountsLatest = new Map();
  const periodCountsPrior = new Map();
  for (const [i, z] of zips.entries()) {
    const sub = new Map();
    await streamTsv(z.file, 'SUBMISSION.tsv', (r) => {
      const period = secDate(r.PERIODOFREPORT);
      if (!period) return;
      sub.set(r.ACCESSION_NUMBER, { accession: r.ACCESSION_NUMBER, cik: String(Number(r.CIK)), period, filingDate: secDate(r.FILING_DATE) ?? '', type: r.SUBMISSIONTYPE });
      if (r.SUBMISSIONTYPE === '13F-HR') { const m = i === 0 ? periodCountsLatest : periodCountsPrior; m.set(period, (m.get(period) ?? 0) + 1); }
    });
    await streamTsv(z.file, 'COVERPAGE.tsv', (r) => {
      const s = sub.get(r.ACCESSION_NUMBER);
      if (!s) return;
      s.amendmentType = r.AMENDMENTTYPE ?? '';
      s.managerName = r.FILINGMANAGER_NAME;
      s.reportType = r.REPORTTYPE ?? '';
    });
    for (const s of sub.values()) {
      if (/NOTICE/i.test(s.reportType ?? '')) continue;
      filings.push(s);
    }
  }
  const mode = (m) => Array.from(m.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];
  const period = mode(periodCountsLatest);
  let priorPeriod = mode(periodCountsPrior);
  if (!period) throw new Error('no 13F-HR filings in latest data set');
  if (!priorPeriod || priorPeriod >= period) priorPeriod = null;
  for (const f of filings.sort((a, b) => (a.filingDate < b.filingDate ? -1 : 1))) if (f.managerName) managerName.set(f.cik, f.managerName);
  const kept = selectFilings(filings.filter((f) => f.period === period || f.period === priorPeriod));
  console.log(`period ${period} (prior ${priorPeriod}); ${filings.length} holdings filings, ${kept.size} selected after amendment handling`);

  // 3) pass 1 over latest-period info tables: CUSIP aggregates for name matching
  const agg = new Map(); // cusip -> { value, shares, names: Map }
  let rowsTotal = 0, rowsOptions = 0;
  for (const z of zips) {
    rowsTotal += await streamTsv(z.file, 'INFOTABLE.tsv', (r) => {
      const k = kept.get(r.ACCESSION_NUMBER);
      if (!k || k.period !== period) return;
      if ((r.PUTCALL ?? '') !== '') { rowsOptions++; return; }
      const row = parseInfoRow(r);
      if (!row) return;
      let a = agg.get(row.cusip);
      if (!a) agg.set(row.cusip, (a = { value: 0, n: 0, names: new Map(), classes: new Map() }));
      a.value += row.value;
      a.n++;
      if (a.names.size < 30 || a.names.has(row.name)) a.names.set(row.name, (a.names.get(row.name) ?? 0) + 1);
      if (a.classes.size < 8 || a.classes.has(row.cls)) a.classes.set(row.cls, (a.classes.get(row.cls) ?? 0) + row.value);
    });
  }
  const top1 = (m) => Array.from(m.entries()).sort((x, y) => y[1] - x[1])[0]?.[0] ?? '';
  const aggregates = Array.from(agg.entries()).map(([cusip, a]) => {
    const name = top1(a.names);
    return { cusip, name, cls: top1(a.classes), norm: normalizeIssuer(name), norms: Array.from(Array.from(a.names.entries()).reduce((m, [nm, rows]) => { const k = normalizeIssuer(nm); return m.set(k, (m.get(k) ?? 0) + rows); }, new Map()).entries()), value: a.value, n: a.n };
  });
  const aggBy = new Map(aggregates.map((a) => [a.cusip, a]));
  console.log(`pass 1: ${rowsTotal.toLocaleString()} info-table rows scanned, ${rowsOptions.toLocaleString()} put/call rows excluded, ${aggregates.length.toLocaleString()} CUSIPs in ${period}`);

  // 4) universe + CUSIP mapping
  const prev = readJson(path.join(OUT, 'latest.json'), null);
  const prevCusip = new Map(Object.entries(prev?.tickers ?? {}).map(([t, v]) => [t, v.cusip]));
  const sources = { dataset: DATASET_PAGE, zips: zips.map((z) => z.ds.url).filter(Boolean), spy: SPY_URL, ndx: NDX_URL, tickers: TICKERS_URL };
  const universe = new Map(); // ticker -> { names: [], cusip, how }
  let spy = [], ndx = [];
  try { spy = await loadSpy(); } catch (e) { console.warn(`  SPY holdings unavailable (${e.message}); falling back to previous mapping`); }
  try { ndx = await loadNdx(); } catch (e) { console.warn(`  Nasdaq-100 list unavailable (${e.message}); falling back to previous mapping`); }
  let secTickers = {};
  try { secTickers = await (await secFetch(TICKERS_URL)).json(); } catch (e) { console.warn(`  company_tickers.json unavailable: ${e.message}`); }
  const secByTicker = new Map(Object.values(secTickers).map((v) => [normTicker(v.ticker), v]));
  const extra = [...readJson(path.join(OUT, 'extra-tickers.json'), []), ...(process.env.THIRTEENF_EXTRA_TICKERS ?? '').split(',')].map(normTicker).filter(Boolean);
  const add = (ticker, name, cusip, how) => {
    const u = universe.get(ticker) ?? { names: [], cusip: null, how: null };
    if (name) u.names.push(name);
    if (cusip && !u.cusip) { u.cusip = cusip; u.how = how; }
    universe.set(ticker, u);
  };
  for (const s of spy) add(s.ticker, s.name, s.cusip && agg.has(s.cusip) ? s.cusip : null, 'spy-cusip');
  for (const n of ndx) add(n.ticker, n.name, null, null);
  for (const t of extra) add(t, null, null, null);
  if (!spy.length || !ndx.length) for (const t of prevCusip.keys()) add(t, null, null, null);
  const byHow = {};
  for (const [ticker, u] of universe) {
    const sec = secByTicker.get(ticker);
    if (sec) u.names.push(sec.title);
    u.cik = sec ? String(sec.cik_str) : null;
    if (CLASS_CUSIPS[ticker] && agg.has(CLASS_CUSIPS[ticker])) { u.cusip = CLASS_CUSIPS[ticker]; u.how = 'class-override'; }
    if (!u.cusip && FIXED_CUSIPS[ticker] && agg.has(FIXED_CUSIPS[ticker])) { u.cusip = FIXED_CUSIPS[ticker]; u.how = 'fixed'; }
    if (!u.cusip) {
      const m = matchCusip(u.names, aggregates);
      if (m) { u.cusip = m.cusip; u.how = m.how; }
      // last resort when the SPY/Nasdaq lists were unreachable: reuse a previously verified (non-heuristic) mapping
      else if (prevCusip.get(ticker) && agg.has(prevCusip.get(ticker)) && ['spy-cusip', 'class-override', 'fixed', 'previous'].includes(prev?.tickers?.[ticker]?.map)) { u.cusip = prevCusip.get(ticker); u.how = 'previous'; }
    }
    byHow[u.how ?? 'unmatched'] = (byHow[u.how ?? 'unmatched'] ?? 0) + 1;
  }
  const matched = Array.from(universe.values()).filter((u) => u.cusip).length;
  console.log(`universe ${universe.size} tickers (SPY ${spy.length}, NDX ${ndx.length}, extra ${extra.length}); matched ${matched} (${((matched / universe.size) * 100).toFixed(1)}%)`, byHow);
  const unmatched = Array.from(universe.entries()).filter(([, u]) => !u.cusip).map(([t]) => t);
  if (unmatched.length) console.log(`  unmatched: ${unmatched.join(', ')}`);

  // 5) pass 2: per-filer holdings for target CUSIPs, both periods
  const claimed = new Set(Array.from(universe.values()).map((u) => u.cusip).filter(Boolean));
  const normCount = new Map();
  for (const c of claimed) { const n = aggBy.get(c)?.norm; if (n) normCount.set(n, (normCount.get(n) ?? 0) + 1); }
  for (const t of Object.keys(CLASS_CUSIPS)) { const n = aggBy.get(CLASS_CUSIPS[t])?.norm; if (n) normCount.set(n, 2); }
  const multiClassNorms = new Set(Array.from(normCount.entries()).filter(([, n]) => n > 1).map(([k]) => k));
  let aliasCount = 0;
  for (const u of universe.values()) {
    u.cusips = u.cusip ? [u.cusip, ...aliasCusips(u.cusip, aggregates, claimed, multiClassNorms)] : [];
    aliasCount += Math.max(0, u.cusips.length - 1);
  }
  console.log(`  ${aliasCount} alias CUSIPs merged (same issuer/security reported under another CUSIP)`);
  const targets = new Set(Array.from(universe.values()).flatMap((u) => u.cusips));
  const hold = { [period]: new Map(), ...(priorPeriod ? { [priorPeriod]: new Map() } : {}) }; // period -> cusip -> cik -> {shares,value}
  for (const z of zips) {
    await streamTsv(z.file, 'INFOTABLE.tsv', (r) => {
      const k = kept.get(r.ACCESSION_NUMBER);
      if (!k || !hold[k.period]) return;
      const cusip = (r.CUSIP ?? '').trim().toUpperCase();
      if (!targets.has(cusip)) return;
      const row = parseInfoRow(r);
      if (!row) return;
      const byCusip = hold[k.period];
      if (!byCusip.has(cusip)) byCusip.set(cusip, new Map());
      const m = byCusip.get(cusip);
      const h = m.get(k.cik) ?? { shares: 0, value: 0 };
      h.shares += row.shares; h.value += row.value;
      m.set(k.cik, h);
    });
  }

  // sanity: drop filer positions whose implied price is > 4x off the CUSIP's median (unit / data-entry errors)
  let dropped = 0;
  for (const byCusip of Object.values(hold)) {
    for (const m of byCusip.values()) {
      const prices = Array.from(m.values()).filter((h) => h.value > 0).map((h) => h.value / h.shares).sort((a, b) => a - b);
      const med = prices[Math.floor(prices.length / 2)];
      if (!med) continue;
      for (const [cik, h] of m) { const p = h.value / h.shares; if (p > med * 4 || p < med / 4) { m.delete(cik); dropped++; } }
    }
  }

  // 6) shares outstanding (dei cover facts) for % of outstanding
  const so = offline ? new Map() : await sharesOutstandingFrames(period);
  const tickersOut = {};
  let withPctOut = 0;
  for (const [ticker, u] of Array.from(universe.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
    if (!u.cusip) continue;
    const cur = mergeHoldings(u.cusips.map((c) => hold[period].get(c)));
    if (!cur.size) continue;
    const prior = priorPeriod ? mergeHoldings(u.cusips.map((c) => hold[priorPeriod].get(c))) : null;
    // multi-class issuers report class-specific counts (not in the non-dimensional frame) — don't divide a class by all classes
    const isClass = Object.prototype.hasOwnProperty.call(CLASS_CUSIPS, ticker);
    let sharesOut = !isClass && u.cik ? so.get(Number(u.cik))?.val ?? null : null;
    const r0 = rankHolders({ cur, prior, names: managerName, period, sharesOutstanding: sharesOut });
    // a top holder above 60% of "outstanding" means the cover figure is a different class/unit — fall back to 13F basis
    const r = sharesOut && r0.holders[0] && r0.holders[0].pctOfShares > 60
      ? rankHolders({ cur, prior, names: managerName, period, sharesOutstanding: null })
      : r0;
    if (r.basis === 'outstanding') withPctOut++; else sharesOut = null;
    tickersOut[ticker] = {
      cusip: u.cusip, ...(u.cusips.length > 1 ? { aliases: u.cusips.slice(1) } : {}), issuer: aggBy.get(u.cusip)?.name ?? "", map: u.how, basis: r.basis,
      ...(sharesOut ? { sharesOutstanding: sharesOut } : {}), holderCount: cur.size, total13fShares: r.total,
      h: r.holders.map((x) => [x.holder, x.cik, x.shares, x.value, x.pctOfShares, x.changeShares, x.changePct]),
    };
  }

  const quarter = quarterLabel(period);
  const file = `holders-${quarter}.json`;
  const payload = {
    schema: 1, period, quarter, priorPeriod, generatedAt: new Date().toISOString(),
    datasets: zips.map((z) => ({ name: z.ds.name, url: z.ds.url || null })), sources,
    note: 'Top 10 13F-HR filers by reported value per ticker. Values in USD. pct: % of shares outstanding (dei:EntityCommonStockSharesOutstanding) when basis="outstanding", else % of total 13F-reported shares. changePct=100 marks a position new this quarter. Excludes PUT/CALL and PRN rows.',
    fields: ['holder', 'cik', 'shares', 'value', 'pct', 'changeShares', 'changePct'],
    tickers: tickersOut,
  };
  // keep generatedAt when nothing else changed, so the scheduled workflow only commits real updates
  const strip = (o) => JSON.stringify({ ...o, generatedAt: undefined });
  const existing = readJson(path.join(OUT, file), null);
  if (existing && strip(existing) === strip(payload)) payload.generatedAt = existing.generatedAt;
  const json = JSON.stringify(payload);
  writeFileSync(path.join(OUT, file), json + '\n');
  writeFileSync(path.join(OUT, 'latest.json'), JSON.stringify({ file, ...payload }) + '\n');
  console.log(`wrote data/13f/${file} (${(json.length / 1024).toFixed(0)} KB): ${Object.keys(tickersOut).length} tickers, ${withPctOut} with % of outstanding, ${dropped} outlier positions dropped`);

  for (const t of ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'JPM', 'XOM', 'LLY', 'BRK.B']) {
    const x = tickersOut[t];
    console.log(`  ${t.padEnd(6)} ${x ? `${x.cusip} ${x.issuer} [${x.map}, ${x.basis}] top: ${x.h.slice(0, 3).map((h) => `${h[0]} ${h[4]}%`).join('; ')}` : 'MISSING'}`);
  }
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((e) => { console.error(e.stack ?? e.message); process.exit(1); });
}
