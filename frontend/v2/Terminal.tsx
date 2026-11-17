'use client';
import dynamic from 'next/dynamic';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  Activity, BarChart3, CalendarDays, CandlestickChart, ChevronDown, Grid3x3, LayoutDashboard, LineChart,
  LogOut, Moon, Plus, Search, SlidersHorizontal, Sun, TrendingDown, TrendingUp, AreaChart, ExternalLink, Undo2,
} from 'lucide-react';
import {api, asOf, dateLabel, money, number, setCsrf, type Bar, type IndicatorConfig, type Signal} from '@/lib/api';
import QuoteInfo, {latestAvailableQuote, useIntradayPrices} from '@/components/IntradayPrices';
import Heatmap from '@/components/Heatmap';
import EarningsCalendar from '@/components/EarningsCalendar';
import UpcomingIPOs from '@/components/UpcomingIPOs';
import Financials from './Financials';
import IndicatorStudio from '@/components/IndicatorStudio';
import Screener from './Screener';
import Logo, {TrackedSymbols} from './Logo';
import {keyStats, pct, periodReturns, technicalSummary, tone} from './ta';

const MarketChart = dynamic(() => import('@/components/MarketChart'), {ssr: false, loading: () => <div className="v2-skeleton" style={{height: 460}} />});

type View = 'markets' | 'chart' | 'screener' | 'heatmap' | 'calendar';
const VIEWS: {id: View; label: string; icon: typeof Activity}[] = [
  {id: 'markets', label: 'Markets', icon: LayoutDashboard},
  {id: 'chart', label: 'Chart', icon: CandlestickChart},
  {id: 'screener', label: 'Screener', icon: SlidersHorizontal},
  {id: 'heatmap', label: 'Heatmap', icon: Grid3x3},
  {id: 'calendar', label: 'Calendar', icon: CalendarDays},
];
const RANGES = ['1m', '3m', '6m', '1y', '3y', '5y'] as const;
const STRATEGIES = [['trend', 'Trend'], ['mean_reversion', 'Mean reversion'], ['breakout', 'Breakout']] as const;
const NO_SIGNALS: Signal[] = [];

function readPref<T extends string>(key: string, fallback: T): T {
  try { return (localStorage.getItem(`nm-v2-${key}`) as T) || fallback; } catch { return fallback; }
}
function writePref(key: string, value: string) {
  try { localStorage.setItem(`nm-v2-${key}`, value); } catch { /* storage unavailable */ }
}

