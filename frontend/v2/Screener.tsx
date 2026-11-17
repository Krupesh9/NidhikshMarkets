'use client';
import {useEffect, useMemo, useState} from 'react';
import {ArrowDown, ArrowUp, ChevronDown} from 'lucide-react';
import {api, money} from '@/lib/api';
import {Change, Spark} from './Terminal';
import {pct, tone} from './ta';

type Key = 'symbol' | 'name' | 'sector' | 'weight' | 'price' | 'change_percent' | 'month';
const UNIVERSES = [['sp500', 'S&P 500 (IVV)'], ['nasdaq100', 'Nasdaq 100 (QQQ)'], ['russell2000', 'Russell 2000 (IWM)']] as const;
const MOVES = [['all', 'Any change'], ['up', 'Up today'], ['down', 'Down today'], ['up2', 'Up > 2%'], ['down2', 'Down > 2%']] as const;
const PAGE = 50;

export default function Screener({mode, watchlists, onChoose}: {mode: string; watchlists: any[]; onChoose: (s: string) => void}) {
  const [tab, setTab] = useState<'overview' | 'technical'>('overview');
  return <section className="v2-panel v2-screener">
    <header>
      <h2>Screener</h2>
      <div className="v2-seg" role="tablist">
        <button role="tab" aria-selected={tab === 'overview'} className={tab === 'overview' ? 'on' : ''} onClick={() => setTab('overview')}>Index constituents</button>
        <button role="tab" aria-selected={tab === 'technical'} className={tab === 'technical' ? 'on' : ''} onClick={() => setTab('technical')}>Technicals (researched)</button>
      </div>
    </header>
    {tab === 'overview' ? <Constituents mode={mode} watchlists={watchlists} onChoose={onChoose} /> : <Technicals mode={mode} onChoose={onChoose} />}
  </section>;
}

