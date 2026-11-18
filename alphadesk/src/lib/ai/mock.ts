// Mock provider: realistic multi-step research behaviour with no API key.
// Parses intent → calls the real tools (via the agent loop) → composes a concise cited answer from the
// actual tool results → streams it word by word. Stateless: everything is derived from `messages`.
import { buildBql, buildScreenBql } from './bql';
import { mult, pct, usdB } from './format';
import { METRIC_LABEL, parseIntent, type Intent, type Metric, type UniverseLike } from './intent';
import type { ChatOptions, LLMProvider } from './provider';
import type { LLMMessage, ProviderEvent, ToolCall, ToolSpec } from './types';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const cite = (...ns: unknown[]) => {
  const ok = ns.filter((n): n is number => typeof n === 'number');
  return ok.length ? ` [${[...new Set(ok)].join(', ')}]` : '';
};
const short = (name: string) => name.replace(/,? Incorporated|,? Inc\.?| Corporation| Company| plc/g, '').trim();
const quote = (s: string, max = 150) => {
  const t = s.replace(/^(CEO|CFO|Analyst Q&A):\s*/, '').trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
};
const signed = (n: number | null | undefined) => (n == null ? 'n/a' : `${n > 0 ? '+' : ''}${n.toFixed(1)} pts`);

export interface MockState {
  question: string;
  round: number;
  results: Record<string, Json[]>;
}

/** Derive the current turn's state from the conversation. */
export function mockState(messages: LLMMessage[]): MockState {
  let lastUser = -1;
  messages.forEach((m, i) => { if (m.role === 'user') lastUser = i; });
  const question = lastUser >= 0 ? (messages[lastUser] as { content: string }).content : '';
  const after = messages.slice(lastUser + 1);
  const results: Record<string, Json[]> = {};
  for (const m of after) {
    if (m.role !== 'tool') continue;
    for (const r of m.results) {
      try { (results[r.name] ??= []).push(JSON.parse(r.content)); } catch { /* ignore */ }
    }
  }
  return { question, round: after.filter((m) => m.role === 'assistant').length, results };
}

/** Decide which tools to call next for this intent (empty = time to answer). */
export function planCalls(intent: Intent, st: MockState): { name: string; input: Json }[] {
  const r = st.results;
  const docQuery = intent.theme?.query ?? (intent.wantsDocs ? `${st.question} guidance outlook demand risk` : 'guidance outlook demand margin');
  switch (intent.kind) {
    case 'compare': {
      const tickers = intent.tickers.slice(0, 6);
      const metrics = intent.metrics.length ? intent.metrics : (['revenue_growth', 'gross_margin', 'operating_margin'] as Metric[]);
      if (st.round === 0) return [{ name: 'compare_companies', input: { tickers, metrics, years: Math.min(intent.years, 10) } }];
      if (st.round === 1 && (intent.theme || intent.wantsDocs) && !r.search_documents) return [{ name: 'search_documents', input: { query: docQuery, tickers, limit: Math.min(12, tickers.length * 3) } }];
      return [];
    }
    case 'company': {
      const t = intent.tickers[0];
      if (st.round === 0) return [{ name: 'get_company_snapshot', input: { ticker: t } }, { name: 'get_financials', input: { ticker: t, period: 'annual', years: Math.min(intent.years, 10) } }];
      if (st.round === 1) return [{ name: 'search_documents', input: { query: docQuery, tickers: [t], limit: 4 } }, { name: 'get_news', input: { ticker: t, limit: 4 } }];
      return [];
    }
    case 'screen':
      return st.round === 0 ? [{ name: 'run_screen', input: { ...stripUndef(intent.screen ?? {}), limit: 10 } }] : [];
    case 'theme': {
      if (st.round === 0) {
        const sector = intent.sector ?? (intent.theme?.id === 'ai' || intent.theme?.id === 'datacenter' || intent.theme?.id === 'cloud' ? 'Information Technology' : undefined);
        return [{ name: 'run_screen', input: stripUndef({ sector, sortBy: 'revenueGrowth', limit: 8 }) }];
      }
      if (st.round === 1) {
        const tickers = ((r.run_screen?.[0]?.rows ?? []) as Json[]).slice(0, 6).map((x) => x.ticker as string);
        return [{ name: 'search_documents', input: stripUndef({ query: docQuery, tickers: tickers.length ? tickers : undefined, limit: 10 }) }];
      }
      return [];
    }
    case 'news':
      return st.round === 0 ? [{ name: 'get_news', input: stripUndef({ ticker: intent.tickers[0], limit: 8 }) }] : [];
    case 'portfolio':
      return st.round === 0 ? [{ name: 'portfolio_risk', input: {} }] : [];
    default:
      return st.round === 0 ? [{ name: 'get_news', input: { limit: 5 } }] : [];
  }
}

