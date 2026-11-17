// Display-only calculations for the v2 layout. They read the same cached daily bars
// the backend serves; nothing here changes stored research or signal logic.
import type {Bar} from '@/lib/api';

export type Vote = 'buy' | 'sell' | 'neutral';
export type Reading = {name: string; value: number | null; vote: Vote};

export const pct = (v: number | null | undefined, digits = 2) =>
  v == null || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(digits)}%`;
export const tone = (v: number | null | undefined) => (v == null || v === 0 ? 'flat' : v > 0 ? 'up' : 'down');

function smaLast(values: number[], n: number) {
  if (values.length < n) return null;
  let sum = 0;
  for (let i = values.length - n; i < values.length; i++) sum += values[i];
  return sum / n;
}

function emaSeries(values: number[], n: number) {
  const out: number[] = [];
  const k = 2 / (n + 1);
  values.forEach((v, i) => out.push(i === 0 ? v : v * k + out[i - 1] * (1 - k)));
  return out;
}

function rsiLast(values: number[], n = 14) {
  if (values.length <= n) return null;
  let gain = 0, loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = values[i] - values[i - 1];
    gain += Math.max(d, 0); loss += Math.max(-d, 0);
  }
  gain /= n; loss /= n;
  for (let i = n + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    gain = (gain * (n - 1) + Math.max(d, 0)) / n;
    loss = (loss * (n - 1) + Math.max(-d, 0)) / n;
  }
  return loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
}

function stochasticLast(bars: Bar[], n = 14) {
  if (bars.length < n) return null;
  const w = bars.slice(-n);
  const hi = Math.max(...w.map(b => b.high)), lo = Math.min(...w.map(b => b.low));
  return hi === lo ? 50 : ((bars.at(-1)!.close - lo) / (hi - lo)) * 100;
}

/** A transparent, rule-based snapshot: each rule casts one vote. Not a recommendation. */
export function technicalSummary(bars: Bar[]) {
  const closes = bars.map(b => b.close);
  const price = closes.at(-1) ?? null;
  const ma: Reading[] = [];
  for (const n of [10, 20, 50, 100, 200]) {
    const s = smaLast(closes, n);
    ma.push({name: `SMA ${n}`, value: s, vote: s == null || price == null ? 'neutral' : price > s ? 'buy' : price < s ? 'sell' : 'neutral'});
    const e = closes.length >= n ? emaSeries(closes, n).at(-1)! : null;
    ma.push({name: `EMA ${n}`, value: e, vote: e == null || price == null ? 'neutral' : price > e ? 'buy' : price < e ? 'sell' : 'neutral'});
  }
  const osc: Reading[] = [];
  const r = rsiLast(closes);
  osc.push({name: 'RSI (14)', value: r, vote: r == null ? 'neutral' : r < 30 ? 'buy' : r > 70 ? 'sell' : 'neutral'});
  const st = stochasticLast(bars);
  osc.push({name: 'Stochastic %K (14)', value: st, vote: st == null ? 'neutral' : st < 20 ? 'buy' : st > 80 ? 'sell' : 'neutral'});
  if (closes.length >= 35) {
    const f = emaSeries(closes, 12), s = emaSeries(closes, 26);
    const macd = f.map((v, i) => v - s[i]);
    const sig = emaSeries(macd, 9);
    const m = macd.at(-1)!, g = sig.at(-1)!;
    osc.push({name: 'MACD (12, 26, 9)', value: m - g, vote: m > g ? 'buy' : m < g ? 'sell' : 'neutral'});
  } else osc.push({name: 'MACD (12, 26, 9)', value: null, vote: 'neutral'});
  if (closes.length > 10) {
    const mom = closes.at(-1)! - closes.at(-11)!;
    osc.push({name: 'Momentum (10)', value: mom, vote: mom > 0 ? 'buy' : mom < 0 ? 'sell' : 'neutral'});
  }
  const all = [...ma, ...osc];
  const count = (list: Reading[]) => ({
    buy: list.filter(x => x.vote === 'buy').length,
    sell: list.filter(x => x.vote === 'sell').length,
    neutral: list.filter(x => x.vote === 'neutral').length,
  });
  const c = count(all);
  const score = all.length ? (c.buy - c.sell) / all.length : 0; // -1..1
  const label = score > 0.5 ? 'Strong buy' : score > 0.1 ? 'Buy' : score < -0.5 ? 'Strong sell' : score < -0.1 ? 'Sell' : 'Neutral';
  return {ma, osc, counts: c, maCounts: count(ma), oscCounts: count(osc), score, label};
}

/** Return from the close on/just before `days` ago to the latest close. */
export function periodReturns(bars: Bar[], latest?: number | null) {
  if (!bars.length) return [];
  const last = latest ?? bars.at(-1)!.close;
  const end = new Date(bars.at(-1)!.timestamp);
  const ytd = new Date(Date.UTC(end.getUTCFullYear(), 0, 1));
  const spans: [string, number | Date][] = [['1W', 7], ['1M', 30], ['3M', 91], ['6M', 182], ['YTD', ytd], ['1Y', 365], ['3Y', 1095], ['5Y', 1826]];
  return spans.map(([label, span]) => {
    const cutoff = span instanceof Date ? span : new Date(end.getTime() - span * 86400000);
    if (new Date(bars[0].timestamp) > cutoff) return {label, value: null};
    let base = bars[0];
    for (const b of bars) { if (new Date(b.timestamp) <= cutoff) base = b; else break; }
    return {label, value: (last / base.close - 1) * 100};
  });
}

export function keyStats(bars: Bar[]) {
  if (!bars.length) return null;
  const last = bars.at(-1)!, prev = bars.at(-2);
  const year = bars.slice(-252);
  const vols = bars.slice(-30).map(b => b.volume);
  const closes = bars.map(b => b.close);
  const returns = closes.slice(-253).map((c, i, a) => (i ? Math.log(c / a[i - 1]) : 0)).slice(1);
  const mean = returns.reduce((a, b) => a + b, 0) / (returns.length || 1);
  const vol = Math.sqrt(returns.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, returns.length - 1)) * Math.sqrt(252) * 100;
  return {
    open: last.open, high: last.high, low: last.low, prevClose: prev?.close ?? null,
    volume: last.volume, avgVolume: vols.reduce((a, b) => a + b, 0) / (vols.length || 1),
    high52: Math.max(...year.map(b => b.high)), low52: Math.min(...year.map(b => b.low)),
    volatility: returns.length > 20 ? vol : null, date: last.timestamp,
  };
}