function Constituents({mode, watchlists, onChoose}: {mode: string; watchlists: any[]; onChoose: (s: string) => void}) {
  const [universe, setUniverse] = useState('sp500');
  const [data, setData] = useState<any>(null);
  const [sector, setSector] = useState('all');
  const [move, setMove] = useState('all');
  const [text, setText] = useState('');
  const [minPx, setMinPx] = useState(''), [maxPx, setMaxPx] = useState('');
  const [sort, setSort] = useState<{key: Key; dir: 1 | -1}>({key: 'weight', dir: -1});
  const [page, setPage] = useState(0);

  useEffect(() => {
    let alive = true; setData(null);
    const [u, id] = universe.split(':');
    api(`/heatmap?universe=${u}${id ? `&watchlist_id=${id}` : ''}&mode=${mode}`).then(r => alive && setData(r)).catch(e => alive && setData({items: [], note: (e as Error).message}));
    return () => { alive = false; };
  }, [universe, mode]);
  useEffect(() => setPage(0), [universe, sector, move, text, minPx, maxPx, sort]);

  const rows = useMemo(() => (data?.items || []).map((r: any) => {
    const h = (r.history || []).map((x: any) => x.value);
    return {...r, spark: h, month: h.length > 1 ? (h.at(-1) / h[0] - 1) * 100 : null};
  }), [data]);
  const sectors = useMemo(() => [...new Set(rows.map((r: any) => r.sector).filter(Boolean))].sort() as string[], [rows]);

  const filtered = useMemo(() => {
    const q = text.trim().toLowerCase();
    const lo = parseFloat(minPx), hi = parseFloat(maxPx);
    const out = rows.filter((r: any) => {
      if (sector !== 'all' && r.sector !== sector) return false;
      if (q && !`${r.symbol} ${r.name}`.toLowerCase().includes(q)) return false;
      const c = r.change_percent;
      if (move !== 'all' && typeof c !== 'number') return false;
      if (move === 'up' && !(c > 0)) return false;
      if (move === 'down' && !(c < 0)) return false;
      if (move === 'up2' && !(c > 2)) return false;
      if (move === 'down2' && !(c < -2)) return false;
      if (Number.isFinite(lo) && !(r.price >= lo)) return false;
      if (Number.isFinite(hi) && !(r.price <= hi)) return false;
      return true;
    });
    out.sort((a: any, b: any) => {
      const x = a[sort.key], y = b[sort.key];
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return (typeof x === 'string' ? x.localeCompare(y) : x - y) * sort.dir;
    });
    return out;
  }, [rows, sector, move, text, minPx, maxPx, sort]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const view = filtered.slice(page * PAGE, page * PAGE + PAGE);
  const th = (key: Key, label: string, right = false) => <th className={right ? 'r' : ''} aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
    <button onClick={() => setSort(s => ({key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : (typeof rows[0]?.[key] === 'string' ? 1 : -1)}))}>
      {label}{sort.key === key && (sort.dir === 1 ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
    </button></th>;

  return <>
    <div className="v2-filters">
      <Select label="Universe" value={universe} onChange={setUniverse} options={[...UNIVERSES, ...watchlists.map(w => [`watchlist:${w.id}`, `Watchlist · ${w.name}`] as const)]} />
      <Select label="Sector" value={sector} onChange={setSector} options={[['all', 'All sectors'], ...sectors.map(s => [s, s] as const)]} />
      <Select label="Change" value={move} onChange={setMove} options={MOVES} />
      <label className="v2-field"><span>Price min</span><input inputMode="decimal" value={minPx} onChange={e => setMinPx(e.target.value)} placeholder="0" /></label>
      <label className="v2-field"><span>Price max</span><input inputMode="decimal" value={maxPx} onChange={e => setMaxPx(e.target.value)} placeholder="Any" /></label>
      <label className="v2-field grow"><span>Find</span><input value={text} onChange={e => setText(e.target.value)} placeholder="Ticker or company" /></label>
    </div>
    <p className="v2-fine">{filtered.length} of {rows.length} holdings · {data?.note || 'Loading…'}</p>
    <div className="v2-scroll">
      <table className="v2-table sticky">
        <thead><tr>{th('symbol', 'Ticker')}{th('name', 'Company')}{th('sector', 'Sector')}{th('weight', 'Weight', true)}{th('price', 'Price', true)}{th('change_percent', 'Change', true)}{th('month', 'Recent', true)}<th className="r">Trend</th></tr></thead>
        <tbody>
          {!data && <tr><td colSpan={8}><div className="v2-skeleton" style={{height: 200}} /></td></tr>}
          {view.map((r: any) => <tr key={r.symbol} tabIndex={0} onClick={() => onChoose(r.symbol)} onKeyDown={e => e.key === 'Enter' && onChoose(r.symbol)}>
            <td><b className="v2-ticker">{r.symbol}</b></td><td className="ellipsis">{r.name}</td><td className="muted ellipsis">{r.sector}</td>
            <td className="r mono">{typeof r.weight === 'number' && r.weight > 0 ? `${r.weight.toFixed(2)}%` : '—'}</td>
            <td className="r mono">{money(r.price)}</td>
            <td className="r"><span className={`v2-cell ${tone(r.change_percent)}`}>{pct(r.change_percent)}</span></td>
            <td className={`r mono ${tone(r.month)}`}>{pct(r.month, 1)}</td>
            <td className="r"><Spark values={r.spark} width={84} height={22} /></td>
          </tr>)}
          {data && !view.length && <tr><td colSpan={8} className="v2-note">No holdings match these filters.</td></tr>}
        </tbody>
      </table>
    </div>
    {pages > 1 && <nav className="v2-pager" aria-label="Pages">
      <button className="v2-btn ghost" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Previous</button>
      <span>Page {page + 1} of {pages}</span>
      <button className="v2-btn ghost" disabled={page >= pages - 1} onClick={() => setPage(p => p + 1)}>Next</button>
    </nav>}
  </>;
}

function Technicals({mode, onChoose}: {mode: string; onChoose: (s: string) => void}) {
  const [filter, setFilter] = useState('all');
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    let alive = true; setData(null);
    api(`/scanner?mode=${mode}&filter=${filter}`).then(r => alive && setData(r)).catch(e => alive && setData({items: [], note: (e as Error).message}));
    return () => { alive = false; };
  }, [mode, filter]);
  const chips = [['all', 'All'], ['above_sma200', 'Above 200-day SMA'], ['rsi_low', 'RSI < 30'], ['recent_entry', 'Recent research entry']];
  return <>
    <div className="v2-filters"><div className="v2-seg">{chips.map(([v, l]) => <button key={v} className={filter === v ? 'on' : ''} onClick={() => setFilter(v)}>{l}</button>)}</div></div>
    <p className="v2-fine">{data?.note}</p>
    <div className="v2-scroll">
      <table className="v2-table sticky">
        <thead><tr><th>Ticker</th><th>Company</th><th className="r">Close</th><th className="r">vs SMA 200</th><th>RSI (14)</th><th className="r">Rel. volume</th><th>Last research marker</th></tr></thead>
        <tbody>
          {!data && <tr><td colSpan={7}><div className="v2-skeleton" style={{height: 200}} /></td></tr>}
          {(data?.items || []).map((r: any) => {
            const dist = r.close != null && r.sma200 ? (r.close / r.sma200 - 1) * 100 : null;
            return <tr key={r.symbol} tabIndex={0} onClick={() => onChoose(r.symbol)} onKeyDown={e => e.key === 'Enter' && onChoose(r.symbol)}>
              <td><b className="v2-ticker">{r.symbol}</b></td><td className="ellipsis">{r.name}</td>
              <td className="r mono">{money(r.close)}</td>
              <td className={`r mono ${tone(dist)}`}>{pct(dist, 1)}</td>
              <td><RsiBar value={r.rsi} /></td>
              <td className="r mono">{r.relative_volume == null ? '—' : `${r.relative_volume.toFixed(2)}×`}</td>
              <td>{r.candidate ? <span className={`v2-pill ${r.candidate.kind === 'entry' ? 'up' : 'down'}`}>{r.candidate.kind === 'entry' ? '▲ Buy' : '▼ Sell'} · {r.candidate.strategy.replace('_', ' ')} · {r.candidate.time.slice(0, 10)}</span> : <span className="muted">—</span>}</td>
            </tr>;
          })}
        </tbody>
      </table>
    </div>
  </>;
}

function RsiBar({value}: {value: number | null}) {
  if (value == null) return <span className="muted">—</span>;
  const t = value < 30 ? 'up' : value > 70 ? 'down' : 'flat';
  return <span className="v2-rsi" aria-label={`RSI ${value.toFixed(1)}`}><i><em className={t} style={{left: `${Math.min(100, Math.max(0, value))}%`}} /></i><b className="mono">{value.toFixed(1)}</b></span>;
}

function Select({label, value, onChange, options}: {label: string; value: string; onChange: (v: string) => void; options: readonly (readonly [string, string])[]}) {
  return <label className="v2-field"><span>{label}</span><span className="v2-select"><select value={value} onChange={e => onChange(e.target.value)}>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select><ChevronDown size={13} aria-hidden /></span></label>;
}
