/**
 * Static placeholder layouts shown underneath LockedOverlay. Every value here is FIXED SAMPLE CONTENT
 * (deliberately generic: "Sample Co", round numbers) — never real data for the viewed ticker.
 */
import * as React from 'react';

const bar = (w: string, cls = 'bg-muted/30') => <span className={`block h-2.5 rounded ${cls}`} style={{ width: w }} />;

export function AnalysisSample() {
  return (
    <div className="grid gap-4 p-4 md:grid-cols-3">
      <div className="flex items-center gap-4 rounded-lg border border-border p-4">
        <svg viewBox="0 0 42 42" className="h-24 w-24 -rotate-90"><circle cx="21" cy="21" r="15.9" fill="none" stroke="rgb(var(--border))" strokeWidth="6" /><circle cx="21" cy="21" r="15.9" fill="none" stroke="rgb(var(--up))" strokeWidth="6" strokeDasharray="62 38" /><circle cx="21" cy="21" r="15.9" fill="none" stroke="rgb(var(--warn))" strokeWidth="6" strokeDasharray="28 72" strokeDashoffset="-62" /></svg>
        <div className="space-y-2 text-xs"><div>Buy 00</div><div>Hold 00</div><div>Sell 00</div></div>
      </div>
      <div className="space-y-3 rounded-lg border border-border p-4">
        <div className="text-xs text-muted">12-month price target</div>
        <div className="font-mono text-2xl">$000.00</div>
        <div className="relative h-2 rounded-full bg-gradient-to-r from-down/40 via-muted/30 to-up/40"><span className="absolute left-[60%] top-1/2 h-4 w-1 -translate-y-1/2 rounded bg-text" /></div>
        <div className="flex justify-between font-mono text-[11px] text-muted"><span>Low</span><span>Mean</span><span>High</span></div>
      </div>
      <div className="space-y-2 rounded-lg border border-border p-4">
        <div className="text-xs text-muted">Recent analyst actions</div>
        {['Sample Securities', 'Example Capital', 'Placeholder & Co', 'Demo Partners'].map((f) => (
          <div key={f} className="flex items-center justify-between text-xs"><span>{f}</span><span className="rounded bg-up/15 px-1.5 text-up">Buy</span></div>
        ))}
      </div>
      <div className="space-y-2 rounded-lg border border-border p-4 md:col-span-3">
        <div className="text-xs text-muted">Consensus estimates</div>
        {[0, 1, 2].map((i) => <div key={i} className="grid grid-cols-5 gap-3">{[0, 1, 2, 3, 4].map((j) => <span key={j}>{bar(`${50 + ((i + j) % 4) * 12}%`)}</span>)}</div>)}
      </div>
    </div>
  );
}

export function FinancialsSample() {
  const rows = ['Revenue', 'Gross profit', 'Operating income', 'Net income', 'EBITDA', 'Diluted EPS', 'Free cash flow', 'Total assets', 'Total debt'];
  return (
    <div className="p-4">
      <div className="mb-3 flex gap-2">{['Income', 'Balance sheet', 'Cash flow'].map((t, i) => <span key={t} className={`rounded px-2 py-1 text-xs ${i === 0 ? 'bg-border' : 'text-muted'}`}>{t}</span>)}</div>
      <table className="w-full text-xs">
        <thead><tr className="text-muted"><th className="py-1.5 text-left font-medium">Metric</th>{['FY-4', 'FY-3', 'FY-2', 'FY-1', 'FY'].map((y) => <th key={y} className="py-1.5 text-right font-medium">{y}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={r} className="border-t border-border"><td className="py-1.5">{r}</td>{[0, 1, 2, 3, 4].map((j) => <td key={j} className="py-1.5 text-right font-mono">00.0B</td>)}{i < 0 && null}</tr>)}</tbody>
      </table>
    </div>
  );
}

