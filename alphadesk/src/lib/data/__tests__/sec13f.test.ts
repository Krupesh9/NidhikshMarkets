import { describe, expect, it } from 'vitest';
import {
  aliasCusips, matchCusip, mergeHoldings, normalizeIssuer, normTicker, parseInfoRow, parseTsvRow, prettyHolder, qoqChange,
  quarterLabel, rankHolders, secDate, selectFilings,
} from '../../../../scripts/build-13f.mjs';
import { holdingsFromSnapshot, sec13fProvider, type Snapshot } from '../sec13f';

const HEADER = 'ACCESSION_NUMBER\tINFOTABLE_SK\tNAMEOFISSUER\tTITLEOFCLASS\tCUSIP\tFIGI\tVALUE\tSSHPRNAMT\tSSHPRNAMTTYPE\tPUTCALL\tINVESTMENTDISCRETION'.split('\t');
const row = (o: Record<string, string>) => parseTsvRow(HEADER, HEADER.map((h) => o[h] ?? '').join('\t'));

describe('13F TSV parsing', () => {
  it('parses an INFOTABLE row into a long share position', () => {
    const r = parseTsvRow(HEADER, '0001-26-1\t1\tAPPLE INC\tCOM\t037833100\t\t2894000\t10000\tSH\t\tSOLE\r');
    expect(parseInfoRow(r)).toEqual({ accession: '0001-26-1', cusip: '037833100', name: 'APPLE INC', cls: 'COM', shares: 10000, value: 2894000 });
  });
  it('excludes PUT/CALL rows, principal amounts and junk CUSIPs', () => {
    const base = { ACCESSION_NUMBER: 'a', NAMEOFISSUER: 'APPLE INC', CUSIP: '037833100', VALUE: '100', SSHPRNAMT: '10', SSHPRNAMTTYPE: 'SH' };
    expect(parseInfoRow(row({ ...base, PUTCALL: 'Put' }))).toBeNull();
    expect(parseInfoRow(row({ ...base, PUTCALL: 'CALL' }))).toBeNull();
    expect(parseInfoRow(row({ ...base, SSHPRNAMTTYPE: 'PRN' }))).toBeNull();
    expect(parseInfoRow(row({ ...base, CUSIP: '000000000' }))).toBeNull();
    expect(parseInfoRow(row({ ...base, SSHPRNAMT: '0' }))).toBeNull();
    expect(parseInfoRow(row({ ...base, CUSIP: '037833100' }))).not.toBeNull();
  });
  it('converts SEC dates and quarter labels', () => {
    expect(secDate('30-JUN-2026')).toBe('2026-06-30');
    expect(secDate('31-Mar-2026')).toBe('2026-03-31');
    expect(secDate('bad')).toBeNull();
    expect(quarterLabel('2026-06-30')).toBe('2026Q2');
    expect(quarterLabel('2025-12-31')).toBe('2025Q4');
  });
});

describe('amendment handling', () => {
  const f = (accession: string, filingDate: string, type: string, amendmentType = '', cik = '1', period = '2026-06-30') => ({ accession, cik, period, filingDate, type, amendmentType });
  it('latest restatement replaces the original; new-holdings amendments after it are added', () => {
    const kept = selectFilings([
      f('orig', '2026-08-10', '13F-HR'),
      f('addEarly', '2026-08-11', '13F-HR/A', 'NEW HOLDINGS'),
      f('restate', '2026-08-20', '13F-HR/A', 'RESTATEMENT'),
      f('addLate', '2026-08-25', '13F-HR/A', 'NEW HOLDINGS'),
      f('other', '2026-08-01', '13F-HR', '', '2'),
      f('notice', '2026-08-01', '13F-NT', '', '3'),
    ]);
    expect(Array.from(kept.keys()).sort()).toEqual(['addLate', 'other', 'restate']);
  });
  it('keeps original plus additions when there is no restatement, per period', () => {
    const kept = selectFilings([
      f('q2', '2026-08-10', '13F-HR'), f('q2add', '2026-08-12', '13F-HR/A', 'NEW HOLDINGS'), f('q1', '2026-05-10', '13F-HR', '', '1', '2026-03-31'),
    ]);
    expect(Array.from(kept.keys()).sort()).toEqual(['q1', 'q2', 'q2add']);
    expect(kept.get('q1')).toEqual({ cik: '1', period: '2026-03-31' });
  });
});