export function Spark({values, width = 96, height = 28, className = ''}: {values: number[]; width?: number; height?: number; className?: string}) {
  if (values.length < 2) return <svg width={width} height={height} aria-hidden="true" />;
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * width).toFixed(1)},${(height - 2 - ((v - min) / span) * (height - 4)).toFixed(1)}`).join(' ');
  const t = tone(values.at(-1)! - values[0]);
  return <svg className={`v2-spark ${t} ${className}`} width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true"><polyline points={pts} fill="none" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" /></svg>;
}

export function Change({value, className = ''}: {value: number | null | undefined; className?: string}) {
  const t = tone(value);
  return <span className={`v2-chg ${t} ${className}`}>{t === 'up' ? <TrendingUp size={12} aria-hidden /> : t === 'down' ? <TrendingDown size={12} aria-hidden /> : null}{pct(value)}</span>;
}

const LEVELS = ['Strong sell', 'Sell', 'Neutral', 'Buy', 'Strong buy'] as const;
function levelOf(score: number) { return score < -0.5 ? 0 : score < -0.1 ? 1 : score <= 0.1 ? 2 : score <= 0.5 ? 3 : 4; }

function Rating({score, label}: {score: number; label: string}) {
  const level = levelOf(score);
  const cls = level < 2 ? 'down' : level > 2 ? 'up' : 'flat';
  return <div className="v2-rating" aria-label={`Indicator summary: ${label}`}>
    <div className={`v2-rating-head ${cls}`}>{level > 2 ? <TrendingUp size={20} aria-hidden /> : level < 2 ? <TrendingDown size={20} aria-hidden /> : <Activity size={20} aria-hidden />}<b>{label}</b></div>
    <div className="v2-rating-scale" aria-hidden>
      {LEVELS.map((l, i) => <span key={l} className={`s${i} ${i === level ? 'on' : ''}`}>{l}</span>)}
    </div>
  </div>;
}

function VoteBar({title, c}: {title: string; c: {buy: number; neutral: number; sell: number}}) {
  const total = c.buy + c.neutral + c.sell || 1;
  return <div className="v2-votebar">
    <div className="v2-votebar-top"><span>{title}</span><span className="mono"><b className="up">{c.buy}</b> · <b className="flat">{c.neutral}</b> · <b className="down">{c.sell}</b></span></div>
    <div className="v2-votebar-track" role="img" aria-label={`${c.buy} buy, ${c.neutral} neutral, ${c.sell} sell`}>
      <i className="up" style={{width: `${(c.buy / total) * 100}%`}} /><i className="flat" style={{width: `${(c.neutral / total) * 100}%`}} /><i className="down" style={{width: `${(c.sell / total) * 100}%`}} />
    </div>
  </div>;
}

export default function Terminal() {
  const [user, setUser] = useState<any>(null);
  const [error, setError] = useState('');
  const [view, setView] = useState<View>('markets');
  const [symbol, setSymbol] = useState('NVDA');
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [session, setSession] = useState<any>(null);
  const [universe, setUniverse] = useState<any[]>([]);
  const [watchlists, setWatchlists] = useState<any[]>([]);
  const [listId, setListId] = useState<number | 'tracked'>('tracked');
  const [watchQuotes, setWatchQuotes] = useState<Record<string, any>>({});
  const [overview, setOverview] = useState<any>(null);
  const [toast, setToast] = useState('');
  const [booted, setBooted] = useState(false);
  const admin = user?.role === 'admin';
  const mode = admin ? 'market' : 'demo';
  const ready = !!user;

  // Boot: session, prefs, deep link.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const v = params.get('view') as View | null;
    if (v && VIEWS.some(x => x.id === v)) setView(v);
    const s = params.get('s');
    if (s && /^[A-Z][A-Z0-9.\-]{0,11}$/.test(s)) setSymbol(s);
    setTheme(readPref('theme', 'dark'));
    setBooted(true);
    (async () => {
      try {
        const me = await api('/auth/session');
        setCsrf(me.csrf); setUser(me);
        const [u, w] = await Promise.all([api('/instruments/search'), api('/watchlists')]);
        setUniverse(u); setWatchlists(w);
        if (w.length) setListId(w[0].id);
      } catch (e) { setError((e as Error).message); }
    })();
  }, []);

  useEffect(() => { document.documentElement.classList.add('v2-root'); return () => document.documentElement.classList.remove('v2-root'); }, []);
  useEffect(() => { document.documentElement.dataset.theme = theme; if (booted) writePref('theme', theme); }, [theme, booted]);
  useEffect(() => {
    if (!booted) return;
    const url = new URL(window.location.href);
    url.searchParams.set('view', view);
    url.searchParams.set('s', symbol);
    window.history.replaceState(null, '', url);
  }, [booted, view, symbol]);

  useEffect(() => {
    if (!ready) return;
    let alive = true;
    const load = () => api('/markets/session').then(s => alive && setSession(s)).catch(() => alive && setSession({status: 'unknown'}));
    void load();
    const t = setInterval(load, 30000);
    return () => { alive = false; clearInterval(t); };
  }, [ready]);

  useEffect(() => {
    if (!ready) return;
    api(`/markets/overview?mode=${mode}`).then(setOverview).catch(e => setError((e as Error).message));
  }, [ready, mode]);

  const intraday = useIntradayPrices({ready, mode, admin, sessionStatus: session?.status, version: 0});
  const activeList = listId === 'tracked' ? null : watchlists.find(w => w.id === listId);
  const tracked = useMemo(() => new Set(universe.map(u => u.symbol as string)), [universe]);
  const railSymbols: string[] = useMemo(() => activeList ? activeList.symbols : universe.map(u => u.symbol), [activeList, universe]);

  useEffect(() => {
    if (!ready || !activeList) return;
    let alive = true;
    Promise.all(activeList.symbols.map((s: string) => api(`/instruments/${s}/quote?mode=${mode}`).then(q => [s, q] as const).catch(() => [s, null] as const)))
      .then(rows => alive && setWatchQuotes(Object.fromEntries(rows)));
    return () => { alive = false; };
  }, [ready, activeList, mode]);

  const quoteFor = useCallback((s: string) => {
    const daily = watchQuotes[s] || universe.find(u => u.symbol === s);
    return latestAvailableQuote(intraday.data, s, daily, mode);
  }, [watchQuotes, universe, intraday.data, mode]);

  const choose = useCallback((s: string) => { setSymbol(s.toUpperCase()); setView('chart'); }, []);

  async function addToList(s: string) {
    if (!activeList) { setToast('Create a watchlist in the classic view first.'); return; }
    if (activeList.symbols.includes(s)) return;
    const next = {...activeList, symbols: [...activeList.symbols, s]};
    try {
      await api('/watchlists', {method: 'POST', body: JSON.stringify({id: activeList.id, name: activeList.name, symbols: next.symbols})});
      setWatchlists(ws => ws.map(w => w.id === next.id ? next : w));
      setToast(`${s} added to ${activeList.name}`);
    } catch (e) { setToast((e as Error).message); }
  }

  async function logout() { await api('/auth/logout', {method: 'POST', body: '{}'}).catch(() => null); window.location.assign('/login'); }

  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 4000); return () => clearTimeout(t); }, [toast]);

  if (error && !user) return <main className="v2 v2-center"><p className="v2-error">{error}</p></main>;
  if (!user) return <main className="v2 v2-center"><div className="v2-skeleton" style={{width: 240, height: 12}} /></main>;

  const tape = (overview?.items || []).filter((i: any) => i.proxy);

  return <TrackedSymbols.Provider value={tracked}><div className="v2">
    <a className="v2-skip" href="#v2-main">Skip to content</a>
    <header className="v2-top">
      <div className="v2-brand"><img src="/nidhiksh-logo.png" alt="" width={26} height={26} /><span>Nidhiksh<em>Pulse</em></span></div>
      <nav className="v2-nav" aria-label="Primary">
        {VIEWS.map(({id, label, icon: Icon}) => <button key={id} className={view === id ? 'on' : ''} aria-current={view === id ? 'page' : undefined} onClick={() => setView(id)}><Icon size={15} aria-hidden />{label}</button>)}
      </nav>
      <SearchBox admin={admin} onChoose={choose} onToast={setToast} />
      <div className="v2-top-right">
        <span className={`v2-session ${session?.status === 'open' ? 'open' : 'closed'}`} title={session?.message || ''}><i aria-hidden />{session?.status === 'open' ? 'Market open' : session?.status === 'unknown' ? 'Session unknown' : 'Market closed'}</span>
        {mode === 'demo' && <span className="v2-pill warn" title="Viewer accounts see synthetic data until display rights are approved">Demo data</span>}
        <button className="v2-icon" onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>{theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}</button>
        <a className="v2-icon" href="/classic" title="Classic view" aria-label="Open classic view"><Undo2 size={16} /></a>
        <button className="v2-icon" onClick={logout} aria-label="Sign out"><LogOut size={16} /></button>
      </div>
    </header>

    <div className="v2-tape" role="list" aria-label="Market proxies">
      {tape.map((i: any) => <button role="listitem" key={i.symbol} onClick={() => choose(i.symbol)} title={i.note}>
        <b>{i.label.replace(/^US · /, '')}</b><span className="mono">{i.price == null ? '—' : money(i.price)}</span><Change value={i.change_percent} />
      </button>)}
    </div>

    <div className="v2-body">
      <aside className="v2-rail" aria-label="Watchlist">
        <div className="v2-rail-head">
          <label className="v2-select"><span className="sr">Watchlist</span>
            <select value={String(listId)} onChange={e => setListId(e.target.value === 'tracked' ? 'tracked' : Number(e.target.value))}>
              {watchlists.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              <option value="tracked">All researched ({universe.length})</option>
            </select><ChevronDown size={14} aria-hidden />
          </label>
        </div>
        <ul>
          {railSymbols.map(s => {
            const q = quoteFor(s);
            const name = universe.find(u => u.symbol === s)?.name || '';
            return <li key={s}><button className={s === symbol && view === 'chart' ? 'on' : ''} onClick={() => choose(s)}>
              <Logo symbol={s} size={30} /><span className="v2-rail-sym"><b>{s}</b><small>{name}</small></span>
              <span className="v2-rail-px"><span className="mono">{q?.price == null ? '—' : money(q.price)}</span><Change value={q?.change_percent} /></span>
            </button></li>;
          })}
        </ul>
        {intraday.error && <p className="v2-note">Price refresh paused: {intraday.error}</p>}
      </aside>

      <main id="v2-main" className="v2-main">
        {error && <p className="v2-error" role="alert">{error}</p>}
        {view === 'markets' && <MarketsView mode={mode} overview={overview} onChoose={choose} />}
        {view === 'chart' && <ChartView key={symbol} symbol={symbol} mode={mode} admin={admin} intraday={intraday} theme={theme}
          onAdd={activeList && !activeList.symbols.includes(symbol) ? () => addToList(symbol) : undefined} />}
        {view === 'screener' && <Screener mode={mode} watchlists={watchlists} onChoose={choose} />}
        {view === 'heatmap' && <section className="v2-panel v2-legacy"><Heatmap mode={mode} watchlists={watchlists} admin={admin} onChoose={choose} /></section>}
        {view === 'calendar' && <CalendarView mode={mode} admin={admin} watchlists={watchlists} onChoose={choose} />}
      </main>
    </div>
    {toast && <div className="v2-toast" role="status" aria-live="polite">{toast}</div>}
  </div></TrackedSymbols.Provider>;
}

function SearchBox({admin, onChoose, onToast}: {admin: boolean; onChoose: (s: string) => void; onToast: (s: string) => void}) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;
      if ((e.key === '/' && !typing) || (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); input.current?.focus(); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  useEffect(() => {
    if (!q.trim()) { setItems([]); return; }
    const c = new AbortController();
    const t = setTimeout(() => api(`/instruments/search?q=${encodeURIComponent(q.trim())}`, {signal: c.signal}).then(r => { setItems(r.slice(0, 8)); setActive(0); }).catch(() => null), 180);
    return () => { clearTimeout(t); c.abort(); };
  }, [q]);

  async function pick(item: any) {
    setOpen(false); setQ('');
    if (item.cached) { onChoose(item.symbol); return; }
    if (!admin) { onToast(`${item.symbol} has no cached history yet. An admin can add it.`); return; }
    try {
      await api('/instruments', {method: 'POST', body: JSON.stringify({symbol: item.symbol})});
      onToast(`Fetching available history for ${item.symbol}…`);
      setTimeout(() => onChoose(item.symbol), 3500);
    } catch (e) { onToast((e as Error).message); }
  }

  return <div className="v2-search" role="combobox" aria-expanded={open && items.length > 0} aria-haspopup="listbox">
    <Search size={15} aria-hidden />
    <input ref={input} value={q} placeholder="Search symbol or company" aria-label="Search symbol or company" aria-controls="v2-search-list"
      onChange={e => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
      onKeyDown={e => {
        if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, items.length - 1)); }
        if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
        if (e.key === 'Enter' && items[active]) void pick(items[active]);
        if (e.key === 'Escape') { setOpen(false); input.current?.blur(); }
      }} />
    <kbd aria-hidden>/</kbd>
    {open && items.length > 0 && <ul id="v2-search-list" role="listbox">
      {items.map((i, n) => <li key={i.symbol} role="option" aria-selected={n === active}>
        <button onMouseDown={e => e.preventDefault()} onClick={() => pick(i)} className={n === active ? 'on' : ''}>
          <span className="v2-search-sym"><Logo symbol={i.symbol} size={22} /><b>{i.symbol}</b></span><span>{i.name}</span>
          {i.cached ? <span className="mono">{i.price == null ? '' : money(i.price)}</span> : <span className="v2-pill">{admin ? <><Plus size={11} />Add</> : 'Not cached'}</span>}
        </button>
      </li>)}
    </ul>}
  </div>;
}

function MarketsView({mode, overview, onChoose}: {mode: string; overview: any; onChoose: (s: string) => void}) {
  const [holdings, setHoldings] = useState<any>(null);
  const [sparks, setSparks] = useState<Record<string, number[]>>({});
  const [movers, setMovers] = useState<'gainers' | 'losers' | 'largest'>('gainers');
  const cards = ['SPY', 'QQQ', 'DIA', 'IWM'];

  useEffect(() => {
    let alive = true;
    api(`/heatmap?universe=sp500&mode=${mode}`).then(r => alive && setHoldings(r)).catch(() => alive && setHoldings({items: []}));
    Promise.all(cards.map(s => api(`/instruments/${s}/bars?mode=${mode}&range=3m`).then(r => [s, r] as const).catch(() => [s, null] as const)))
      .then(rows => alive && setSparks(Object.fromEntries(rows.map(([s, r]) => [s, (r?.bars || []).map((b: Bar) => b.close)]))));
    return () => { alive = false; };
  }, [mode]);

  const rows: any[] = useMemo(() => (holdings?.items || []).filter((r: any) => typeof r.change_percent === 'number'), [holdings]);
  const breadth = useMemo(() => ({
    up: rows.filter(r => r.change_percent > 0).length,
    down: rows.filter(r => r.change_percent < 0).length,
    flat: rows.filter(r => r.change_percent === 0).length,
  }), [rows]);
  const sectors = useMemo(() => {
    const m = new Map<string, {w: number; s: number; n: number}>();
    for (const r of rows) {
      const k = r.sector || 'Other'; const w = Number(r.weight) > 0 ? Number(r.weight) : 1;
      const e = m.get(k) || {w: 0, s: 0, n: 0}; e.w += w; e.s += w * r.change_percent; e.n++; m.set(k, e);
    }
    return [...m.entries()].map(([name, e]) => ({name, change: e.w ? e.s / e.w : 0, n: e.n})).sort((a, b) => b.change - a.change);
  }, [rows]);
  const maxSector = Math.max(0.01, ...sectors.map(s => Math.abs(s.change)));
  const moverRows = useMemo(() => {
    const copy = [...rows];
    if (movers === 'gainers') copy.sort((a, b) => b.change_percent - a.change_percent);
    else if (movers === 'losers') copy.sort((a, b) => a.change_percent - b.change_percent);
    else copy.sort((a, b) => (b.weight || 0) - (a.weight || 0));
    return copy.slice(0, 10);
  }, [rows, movers]);
  const byLabel = (s: string) => overview?.items?.find((i: any) => i.symbol === s);
  const global = (overview?.items || []).filter((i: any) => i.proxy && !cards.includes(i.symbol));
  const total = breadth.up + breadth.down + breadth.flat || 1;

  return <div className="v2-grid">
    <section className="v2-cards" aria-label="US indices (ETF proxies)">
      {cards.map(s => {
        const o = byLabel(s); const sp = sparks[s] || [];
        const price = o?.price ?? sp.at(-1) ?? null;
        const chg = o?.change_percent ?? (sp.length > 1 ? (sp.at(-1)! / sp.at(-2)! - 1) * 100 : null);
        return <button key={s} className="v2-card" onClick={() => onChoose(s)}>
          <span className="v2-card-label">{o?.label?.replace(/^US · /, '') || s}<small>{s} · ETF proxy</small></span>
          <span className="v2-card-price mono">{price == null ? '—' : money(price)}</span>
          <Change value={chg} />
          <Spark values={sp} width={220} height={44} className="wide" />
          <small className="v2-card-foot">3-month daily closes</small>
        </button>;
      })}
    </section>

    <section className="v2-panel" aria-labelledby="breadth-h">
      <header><h2 id="breadth-h">S&amp;P 500 breadth</h2><small>IVV holdings proxy · daily close</small></header>
      {rows.length ? <>
        <div className="v2-breadth" role="img" aria-label={`${breadth.up} advancing, ${breadth.down} declining, ${breadth.flat} unchanged`}>
          <span className="up" style={{flexGrow: breadth.up}} /><span className="flat" style={{flexGrow: breadth.flat}} /><span className="down" style={{flexGrow: breadth.down}} />
        </div>
        <div className="v2-breadth-legend"><span className="up">{breadth.up} advancing ({Math.round(breadth.up / total * 100)}%)</span><span>{breadth.flat} unchanged</span><span className="down">{breadth.down} declining ({Math.round(breadth.down / total * 100)}%)</span></div>
      </> : <p className="v2-note">{holdings ? holdings.note || 'No cached holdings yet.' : 'Loading…'}</p>}
    </section>

    <section className="v2-panel" aria-labelledby="sector-h">
      <header><h2 id="sector-h">Sector performance</h2><small>Weight-averaged daily change</small></header>
      <ul className="v2-sectors">
        {sectors.map(s => <li key={s.name}>
          <span className="name">{s.name}<small>{s.n}</small></span>
          <span className="bar"><i className={tone(s.change)} style={{width: `${(Math.abs(s.change) / maxSector) * 50}%`, [s.change >= 0 ? 'left' : 'right']: '50%'} as React.CSSProperties} /></span>
          <Change value={s.change} />
        </li>)}
        {!sectors.length && <li className="v2-note">No sector data cached.</li>}
      </ul>
    </section>

    <section className="v2-panel span2" aria-labelledby="movers-h">
      <header><h2 id="movers-h">Movers</h2>
        <div className="v2-seg" role="tablist">{(['gainers', 'losers', 'largest'] as const).map(m => <button key={m} role="tab" aria-selected={movers === m} className={movers === m ? 'on' : ''} onClick={() => setMovers(m)}>{m === 'largest' ? 'Largest weight' : m[0].toUpperCase() + m.slice(1)}</button>)}</div>
      </header>
      <table className="v2-table">
        <thead><tr><th>Symbol</th><th>Company</th><th>Sector</th><th className="r">Price</th><th className="r">Change</th><th className="r">Trend</th></tr></thead>
        <tbody>{moverRows.map(r => <tr key={r.symbol} onClick={() => onChoose(r.symbol)} tabIndex={0} onKeyDown={e => e.key === 'Enter' && onChoose(r.symbol)}>
          <td><span className="v2-sym"><Logo symbol={r.symbol} size={22} /><b>{r.symbol}</b></span></td><td className="ellipsis">{r.name}</td><td className="muted ellipsis">{r.sector}</td>
          <td className="r mono">{money(r.price)}</td><td className="r"><Change value={r.change_percent} /></td>
          <td className="r"><Spark values={(r.history || []).map((h: any) => h.value)} width={80} height={22} /></td>
        </tr>)}</tbody>
      </table>
    </section>

    <section className="v2-panel" aria-labelledby="global-h">
      <header><h2 id="global-h">Global &amp; commodities</h2><small>ETF proxies, not the indices</small></header>
      <ul className="v2-list">{global.map((i: any) => <li key={i.symbol}><button onClick={() => onChoose(i.symbol)} title={i.note}>
        <span className="v2-sym"><Logo symbol={i.symbol} size={26} /><span className="v2-col"><b>{i.label}</b><small>{i.symbol}</small></span></span><span className="mono">{i.price == null ? '—' : money(i.price)}</span><Change value={i.change_percent} />
      </button></li>)}</ul>
    </section>
  </div>;
}

function ChartView({symbol, mode, admin, intraday, theme, onAdd}: {symbol: string; mode: string; admin: boolean; intraday: any; theme: string; onAdd?: () => void}) {
  const [range, setRange] = useState<string>(() => readPref('range', '1y'));
  const [type, setType] = useState<string>(() => { const t: string = readPref<string>('chart', 'candlestick'); return t === 'candle' ? 'candlestick' : t; });
  const [strategy, setStrategy] = useState<string>(() => readPref('strategy', 'trend'));
  const [showSignals, setShowSignals] = useState<boolean>(() => readPref<'on' | 'off'>('signals', 'off') === 'on');
  const [bars, setBars] = useState<any>(null);
  const [full, setFull] = useState<any>(null);
  const [quote, setQuote] = useState<any>(null);
  const [signals, setSignals] = useState<any>(null);
  const [tab, setTab] = useState<'news' | 'filings' | 'financials' | 'signals'>('news');
  const [news, setNews] = useState<any>(null), [filings, setFilings] = useState<any>(null), [fundamentals, setFundamentals] = useState<any>(null);
  const [config, setConfig] = useState<IndicatorConfig | null>(null);
  const [studio, setStudio] = useState(false);
  const [version, setVersion] = useState(0);
  const [err, setErr] = useState('');
  const root = `/instruments/${encodeURIComponent(symbol)}`;

  useEffect(() => { writePref('range', range); writePref('chart', type); writePref('strategy', strategy); writePref('signals', showSignals ? 'on' : 'off'); }, [range, type, strategy, showSignals]);

  useEffect(() => {
    let alive = true; setErr('');
    api(`${root}/bars?mode=${mode}&range=${range}`).then(r => { if (alive) { setBars(r); setConfig(r.config); } }).catch(e => alive && setErr((e as Error).message));
    return () => { alive = false; };
  }, [root, mode, range, version]);

  useEffect(() => {
    let alive = true;
    const get = (p: string, set: (v: any) => void) => api(p).then(r => alive && set(r)).catch(() => alive && set(null));
    get(`${root}/bars?mode=${mode}&range=5y`, setFull);
    get(`${root}/quote?mode=${mode}`, setQuote);
    get(`${root}/signals?mode=${mode}`, setSignals);
    get(`${root}/news?mode=${mode}`, setNews);
    get(`${root}/filings?mode=${mode}`, setFilings);
    get(`${root}/fundamentals?mode=${mode}`, setFundamentals);
    return () => { alive = false; };
  }, [root, mode]);

  const display = latestAvailableQuote(intraday.data, symbol, quote, mode);
  const fullBars: Bar[] = full?.bars || [];
  const stats = useMemo(() => keyStats(fullBars), [fullBars]);
  const tech = useMemo(() => fullBars.length ? technicalSummary(fullBars) : null, [fullBars]);
  const perf = useMemo(() => periodReturns(fullBars, display?.price), [fullBars, display?.price]);
  const chgPct = display?.change_percent ?? quote?.change_percent ?? null;
  const prev = stats?.prevClose;
  const chgAbs = display?.price != null && prev ? display.price - prev : null;
  const events: Signal[] = signals?.events || NO_SIGNALS;
  const chartSignals = useMemo(() => showSignals ? events.filter(s => s.strategy === strategy) : NO_SIGNALS, [events, strategy, showSignals]);
  const supported: string[] = bars?.supported_ranges || [];
  const last = bars?.bars?.at(-1);

  async function applyIndicators(next: IndicatorConfig) {
    try { await api('/settings/indicators', {method: 'PUT', body: JSON.stringify(next)}); setConfig(next); setStudio(false); setVersion(v => v + 1); }
    catch (e) { setErr((e as Error).message); }
  }

  return <div className="v2-chart-layout">
    <section className="v2-panel v2-quote" aria-labelledby="q-h">
      <div className="v2-quote-id">
        <Logo symbol={symbol} size={44} />
        <div><h1 id="q-h">{symbol}</h1><p>{quote?.name || bars?.symbol || ''}</p></div>
        {onAdd && <button className="v2-btn ghost" onClick={onAdd}><Plus size={14} />Watchlist</button>}
      </div>
      <div className="v2-quote-px">
        <span className="mono big">{display?.price == null ? '—' : money(display.price)}</span>
        <span className={`v2-chg lg ${tone(chgPct)}`}>{chgAbs == null ? '' : `${chgAbs >= 0 ? '+' : '−'}${money(Math.abs(chgAbs))} `}({pct(chgPct)})</span>
        <span className="v2-asof">{display?.as_of ? asOf(display.as_of) : 'Not available'} <QuoteInfo quote={display} data={intraday.data} error={intraday.error} symbol={symbol} /></span>
      </div>
    </section>

    <section className="v2-panel v2-chart" aria-label={`${symbol} chart`}>
      <div className="v2-toolbar">
        <div className="v2-seg" role="group" aria-label="Range">{RANGES.map(r => <button key={r} className={range === r ? 'on' : ''} disabled={!!bars && !supported.includes(r)} onClick={() => setRange(r)}>{r.toUpperCase()}</button>)}</div>
        <div className="v2-seg" role="group" aria-label="Chart type">
          {([['candlestick', CandlestickChart], ['line', LineChart], ['area', AreaChart]] as const).map(([t, Icon]) => <button key={t} className={type === t ? 'on' : ''} onClick={() => setType(t)} aria-label={`${t === 'candlestick' ? 'Candlestick' : t} chart`} title={t === 'candlestick' ? 'Candles' : `${t[0].toUpperCase()}${t.slice(1)}`}><Icon size={15} /></button>)}
        </div>
        <span className="grow" />
        <label className="v2-toggle"><input type="checkbox" checked={showSignals} onChange={e => setShowSignals(e.target.checked)} /><span>Research signals</span></label>
        {showSignals && <label className="v2-select sm"><span className="sr">Strategy</span><select value={strategy} onChange={e => setStrategy(e.target.value)}>{STRATEGIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select><ChevronDown size={13} aria-hidden /></label>}
        <button className="v2-btn" onClick={() => setStudio(true)} disabled={!config}><BarChart3 size={14} />Indicators</button>
      </div>
      {err && <p className="v2-error" role="alert">{err}</p>}
      <div className="v2-chart-box">
        {bars?.bars?.length ? <MarketChart bars={bars.bars} indicators={bars.indicators || {}} signals={chartSignals} type={type} dark={theme === 'dark'} config={config || bars.config} onSignal={() => setTab('signals')} />
          : bars ? <p className="v2-note pad">No cached daily bars for {symbol}. {admin ? 'Use search to add it and fetch history.' : ''}</p> : <div className="v2-skeleton" style={{height: 460}} />}
      </div>
      <footer className="v2-chart-foot">
        <span>Daily bars · {bars?.freshness?.source || '—'} · last bar {last ? dateLabel(last.timestamp.slice(0, 10)) : '—'}</span>
        {showSignals && <span>Signals are unvalidated historical research markers — not trade recommendations.</span>}
      </footer>
    </section>

    <aside className="v2-side">
      <section className="v2-panel" aria-labelledby="tech-h">
        <header><h2 id="tech-h">Technical summary</h2><small>Daily · rule votes</small></header>
        {tech ? <>
          <Rating score={tech.score} label={tech.label} />
          <div className="v2-votes">
            <VoteBar title="Moving averages" c={tech.maCounts} />
            <VoteBar title="Oscillators" c={tech.oscCounts} />
          </div>
          <details className="v2-details"><summary>Show each rule</summary>
            <table className="v2-table compact"><tbody>{[...tech.osc, ...tech.ma].map(r => <tr key={r.name}><td>{r.name}</td><td className="r mono">{r.value == null ? '—' : r.value.toFixed(2)}</td><td className={`r ${r.vote === 'buy' ? 'up' : r.vote === 'sell' ? 'down' : 'muted'}`}>{r.vote}</td></tr>)}</tbody></table>
          </details>
          <p className="v2-fine">Mechanical snapshot of common indicators from cached daily closes. Not advice and not a validated strategy.</p>
        </> : <div className="v2-skeleton" style={{height: 160}} />}
      </section>

      <section className="v2-panel" aria-labelledby="perf-h">
        <header><h2 id="perf-h">Performance</h2></header>
        <div className="v2-perf">{perf.map(p => <div key={p.label} className={tone(p.value)}><small>{p.label}</small><b>{pct(p.value, 1)}</b></div>)}</div>
      </section>

      <section className="v2-panel" aria-labelledby="stats-h">
        <header><h2 id="stats-h">Key statistics</h2>{stats && <small>{dateLabel(stats.date.slice(0, 10))}</small>}</header>
        {stats ? <dl className="v2-stats">
          <div><dt>Open</dt><dd>{money(stats.open)}</dd></div><div><dt>Prev close</dt><dd>{money(stats.prevClose)}</dd></div>
          <div><dt>Day high</dt><dd>{money(stats.high)}</dd></div><div><dt>Day low</dt><dd>{money(stats.low)}</dd></div>
          <div><dt>52-wk high</dt><dd>{money(stats.high52)}</dd></div><div><dt>52-wk low</dt><dd>{money(stats.low52)}</dd></div>
          <div><dt>Volume</dt><dd>{number(stats.volume)}</dd></div><div><dt>Avg vol (30d)</dt><dd>{number(stats.avgVolume)}</dd></div>
          <div className="wide"><dt>52-wk range</dt><dd><RangeBar low={stats.low52} high={stats.high52} value={display?.price ?? stats.prevClose ?? stats.low52} /></dd></div>
          <div><dt>Volatility (1Y)</dt><dd>{stats.volatility == null ? '—' : `${stats.volatility.toFixed(1)}%`}</dd></div>
          <div><dt>RSI (14)</dt><dd>{tech?.osc[0].value == null ? '—' : tech.osc[0].value.toFixed(1)}</dd></div>
        </dl> : <div className="v2-skeleton" style={{height: 140}} />}
      </section>
    </aside>

    <section className="v2-panel v2-feed" aria-label="Research">
      <div className="v2-seg" role="tablist">{(['news', 'filings', 'financials', 'signals'] as const).map(t => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t[0].toUpperCase() + t.slice(1)}</button>)}</div>
      {tab === 'news' && <FeedList items={news?.items} empty={news?.note || 'No cached news.'} render={(n: any) => <a href={n.url} target="_blank" rel="noreferrer"><b>{n.title}</b><small>{n.publisher || n.provider} · {asOf(n.published_at || n.discovered_at)}</small><ExternalLink size={13} aria-hidden /></a>} />}
      {tab === 'filings' && <FeedList items={filings?.items} empty="No cached filings." render={(f: any) => <a href={f.url} target="_blank" rel="noreferrer"><b><span className="v2-pill">{f.form}</span> SEC filing</b><small>Filed {dateLabel(f.filing_date?.slice(0, 10))}</small><ExternalLink size={13} aria-hidden /></a>} />}
      {tab === 'financials' && (fundamentals ? <Financials data={fundamentals} symbol={symbol} /> : <p className="v2-note">No reported financials cached.</p>)}
      {tab === 'signals' && <FeedList items={[...events].reverse().slice(0, 30)} empty="No historical research candidates for this symbol." render={(s: Signal) => <div className="v2-signal">
        <span className={`v2-pill ${s.kind === 'entry' ? 'up' : 'down'}`}>{s.kind === 'entry' ? '▲ Buy' : '▼ Sell'}</span>
        <b>{s.label || s.strategy}</b><small>{dateLabel(s.time.slice(0, 10))} · {money(s.price)} · {s.strategy.replace('_', ' ')} v{s.version}</small>
      </div>} />}
      {tab === 'signals' && signals?.note && <p className="v2-fine">{signals.note}</p>}
    </section>

    {studio && config && <div className="v2-legacy"><IndicatorStudio config={config} symbol={symbol} mode={mode} onClose={() => setStudio(false)} onApply={applyIndicators} /></div>}
  </div>;
}

function RangeBar({low, high, value}: {low: number; high: number; value: number}) {
  const p = high > low ? Math.min(100, Math.max(0, ((value - low) / (high - low)) * 100)) : 50;
  return <span className="v2-range" aria-label={`Current price is ${p.toFixed(0)}% of the way from the 52-week low to high`}><span>{money(low)}</span><i><em style={{left: `${p}%`}} /></i><span>{money(high)}</span></span>;
}

function FeedList({items, empty, render}: {items?: any[]; empty: string; render: (item: any) => React.ReactNode}) {
  if (!items) return <div className="v2-skeleton" style={{height: 120}} />;
  if (!items.length) return <p className="v2-note">{empty}</p>;
  return <ul className="v2-feed-list">{items.slice(0, 30).map((i, n) => <li key={i.id ?? n}>{render(i)}</li>)}</ul>;
}

function CalendarView({mode, admin, watchlists, onChoose}: {mode: string; admin: boolean; watchlists: any[]; onChoose: (s: string) => void}) {
  const [tab, setTab] = useState<'earnings' | 'ipos'>('earnings');
  return <section className="v2-panel">
    <header><div className="v2-seg" role="tablist">
      <button role="tab" aria-selected={tab === 'earnings'} className={tab === 'earnings' ? 'on' : ''} onClick={() => setTab('earnings')}>Earnings</button>
      <button role="tab" aria-selected={tab === 'ipos'} className={tab === 'ipos' ? 'on' : ''} onClick={() => setTab('ipos')}>Upcoming IPOs</button>
    </div></header>
    <div className="v2-legacy">
      {tab === 'earnings' ? <EarningsCalendar mode={mode} admin={admin} watchlists={watchlists} onChoose={onChoose} /> : <UpcomingIPOs admin={admin} onSearch={onChoose} />}
    </div>
  </section>;
}
