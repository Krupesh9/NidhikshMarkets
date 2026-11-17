'use client';
import {useMemo, useState} from 'react';
import {ExternalLink} from 'lucide-react';
import {asOf, dateLabel, money, number} from '@/lib/api';
import {pct, tone} from './ta';

type Fact = {start?: string; end: string; val: number; filed: string; form?: string; accn?: string; fp?: string; fy?: number};
type Period = {end: string; start?: string; label: string; revenue?: number; income?: number; filed?: string; accn?: string};

const REVENUE = ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax'];
const days = (a?: string, b?: string) => (a && b ? (Date.parse(b) - Date.parse(a)) / 86400000 : 0);
const usd = (v?: number | null) => (v == null || !Number.isFinite(v) ? '—' : `${v < 0 ? '−' : ''}$${number(Math.abs(v))}`);

/** Keep one value per period end, choosing quarterly (≈3 mo) or annual (≈12 mo) spans; latest filing wins. */
function series(rows: Fact[], kind: 'quarter' | 'annual') {
  const out = new Map<string, Fact>();
  for (const r of rows) {
    const span = days(r.start, r.end);
    const ok = kind === 'quarter' ? span >= 80 && span <= 100 : span >= 350 && span <= 380;
    if (!ok || typeof r.val !== 'number') continue;
    const prev = out.get(r.end);
    if (!prev || r.filed > prev.filed) out.set(r.end, r);
  }
  return out;
}

function periodLabel(end: string, kind: 'quarter' | 'annual') {
  const d = new Date(end + 'T00:00:00Z');
  return kind === 'annual' ? `FY${String(d.getUTCFullYear()).slice(2)}` : `${d.toLocaleString('en-US', {month: 'short', timeZone: 'UTC'})} ’${String(d.getUTCFullYear()).slice(2)}`;
}