describe('issuer name normalisation and CUSIP matching', () => {
  it('normalises company-name noise', () => {
    expect(normalizeIssuer('Apple Inc. Common Stock')).toBe('APPLE');
    expect(normalizeIssuer('APPLE INC')).toBe('APPLE');
    expect(normalizeIssuer('THOMSON REUTERS CORP /CAN/')).toBe('THOMSON REUTERS');
    expect(normalizeIssuer('Taiwan Semiconductor Manufacturing Co Ltd')).toBe(normalizeIssuer('TAIWAN SEMICONDUCTOR MFG LTD'));
    expect(normalizeIssuer('JPMORGAN CHASE & CO')).toBe('JPMORGAN CHASE AND');
    expect(normalizeIssuer('Alphabet Inc. Class A Common Stock')).toBe('ALPHABET');
  });
  const aggs = [
    { cusip: '874039100', norm: 'TAIWAN SEMICONDUCTOR MANUFAC', norms: [['TAIWAN SEMICONDUCTOR MANUFAC', 3500], ['TAIWAN SEMICONDUCTOR MFG', 270]], value: 3e11, n: 3770 },
    { cusip: '006889106', norm: 'TAIWAN SEMICONDUCTOR MFG', norms: [['TAIWAN SEMICONDUCTOR MFG', 2]], value: 9e11, n: 2 },
    { cusip: 'G25839104', norm: 'COCA COLA EUROPACIFIC PARTNE', value: 1e10, n: 744 },
    { cusip: '191216100', norm: 'COCA COLA', value: 2e11, n: 5000 },
    { cusip: '665859104', norm: 'NORTHERN TR', norms: [['NORTHERN TR', 900], ['NEBIUS GROUP', 1]], value: 5e10, n: 901 },
    { cusip: 'N97284108', norm: 'NEBIUS GROUP', value: 1e10, n: 400 },
  ];
  it('prefers the CUSIP most filers report under the name (robust to a mis-keyed value)', () => {
    expect(matchCusip(['Taiwan Semiconductor Manufacturing Co Ltd'], aggs)?.cusip).toBe('874039100');
    expect(matchCusip(['Nebius Group N.V. Class A Ordinary Shares'], aggs)?.cusip).toBe('N97284108');
  });
  it('matches truncated 13F names by prefix, never a shorter different issuer', () => {
    expect(matchCusip(['Coca-Cola Europacific Partners plc'], aggs)).toEqual({ cusip: 'G25839104', how: 'name-prefix' });
    expect(matchCusip(['Coca-Cola Co'], aggs)?.cusip).toBe('191216100');
    expect(matchCusip(['Totally Unknown Corp'], aggs)).toBeNull();
  });
  it('aliases an issuer\'s old CUSIP but never across share classes or funds', () => {
    const a = [
      { cusip: 'NEW', norm: 'EXXON MOBIL', cls: 'COM', name: 'EXXON MOBIL CORP', value: 1 },
      { cusip: 'OLD', norm: 'EXXON MOBIL', cls: 'COM', name: 'EXXON MOBIL CORP', value: 100 },
      { cusip: 'PFD', norm: 'EXXON MOBIL', cls: 'PFD SER A', name: 'EXXON MOBIL CORP', value: 1 },
      { cusip: 'GA', norm: 'ALPHABET', cls: 'CAP STK CL A', name: 'ALPHABET INC', value: 1 },
      { cusip: 'GC', norm: 'ALPHABET', cls: 'CAP STK CL C', name: 'ALPHABET INC', value: 1 },
      { cusip: 'IVV', norm: 'ISHARES TR', cls: 'CORE S&P500 ETF', name: 'ISHARES TR', value: 1 },
      { cusip: 'IJH', norm: 'ISHARES TR', cls: 'CORE S&P MCP ETF', name: 'ISHARES TR', value: 1 },
    ];
    expect(aliasCusips('NEW', a, new Set(['NEW']), new Set())).toEqual(['OLD']);
    expect(aliasCusips('GA', a, new Set(['GA', 'GC']), new Set(['ALPHABET']))).toEqual([]);
    expect(aliasCusips('IVV', a, new Set(['IVV']), new Set())).toEqual([]);
  });
  it('normalises tickers and holder names', () => {
    expect(normTicker('brk-b')).toBe('BRK.B');
    expect(normTicker('BRK/B')).toBe('BRK.B');
    expect(prettyHolder('VANGUARD GROUP INC')).toBe('Vanguard Group Inc');
    expect(prettyHolder('FMR LLC')).toBe('FMR LLC');
    expect(prettyHolder('BlackRock, Inc.')).toBe('BlackRock, Inc.');
  });
});