function stripUndef<T extends Json>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

// ---------------- answer composition ----------------

function passagesByTicker(docs: Json | undefined): Map<string, Json[]> {
  const m = new Map<string, Json[]>();
  for (const p of (docs?.passages ?? []) as Json[]) {
    const k = (p.ticker as string) ?? 'Market';
    m.set(k, [...(m.get(k) ?? []), p]);
  }
  return m;
}

function dataNote(isMockHint: boolean) {
  return isMockHint ? '\n\n_Figures come from the demo data set (simulated where marked). Research only — not investment advice._' : '\n\n_Research only — not investment advice._';
}

function composeCompare(intent: Intent, st: MockState): string {
  const cmp = st.results.compare_companies?.[0];
  if (!cmp || cmp.error || !cmp.companies?.length) return `I couldn't build that comparison${cmp?.error ? `: ${cmp.error}` : ''}. Check the tickers and try again.`;
  const cos = cmp.companies as Json[];
  const docs = st.results.search_documents?.[0];
  const byT = passagesByTicker(docs);
  const metrics = cmp.metrics as Metric[];
  const span = `FY${cos[0].firstFy}–FY${cos[0].latestFy}`;
  const names = cos.map((c) => short(c.name));
  const lines: string[] = [];
  const topic = [metrics.includes('revenue_growth') && 'revenue growth', (metrics.includes('gross_margin') || metrics.includes('operating_margin')) && 'margins', intent.theme && intent.theme.label]
    .filter(Boolean).join(', ') || metrics.map((m) => METRIC_LABEL[m]).join(', ');
  lines.push(`### ${names.join(' vs ')}: ${topic} (${span})`);

  const by = (k: string) => [...cos].filter((c) => typeof c[k] === 'number').sort((a, b) => b[k] - a[k]);
  const growthLead = by('revenueCagr')[0];
  const omLead = by('operatingMarginLatest')[0];
  const cov = (docs?.coverage ?? {}) as Record<string, number>;
  const aiCounts = cos.map((c) => ({ t: c.ticker as string, n: cov[c.ticker] ?? (byT.get(c.ticker) ?? []).length })).sort((a, b) => b.n - a.n);
  const aiLead = aiCounts.length > 1 && aiCounts[0].n > aiCounts[1].n ? aiCounts[0] : undefined;
  const bl: string[] = [];
  if (growthLead && cos.length > 1) bl.push(`**${growthLead.ticker}** compounded revenue fastest (${pct(growthLead.revenueCagr)} CAGR)`);
  if (omLead && cos.length > 1) bl.push(`**${omLead.ticker}** runs the highest operating margin (${pct(omLead.operatingMarginLatest)})`);
  if (intent.theme && aiLead?.n) bl.push(`**${aiLead.t}** shows more ${intent.theme.label} evidence in recent documents (${aiLead.n} vs ${aiCounts[1].n} relevant passages)`);
  if (bl.length) lines.push(`**Bottom line:** ${bl.join('; ')}.`);

  if (metrics.includes('revenue_growth') || metrics.includes('revenue')) {
    lines.push('\n**Revenue growth**');
    for (const c of cos) {
      lines.push(`- **${c.ticker}** — revenue ${c.revenueLatest} in FY${c.latestFy}; ${pct(c.revenueCagr)} CAGR over ${span} and ${pct(c.revenueGrowthLatest, 1, true)} in the latest year (period average ${pct(c.avgGrowth)}).${cite(c.finCite)}`);
    }
  }
  if (metrics.some((m) => m === 'gross_margin' || m === 'operating_margin' || m === 'net_margin' || m === 'fcf_margin')) {
    lines.push('\n**Margins**');
    for (const c of cos) {
      const parts: string[] = [];
      if (metrics.includes('gross_margin')) parts.push(`gross ${pct(c.grossMarginLatest)} (${signed(c.grossMarginChangePts)})`);
      if (metrics.includes('operating_margin')) parts.push(`operating ${pct(c.operatingMarginLatest)} (${signed(c.operatingMarginChangePts)})`);
      if (metrics.includes('net_margin')) parts.push(`net ${pct(c.netMarginLatest)}`);
      if (metrics.includes('fcf_margin')) parts.push(`FCF ${pct(c.fcfMarginLatest)}`);
      lines.push(`- **${c.ticker}** — ${parts.join(', ')} in FY${c.latestFy}; changes are vs FY${c.firstFy}.${cite(c.finCite)}`);
    }
  }
  if (metrics.includes('pe') || metrics.includes('ev_ebitda') || metrics.includes('market_cap')) {
    lines.push('\n**Valuation context**');
    for (const c of cos) lines.push(`- **${c.ticker}** — P/E ${mult(c.pe)}, EV/EBITDA ${mult(c.evEbitda)}, market cap ${c.marketCap}.${cite(c.profileCite)}`);
  }
  if (docs) {
    const label = intent.theme ? intent.theme.label : 'Management commentary';
    lines.push(`\n**${label}** _(evidence from filings, call transcripts and news${intent.theme?.id === 'ai' ? ' — a keyword proxy, not a segment revenue disclosure' : ''})_`);
    const seen = new Set<string>();
    for (const c of cos) {
      const norm = (t: string) => t.replace(/^(CEO|CFO|Analyst Q&A):\s*/, '').replace(new RegExp(c.name.split(' ')[0], 'g'), '');
      const all = byT.get(c.ticker) ?? [];
      // prefer passages not already quoted for another company (templated demo text repeats)
      const ps = [...all.filter((p) => !seen.has(norm(p.text))), ...all.filter((p) => seen.has(norm(p.text)))];
      ps.slice(0, 2).forEach((p) => seen.add(norm(p.text)));
      if (!ps.length) { lines.push(`- **${c.ticker}** — no matching passages in the documents searched.`); continue; }
      const best = ps[0];
      const kinds = [...new Set(ps.map((p) => p.kind))].join('/');
      const total = cov[c.ticker] ?? ps.length;
      lines.push(`- **${c.ticker}** — ${total} relevant passage${total > 1 ? 's' : ''} (${kinds}). ${best.kind === 'transcript' ? 'On the call' : best.kind === 'news' ? 'In the news' : `In its ${String(best.title).split('—')[0].replace(c.ticker, '').trim() || 'filing'}`}: “${quote(best.text)}”${cite(best.cite)}${ps[1] ? `; also “${quote(ps[1].text, 90)}”${cite(ps[1].cite)}` : ''}.`);
    }
  }
  lines.push(`\nThe comparison table and charts below are built from the same statement data — click any [n] to see the exact excerpt.`);
  const bql = buildBql(cos.map((c) => c.ticker), metrics, intent.years);
  lines.push('\n```bql\n' + bql.query + '\n```');
  return lines.join('\n') + dataNote(true);
}