export function OwnershipSample() {
  return (
    <div className="grid gap-4 p-4 md:grid-cols-2">
      {['Insider transactions (Form 4)', 'Top institutional holders (13F)'].map((t) => (
        <div key={t} className="space-y-2 rounded-lg border border-border p-4">
          <div className="text-xs text-muted">{t}</div>
          {['Sample Holder A', 'Sample Holder B', 'Sample Holder C', 'Sample Holder D', 'Sample Holder E', 'Sample Holder F'].map((n, i) => (
            <div key={n} className="flex items-center justify-between gap-3 text-xs"><span>{n}</span><span className="flex-1">{bar(`${80 - i * 10}%`, 'bg-info/25')}</span><span className="font-mono">0.0%</span></div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function HoldingsSample() {
  return (
    <div className="grid gap-4 p-4 xl:grid-cols-3">
      <div className="space-y-2 rounded-lg border border-border p-4 xl:col-span-2">
        <div className="text-xs text-muted">Top 10 holdings</div>
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 text-xs"><span className="w-12 font-mono">TICK{i}</span><span>Sample Company {i + 1}</span><span className="flex-1">{bar(`${90 - i * 7}%`, 'bg-accent/25')}</span><span className="font-mono">0.0%</span></div>
        ))}
      </div>
      <div className="space-y-2 rounded-lg border border-border p-4">
        <div className="text-xs text-muted">Sector weights &amp; contribution</div>
        {['Sector A', 'Sector B', 'Sector C', 'Sector D', 'Sector E', 'Sector F'].map((s, i) => <div key={s} className="flex items-center gap-2 text-xs"><span className="w-16">{s}</span><span className="flex-1">{bar(`${85 - i * 12}%`, 'bg-info/25')}</span></div>)}
      </div>
    </div>
  );
}

/** Sample indicator sub-pane strip (MACD / RSI shapes) for the chart's locked advanced area. */
export function IndicatorSample() {
  return (
    <div className="space-y-2 p-2">
      <svg viewBox="0 0 400 60" className="h-14 w-full" preserveAspectRatio="none">
        {Array.from({ length: 40 }).map((_, i) => { const h = Math.round(Math.sin(i / 4) * 20); return <rect key={i} x={i * 10 + 1} y={h >= 0 ? 30 - h : 30} width="7" height={Math.abs(h) || 1} fill={h >= 0 ? 'rgb(var(--up) / .5)' : 'rgb(var(--down) / .5)'} />; })}
        <path d="M0 32 C 60 10, 120 50, 200 26 S 320 12, 400 30" stroke="rgb(var(--info))" strokeWidth="1.5" fill="none" />
      </svg>
      <svg viewBox="0 0 400 40" className="h-10 w-full" preserveAspectRatio="none">
        <line x1="0" x2="400" y1="10" y2="10" stroke="rgb(var(--down) / .4)" strokeDasharray="4 4" /><line x1="0" x2="400" y1="30" y2="30" stroke="rgb(var(--up) / .4)" strokeDasharray="4 4" />
        <path d="M0 22 C 40 8, 90 34, 140 18 S 260 30, 320 12 S 380 24, 400 20" stroke="rgb(var(--accent))" strokeWidth="1.5" fill="none" />
      </svg>
    </div>
  );
}

/** Sample conversation behind the AI lock. */
export function ChatSample() {
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <div className="ml-auto w-fit max-w-[70%] rounded-lg bg-info/15 px-3 py-2 text-sm">How did Sample Co&apos;s margins trend over the last five years?</div>
      <div className="max-w-[85%] space-y-2 rounded-lg border border-border bg-panel-2 p-4 text-sm">
        <p>Gross margin expanded from 00% to 00% while operating margin rose 0 points, driven by mix shift <span className="text-info">[1]</span>.</p>
        <div className="space-y-1.5">{bar('92%')}{bar('78%')}{bar('84%')}</div>
        <div className="flex gap-2 pt-1">{['10-K FY-1', '10-K FY', 'Q3 call'].map((s) => <span key={s} className="rounded border border-border px-1.5 py-0.5 text-[11px] text-info">{s}</span>)}</div>
      </div>
      <div className="ml-auto w-fit max-w-[70%] rounded-lg bg-info/15 px-3 py-2 text-sm">Compare against peers on EV/EBITDA.</div>
      <div className="max-w-[85%] space-y-1.5 rounded-lg border border-border bg-panel-2 p-4">{bar('70%')}{bar('88%')}{bar('64%')}</div>
    </div>
  );
}
