'use client';
import {createContext, useContext, useState} from 'react';

/** Symbols the backend tracks; only these can have a cached logo (see ingestion 'logos'). */
export const TrackedSymbols = createContext<Set<string>>(new Set());
const STATIC = new Set(['NVDA', 'AAPL', 'MSFT']);
const failed = new Set<string>(); // remember 404s for the session so lists don't re-request

export default function Logo({symbol, size = 28}: {symbol: string; size?: number}) {
  const tracked = useContext(TrackedSymbols);
  const [broken, setBroken] = useState(() => failed.has(symbol));
  const src = STATIC.has(symbol) ? `/logos/${symbol}.ico` : tracked.has(symbol) ? `/api/instruments/${encodeURIComponent(symbol)}/logo` : null;
  const style = {width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.36))};
  if (!src || broken) return <span className="v2-logo initials" style={style} aria-hidden>{symbol.replace(/[^A-Z]/g, '').slice(0, 2)}</span>;
  return <span className="v2-logo" style={style}>
    <img src={src} alt="" width={size} height={size} loading="lazy" decoding="async" onError={() => { failed.add(symbol); setBroken(true); }} />
  </span>;
}