function composeCompany(intent: Intent, st: MockState): string {
  const snap = st.results.get_company_snapshot?.[0];
  const fin = st.results.get_financials?.[0];
  const docs = st.results.search_documents?.[0];
  const news = st.results.get_news?.[0];
  if (!snap || snap.error) return `I couldn't find data for ${intent.tickers[0]}. Check the symbol or try the company name.`;
  const L: string[] = [];
  L.push(`### ${snap.name} (${snap.ticker})`);
  const px = snap.price != null ? `$${Number(snap.price).toFixed(2)} (${pct(snap.changePct, 2, true)} today)` : 'n/a';
  L.push(`${short(snap.name)} trades at ${px}${cite(snap.quoteCite)}, a ${snap.marketCap} market cap on ${mult(snap.pe)} trailing / ${mult(snap.forwardPe)} forward P/E and ${mult(snap.evEbitda)} EV/EBITDA.${cite(snap.profileCite)}`);
  const rows = (fin?.rows ?? []) as Json[];
  if (rows.length >= 2) {
    const a = rows[0], b = rows[rows.length - 1];
    const growths = rows.map((r) => r.growth).filter((g) => typeof g === 'number') as number[];
    L.push(`\n**Financial trajectory (FY${a.fy}–FY${b.fy})**`);
    L.push(`- Revenue went from ${a.revenue} to ${b.revenue}; growth averaged ${pct(growths.reduce((x, y) => x + y, 0) / Math.max(1, growths.length))} and was ${pct(b.growth, 1, true)} in FY${b.fy}.${cite(fin.cite)}`);
    L.push(`- Gross margin ${pct(a.grossMargin)} → ${pct(b.grossMargin)}; operating margin ${pct(a.operatingMargin)} → ${pct(b.operatingMargin)}; FCF margin ${pct(b.fcfMargin)} in FY${b.fy}.${cite(fin.cite)}`);
  }
  const e = snap.estimates;
  if (e?.fyEps) {
    L.push(`\n**Street view**`);
    L.push(`- ${e.fyEps.period} EPS consensus $${Number(e.fyEps.consensus).toFixed(2)} from ${e.fyEps.analysts} analysts, revised ${pct(e.fyEps.change30dPct, 1, true)} over 30 days; ratings ${e.rating.buy} buy / ${e.rating.hold} hold / ${e.rating.sell} sell.${cite(e.cite)}`);
  }
  const ps = (docs?.passages ?? []) as Json[];
  if (ps.length) {
    L.push(`\n**What filings and calls say**${intent.theme ? ` (${intent.theme.label})` : ''}`);
    for (const p of ps.slice(0, 3)) L.push(`- ${p.kind === 'transcript' ? 'Earnings call' : p.kind === 'news' ? 'News' : String(p.title).split('—')[0].trim()} (${p.locator ?? ''}): “${quote(p.text)}”${cite(p.cite)}`);
  }
  const items = (news?.items ?? []) as Json[];
  if (items.length) {
    L.push(`\n**Recent headlines**`);
    for (const n of items.slice(0, 3)) L.push(`- ${n.date} · ${n.publisher}: ${n.title}${n.sentiment ? ` (_${n.sentiment}_)` : ''}${cite(n.cite)}`);
  }
  const ms: Metric[] = intent.metrics.length ? intent.metrics : ['revenue', 'gross_margin', 'operating_margin'];
  L.push('\n```bql\n' + buildBql([snap.ticker], ms, intent.years).query + '\n```');
  return L.join('\n') + dataNote(true);
}