export default function Financials({data, symbol}: {data: any; symbol: string}) {
  const [kind, setKind] = useState<'quarter' | 'annual'>('quarter');
  const history: Record<string, Fact[]> = data?.data?.financial_history || {};
  const facts: Record<string, Fact & {unit?: string}> = data?.data?.facts || {};
  const metrics = data?.metrics || {};
  const cik = data?.data?.cik;

  const periods = useMemo(() => {
    const rev = new Map<string, Fact>();
    for (const tag of REVENUE) for (const [end, f] of series(history[tag] || [], kind)) if (!rev.has(end) || f.filed > rev.get(end)!.filed) rev.set(end, f);
    const inc = series(history.NetIncomeLoss || [], kind);
    const ends = [...new Set([...rev.keys(), ...inc.keys()])].sort();
    const latest = ends.at(-1);
    const recent = kind === 'quarter' && latest ? ends.filter(e => days(e, latest) <= 3 * 366) : ends;
    return recent.slice(kind === 'quarter' ? -12 : -6).map<Period>(end => ({
      end, start: rev.get(end)?.start || inc.get(end)?.start, label: periodLabel(end, kind),
      revenue: rev.get(end)?.val, income: inc.get(end)?.val, filed: rev.get(end)?.filed || inc.get(end)?.filed, accn: rev.get(end)?.accn || inc.get(end)?.accn,
    }));
  }, [history, kind]);

  const balance = useMemo(() => {
    const pick = (tag: string) => [...(history[tag] || [])].filter(f => typeof f.val === 'number').sort((a, b) => b.end.localeCompare(a.end) || b.filed.localeCompare(a.filed));
    const assets = pick('Assets'), liabilities = pick('Liabilities');
    const latestA = assets[0], latestL = liabilities.find(l => l.end === latestA?.end) || liabilities[0];
    const trend = [...new Map(assets.map(a => [a.end, a])).values()].sort((a, b) => a.end.localeCompare(b.end)).slice(-8)
      .map(a => ({end: a.end, assets: a.val, liabilities: liabilities.find(l => l.end === a.end)?.val}));
    return {assets: latestA?.val ?? facts.Assets?.val, liabilities: latestL?.val ?? facts.Liabilities?.val, end: latestA?.end ?? facts.Assets?.end, trend};
  }, [history, facts]);

  if (!data?.data) return <div className="v2-fin-empty">
    <p>No SEC-reported financials are cached for {symbol}.</p>
    <small>Funds and ETFs don't file company financials. For companies, an admin can refresh company reports from the classic view's Settings.</small>
  </div>;

  const last = periods.at(-1);
  const yearAgo = last && periods.find(p => kind === 'quarter' ? Math.abs(days(p.end, last.end) - 364) < 20 : Math.abs(days(p.end, last.end) - 365) < 20);
  const prior = periods.at(-2);
  const growth = last?.revenue && (kind === 'quarter' ? yearAgo?.revenue : prior?.revenue) ? (last.revenue / (kind === 'quarter' ? yearAgo!.revenue! : prior!.revenue!) - 1) * 100 : null;
  const margin = last?.revenue && last.income != null ? (last.income / last.revenue) * 100 : null;
  const equity = balance.assets != null && balance.liabilities != null ? balance.assets - balance.liabilities : null;
  const debtRatio = balance.assets && balance.liabilities != null ? (balance.liabilities / balance.assets) * 100 : null;
  const marketCap = metrics.market_cap_reported?.value ?? metrics.market_cap_estimate?.value ?? null;
  const eps = facts.EarningsPerShareDiluted;
  const max = Math.max(1, ...periods.flatMap(p => [Math.abs(p.revenue || 0), Math.abs(p.income || 0)]));

  const kpis: {label: string; value: string; sub: string; t?: string}[] = [
    {label: 'Market cap', value: marketCap == null ? '—' : usd(marketCap), sub: metrics.market_cap_reported ? 'Provider reported' : metrics.market_cap_estimate ? `Est. · shares as of ${dateLabel(metrics.market_cap_estimate.share_date)}` : 'Needs reported shares'},
    {label: 'P/E (TTM)', value: metrics.pe_ttm ? `${metrics.pe_ttm.value.toFixed(1)}×` : '—', sub: metrics.pe_ttm ? 'Price ÷ trailing EPS' : 'Four reported quarters unavailable'},
    {label: `Revenue · ${last?.label || 'latest'}`, value: usd(last?.revenue), sub: growth == null ? 'Growth unavailable' : `${pct(growth, 1)} ${kind === 'quarter' ? 'year over year' : 'vs prior year'}`, t: tone(growth)},
    {label: 'Net margin', value: margin == null ? '—' : `${margin.toFixed(1)}%`, sub: last?.income == null ? '—' : `Net income ${usd(last.income)}`, t: tone(margin)},
    {label: 'Diluted EPS', value: eps ? money(eps.val) : '—', sub: eps ? `${eps.fp || ''} ${eps.fy || ''} · ${days(eps.start, eps.end) > 120 ? 'year to date' : 'quarter'}`.trim() : 'Not reported'},
    {label: 'Liabilities / assets', value: debtRatio == null ? '—' : `${debtRatio.toFixed(0)}%`, sub: equity == null ? '—' : `Equity ${usd(equity)}`},
  ];

  return <div className="v2-fin">
    <div className="v2-fin-kpis">{kpis.map(k => <div key={k.label}><small>{k.label}</small><b>{k.value}</b><span className={k.t || ''}>{k.sub}</span></div>)}</div>

    <div className="v2-fin-grid">
      <section className="v2-fin-card">
        <header>
          <div><h3>Revenue &amp; net income</h3><small>SEC-reported · USD</small></div>
          <div className="v2-seg" role="tablist">{(['quarter', 'annual'] as const).map(k => <button key={k} role="tab" aria-selected={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{k === 'quarter' ? 'Quarterly' : 'Annual'}</button>)}</div>
        </header>
        {periods.length ? <>
          <div className="v2-bars" role="img" aria-label={`Revenue and net income, ${kind === 'quarter' ? 'quarterly' : 'annual'}`}>
            {periods.map(p => {
              const m = p.revenue && p.income != null ? (p.income / p.revenue) * 100 : null;
              return <div key={p.end} className="v2-bar-col" title={`${p.label}: revenue ${usd(p.revenue)}, net income ${usd(p.income)}`}>
                <div className="v2-bar-stack">
                  <i className="rev" style={{height: `${(Math.abs(p.revenue || 0) / max) * 100}%`}}><em>{usd(p.revenue)}</em></i>
                  <i className={`inc ${(p.income || 0) < 0 ? 'neg' : ''}`} style={{height: `${(Math.abs(p.income || 0) / max) * 100}%`}} />
                </div>
                <span className="lbl">{p.label}</span>
                <span className={`mgn ${tone(m)}`}>{m == null ? '—' : `${m.toFixed(0)}%`}</span>
              </div>;
            })}
          </div>
          <div className="v2-legend"><span><i className="rev" />Revenue</span><span><i className="inc" />Net income</span><span className="muted">% = net margin</span></div>
        </> : <p className="v2-note">No {kind === 'quarter' ? 'quarterly' : 'annual'} periods in the cached filings. Try {kind === 'quarter' ? 'Annual' : 'Quarterly'}.</p>}
      </section>

      <section className="v2-fin-card">
        <header><div><h3>Balance sheet</h3><small>{balance.end ? `As of ${dateLabel(balance.end)}` : 'Latest filing'}</small></div></header>
        {balance.assets ? <>
          <div className="v2-bs">
            <div className="v2-bs-bar" role="img" aria-label={`Liabilities ${usd(balance.liabilities)}, equity ${usd(equity)}`}>
              <i className="liab" style={{width: `${debtRatio ?? 0}%`}} /><i className="eq" style={{width: `${100 - (debtRatio ?? 0)}%`}} />
            </div>
            <dl>
              <div><dt>Total assets</dt><dd>{usd(balance.assets)}</dd></div>
              <div><dt><i className="liab" />Liabilities</dt><dd>{usd(balance.liabilities)}</dd></div>
              <div><dt><i className="eq" />Equity (assets − liabilities)</dt><dd>{usd(equity)}</dd></div>
            </dl>
          </div>
          {balance.trend.length > 1 && <div className="v2-bs-trend">
            <small>Total assets by filing</small>
            <div>{balance.trend.map(t => <span key={t.end} title={`${dateLabel(t.end)}: ${usd(t.assets)}`} style={{height: `${(t.assets / Math.max(...balance.trend.map(x => x.assets))) * 100}%`}} />)}</div>
          </div>}
        </> : <p className="v2-note">No balance-sheet facts cached.</p>}
      </section>
    </div>

    <details className="v2-details">
      <summary>Reported periods &amp; source filings</summary>
      <div className="v2-scroll" style={{maxHeight: 320}}>
        <table className="v2-table compact sticky">
          <thead><tr><th>Period</th><th className="r">Revenue</th><th className="r">Net income</th><th className="r">Margin</th><th>Filed</th><th>Source</th></tr></thead>
          <tbody>{[...periods].reverse().map(p => <tr key={p.end}>
            <td>{p.start ? `${dateLabel(p.start)} – ` : ''}{dateLabel(p.end)}</td>
            <td className="r">{usd(p.revenue)}</td><td className={`r ${tone(p.income)}`}>{usd(p.income)}</td>
            <td className="r">{p.revenue && p.income != null ? `${((p.income / p.revenue) * 100).toFixed(1)}%` : '—'}</td>
            <td>{dateLabel(p.filed)}</td>
            <td>{p.accn && cik ? <a href={`https://www.sec.gov/Archives/edgar/data/${cik}/${p.accn.replaceAll('-', '')}/`} target="_blank" rel="noreferrer">SEC <ExternalLink size={11} /></a> : '—'}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </details>
    <p className="v2-fine">{data.data.note} Retrieved {asOf(data.as_of)}. Quarterly values are 3-month periods only; year-to-date filings are excluded. Not adjusted for restatements unless re-filed.</p>
  </div>;
}