describe('QoQ change and ranking', () => {
  it('computes share change vs prior quarter; new positions are +100%', () => {
    expect(qoqChange(110, 100)).toEqual({ changeShares: 10, changePct: 10 });
    expect(qoqChange(50, 100)).toEqual({ changeShares: -50, changePct: -50 });
    expect(qoqChange(500, undefined)).toEqual({ changeShares: 500, changePct: 100 });
    expect(qoqChange(1, 3)).toEqual({ changeShares: -2, changePct: -66.67 });
  });
  it('ranks by value, merges alias CUSIPs and uses the right % basis', () => {
    const cur = mergeHoldings([
      new Map([['1', { shares: 100, value: 1000 }], ['2', { shares: 300, value: 3000 }]]),
      new Map([['1', { shares: 50, value: 500 }]]),
    ]);
    const prior = new Map([['2', { shares: 200, value: 1900 }]]);
    const names = new Map([['1', 'ALPHA CAPITAL LLC'], ['2', 'BETA ADVISORS INC']]);
    const r = rankHolders({ cur, prior, names, period: '2026-06-30', sharesOutstanding: 1000 });
    expect(r.basis).toBe('outstanding');
    expect(r.holders.map((h: { holder: string }) => h.holder)).toEqual(['Beta Advisors Inc', 'Alpha Capital LLC']);
    expect(r.holders[0]).toMatchObject({ shares: 300, value: 3000, pctOfShares: 30, changeShares: 100, changePct: 50, reportDate: '2026-06-30' });
    expect(r.holders[1]).toMatchObject({ shares: 150, pctOfShares: 15, changeShares: 150, changePct: 100 });
    const r13 = rankHolders({ cur, prior, names, period: '2026-06-30', sharesOutstanding: null });
    expect(r13.basis).toBe('13f');
    expect(r13.holders[0].pctOfShares).toBeCloseTo(66.6667, 3);
  });
});

describe('sec13f provider', () => {
  const snap: Snapshot = {
    period: '2026-06-30', quarter: '2026Q2', priorPeriod: '2026-03-31', generatedAt: '2026-11-18T00:00:00Z',
    datasets: [{ name: 'x_form13f.zip', url: 'https://www.sec.gov/files/x_form13f.zip' }],
    tickers: {
      'BRK.B': { cusip: '084670702', issuer: 'BERKSHIRE HATHAWAY INC DEL', basis: '13f', holderCount: 3000, total13fShares: 1e9, h: [['Vanguard Group Inc', '102909', 100, 50000, 10, 5, 5.26]] },
    },
  };
  it('maps compact rows to InstitutionalHolding with SEC source meta', () => {
    const r = holdingsFromSnapshot(snap, 'brk-b');
    expect(r.data).toEqual([{ holder: 'Vanguard Group Inc', shares: 100, value: 50000, pctOfShares: 10, changeShares: 5, changePct: 5.26, reportDate: '2026-06-30' }]);
    expect(r.meta.isMock).toBe(false);
    expect(r.meta.provider).toBe('SEC Form 13F');
    expect(r.meta.source[0]).toMatchObject({ kind: 'ownership', url: 'https://www.sec.gov/files/x_form13f.zip' });
    expect(r.meta.source[0].excerpt).toContain('13F-reported shares');
  });
  it('returns an empty list for unknown tickers (composite falls through)', () => {
    expect(holdingsFromSnapshot(snap, 'ZZZZ').data).toEqual([]);
  });
  it('serves real holders from the bundled snapshot', async () => {
    const r = await sec13fProvider.getInstitutional!('AAPL');
    expect(r.data.length).toBeGreaterThan(0);
    expect(r.data[0].value).toBeGreaterThan(1e9);
    expect(r.meta.isMock).toBe(false);
  });
});