function composeScreen(intent: Intent, st: MockState): string {
  const s = st.results.run_screen?.[0];
  if (!s) return 'The screen did not return results.';
  const rows = (s.rows ?? []) as Json[];
  const L: string[] = [`### Screen: ${s.filters}`];
  if (!rows.length) {
    L.push(`No names matched${cite(s.cite)}. Try loosening a filter (e.g. a higher P/E cap or lower growth floor).`);
    return L.join('\n') + dataNote(true);
  }
  L.push(`${s.count} names match${cite(s.cite)}. Leading results:`);
  for (const r of rows.slice(0, 5)) {
    L.push(`- **${r.ticker}** (${short(r.name)}, ${r.sector}) — ${r.marketCap} market cap, P/E ${mult(r.pe)}, revenue growth ${pct(r.revenueGrowth)}, 30-day EPS revisions ${pct(r.epsRevision30d, 1, true)}.${cite(s.cite)}${r.whyNow ? ` _Why now:_ ${r.whyNow}` : ''}`);
  }
  L.push('\nFull results are in the table below; open the Screener to refine and save the screen.');
  L.push('\n```bql\n' + buildScreenBql({ sector: intent.screen?.sector, maxPe: intent.screen?.maxPe, minRevenueGrowth: intent.screen?.minRevenueGrowth, minMarketCapB: intent.screen?.minMarketCapB }).query + '\n```');
  return L.join('\n') + dataNote(true);
}

function composeTheme(intent: Intent, st: MockState): string {
  const s = st.results.run_screen?.[0];
  const docs = st.results.search_documents?.[0];
  const label = intent.theme?.label ?? intent.sector ?? 'Theme';
  const L: string[] = [`### ${label}${intent.sector ? ` in ${intent.sector}` : ''}`];
  const byT = passagesByTicker(docs);
  const rows = ((s?.rows ?? []) as Json[]);
  const ranked = rows.map((r) => ({ r, n: (byT.get(r.ticker) ?? []).length })).sort((a, b) => b.n - a.n || b.r.revenueGrowth - a.r.revenueGrowth);
  if (rows.length) L.push(`I screened ${intent.sector ?? 'the coverage universe'} for the fastest growers${cite(s?.cite)} and searched their recent filings, calls and news for ${label} evidence.`);
  L.push('\n**Where the evidence is strongest**');
  for (const { r, n } of ranked.slice(0, 5)) {
    const p = (byT.get(r.ticker) ?? [])[0];
    L.push(`- **${r.ticker}** — ${n} matching passage${n === 1 ? '' : 's'}; revenue growth ${pct(r.revenueGrowth)}, P/E ${mult(r.pe)}.${cite(s?.cite)}${p ? ` “${quote(p.text, 120)}”${cite(p.cite)}` : ''}`);
  }
  if (!ranked.length) L.push('- No companies matched; try naming a sector or specific tickers.');
  L.push('\n_Passage counts are a keyword proxy for exposure, not disclosed segment revenue._');
  L.push('\n```bql\n' + buildScreenBql({ sector: intent.sector ?? (rows[0]?.sector as string | undefined) }).query + '\n```');
  return L.join('\n') + dataNote(true);
}

function composeNews(intent: Intent, st: MockState): string {
  const n = st.results.get_news?.[0];
  const items = (n?.items ?? []) as Json[];
  const who = intent.tickers[0] ?? 'the market';
  if (!items.length) return `No recent headlines found for ${who}.`;
  const pos = items.filter((i) => i.sentiment === 'positive').length;
  const neg = items.filter((i) => i.sentiment === 'negative').length;
  const L = [`### Latest on ${who}`, `${items.length} recent headlines — ${pos} positive, ${neg} negative, ${items.length - pos - neg} neutral by tone.`];
  for (const i of items.slice(0, 6)) L.push(`- ${i.date} · **${i.publisher}**: ${i.title}${cite(i.cite)}`);
  return L.join('\n') + dataNote(true);
}

function composePortfolio(st: MockState): string {
  const p = st.results.portfolio_risk?.[0];
  if (!p) return 'Portfolio risk is not available.';
  if (!p.available) return `**Portfolio risk:** ${p.reason}${p.portfolio ? ` (portfolio: ${p.portfolio})` : ''}` + dataNote(false);
  const usd = (n: number) => `$${Number(n).toLocaleString('en-US')}`;
  const L = [`### Risk snapshot — ${p.portfolio}`];
  L.push(`**Bottom line:** 1-day 95% VaR is ${usd(p.var95_1d)} (${pct(p.var95_1dPct, 2)} of NAV) with portfolio beta ${Number(p.beta).toFixed(2)} vs ${p.benchmark}.${cite(p.cite)}`);
  L.push(`\n- **Exposure:** NAV ${usd(p.nav)}, gross ${pct(p.grossPct)} / net ${pct(p.netPct)}.${cite(p.cite)}`);
  L.push(`- **Volatility:** annualised ${pct(p.annualVolPct)}${p.trackingErrorPct != null ? `, tracking error ${pct(p.trackingErrorPct)}` : ''}${p.cvar95_1d != null ? `; 1-day 95% CVaR ${usd(p.cvar95_1d)}` : ''}.${cite(p.cite)}`);
  L.push(`- **Largest positions:** ${(p.topWeights as Json[]).map((t) => `${t.ticker} ${t.weightPct}%`).join(', ')}.${cite(p.cite)}`);
  L.push(`- **Sector concentration:** ${(p.sectorWeights as Json[]).slice(0, 3).map((s) => `${s.sector} ${s.netWeightPct}%`).join(', ')}; effective sectors ≈ ${p.effectiveSectors} (HHI ${p.sectorHhi}).${cite(p.cite)}`);
  if (p.worstStress) L.push(`- **Worst stress scenario:** ${p.worstStress.name} at ${pct(p.worstStress.pnlPct, 1, true)} of NAV.${cite(p.cite)}`);
  L.push(`\n${p.note}${(p.otherPortfolios as Json[] | undefined)?.length ? ` Other portfolios: ${(p.otherPortfolios as Json[]).map((o) => o.name).join(', ')}.` : ''}`);
  return L.join('\n') + dataNote(true);
}

function composeGeneral(st: MockState): string {
  const n = st.results.get_news?.[0];
  const items = ((n?.items ?? []) as Json[]).slice(0, 4);
  const L = [
    "I'm running in **demo mode** (no AI key configured), so I answer by parsing your question and calling the research tools directly. I can:",
    '- **Compare companies** — e.g. “compare Apple and Microsoft on revenue growth, margins, and AI exposure over the last five years”',
    '- **Profile one company** — e.g. “What is NVIDIA’s margin trend and what did management say about demand?”',
    '- **Run a screen** — e.g. “find cheap Health Care stocks with upward estimate revisions”',
    '- **Explore a theme** — e.g. “Which tech companies have the most AI exposure?”',
  ];
  if (items.length) {
    L.push('\n**Market headlines right now**');
    for (const i of items) L.push(`- ${i.publisher}: ${i.title}${cite(i.cite)}`);
  }
  return L.join('\n') + dataNote(true);
}

export function composeAnswer(intent: Intent, st: MockState): string {
  switch (intent.kind) {
    case 'compare': return composeCompare(intent, st);
    case 'company': return composeCompany(intent, st);
    case 'screen': return composeScreen(intent, st);
    case 'theme': return composeTheme(intent, st);
    case 'news': return composeNews(intent, st);
    case 'portfolio': return composePortfolio(st);
    default: return composeGeneral(st);
  }
}

/** Split text into small streaming chunks (≈ one or two words), keeping fenced code blocks intact per line. */
export function chunkWords(text: string): string[] {
  const out: string[] = [];
  for (const piece of text.split(/(\s+)/)) {
    if (!piece) continue;
    if (/^\s+$/.test(piece) && out.length) out[out.length - 1] += piece;
    else out.push(piece);
  }
  return out;
}

export class MockLLMProvider implements LLMProvider {
  readonly id = 'mock' as const;
  readonly model = 'nidhiksh-mock-analyst-1';
  constructor(private universe: UniverseLike[], readonly label = 'Mock analyst (demo, no API key)', private delayMs = 14) {}

  async *chat(messages: LLMMessage[], _tools: ToolSpec[], opts: ChatOptions): AsyncIterable<ProviderEvent> {
    const st = mockState(messages);
    const intent = parseIntent(st.question, this.universe, opts.context?.ticker);
    const plan = planCalls(intent, st);
    if (plan.length) {
      await sleep(200 + Math.round(Math.random() * 200));
      const calls: ToolCall[] = plan.map((p, i) => ({ id: `mock_${st.round}_${i}`, name: p.name, input: p.input }));
      for (const c of calls) yield { type: 'tool_call', call: c };
      yield { type: 'final', stopReason: 'tool_use', text: '', toolCalls: calls };
      return;
    }
    const text = composeAnswer(intent, st);
    if (opts.stream === false) {
      yield { type: 'text', delta: text };
    } else {
      for (const w of chunkWords(text)) {
        if (opts.signal?.aborted) break;
        yield { type: 'text', delta: w };
        if (this.delayMs) await sleep(this.delayMs);
      }
    }
    yield { type: 'final', stopReason: 'end_turn', text, toolCalls: [] };
  }
}
