'use client';
import * as React from 'react';
import { Building2, UserRound } from 'lucide-react';
import type { InsiderTxn, InstitutionalHolding, SourceRef } from '@/lib/data/types';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { cn, fmt } from '@/lib/utils';
import { MetricButton } from './MetricButton';

const TYPE_TONE: Record<InsiderTxn['type'], string> = {
  Buy: 'border-up/40 bg-up/10 text-up', Sell: 'border-down/40 bg-down/10 text-down', 'Option Exercise': 'border-info/40 bg-info/10 text-info', Gift: 'border-border text-muted',
};

function insiderSource(t: InsiderTxn, isMock: boolean): SourceRef {
  return {
    id: t.id, name: `Form 4 — ${t.insider}, ${t.date}${isMock ? ' (simulated)' : ''}`, url: t.filingUrl, kind: isMock ? 'mock' : 'ownership', locator: 'Form 4, Table I',
    excerpt: `${t.insider} (${t.title}) reported a ${t.type.toLowerCase()} of ${t.shares.toLocaleString('en-US')} shares at $${t.price.toFixed(2)} (~$${Math.round(t.value).toLocaleString('en-US')}) on ${t.date}; ${t.sharesOwnedAfter.toLocaleString('en-US')} shares owned after.`,
  };
}

function holderSource(h: InstitutionalHolding, base: SourceRef | null, isMock: boolean): SourceRef {
  return {
    id: `${base?.id ?? '13f'}:${h.holder}`, name: `13F-HR — ${h.holder}, period ${h.reportDate}${isMock ? ' (simulated)' : ''}`, url: base?.url, kind: isMock ? 'mock' : 'ownership', locator: 'Form 13F information table',
    excerpt: `${h.holder} reported ${h.shares.toLocaleString('en-US')} shares (${h.pctOfShares.toFixed(2)}% of outstanding, ~${fmt.money(h.value)}) as of ${h.reportDate}, a change of ${h.changeShares >= 0 ? '+' : ''}${h.changeShares.toLocaleString('en-US')} shares (${h.changePct >= 0 ? '+' : ''}${h.changePct.toFixed(2)}%) vs the prior quarter.`,
  };
}

export function OwnershipPanel({ ticker, insiders, institutional, instSource, insiderMock, instMock }: {
  ticker: string; insiders: InsiderTxn[]; institutional: InstitutionalHolding[]; instSource: SourceRef | null; insiderMock: boolean; instMock: boolean;
}) {
  const [onlyBuys, setOnlyBuys] = React.useState(false);
  const list = onlyBuys ? insiders.filter((t) => t.type === 'Buy') : insiders;
  const net90 = React.useMemo(() => {
    const cutoff = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
    return insiders.filter((t) => t.date >= cutoff).reduce((s, t) => s + (t.type === 'Buy' ? t.value : t.type === 'Sell' ? -t.value : 0), 0);
  }, [insiders]);
  const maxChg = Math.max(1, ...institutional.map((h) => Math.abs(h.changePct)));
  const top = institutional.slice(0, 10);

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-semibold">Insider transactions <span className="font-normal text-muted">(Form 4)</span></h3>
          <div className="flex items-center gap-3 text-xs">
            <span className="text-muted">Net 90d <span className={cn('font-mono tabular-nums', net90 >= 0 ? 'text-up' : 'text-down')}>{fmt.money(net90)}</span></span>
            <label className="inline-flex items-center gap-1 text-muted">
              <input type="checkbox" checked={onlyBuys} onChange={(e) => setOnlyBuys(e.target.checked)} className="accent-[rgb(var(--accent))]" /> Buys only
            </label>
          </div>
        </div>
        {list.length === 0 ? (
          <EmptyState icon={UserRound} title={onlyBuys ? 'No insider buys' : 'No insider transactions'} description={onlyBuys ? 'No open-market purchases reported recently. Clear the filter to see sales and exercises.' : `No Form 4 activity returned for ${ticker}.`} />
        ) : (
          <div className="max-h-[360px] overflow-auto rounded-md border border-border scrollbar-thin">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-panel-2 text-muted">
                <tr>
                  <th scope="col" className="px-2 py-1.5 text-left font-medium">Date</th>
                  <th scope="col" className="px-2 py-1.5 text-left font-medium">Insider</th>
                  <th scope="col" className="px-2 py-1.5 text-left font-medium">Type</th>
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">Shares</th>
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">Price</th>
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">Value</th>
                </tr>
              </thead>
              <tbody>
                {list.map((t) => {
                  const s = insiderSource(t, insiderMock);
                  return (
                    <tr key={t.id} className="border-t border-border hover:bg-panel-2/60">
                      <td className="whitespace-nowrap px-2 py-1.5 font-mono tabular-nums text-muted">{t.date}</td>
                      <td className="px-2 py-1.5">
                        <MetricButton source={s} label={`${t.insider} transaction`}><span className="font-medium">{t.insider}</span></MetricButton>
                        <div className="text-[10px] text-muted">{t.title}</div>
                      </td>
                      <td className="px-2 py-1.5"><Badge variant="outline" className={cn('text-[10px]', TYPE_TONE[t.type])}>{t.type}</Badge></td>
                      <td className="px-2 py-1.5 text-right font-mono tabular-nums">{fmt.num(t.shares)}</td>
                      <td className="px-2 py-1.5 text-right font-mono tabular-nums">{fmt.price(t.price)}</td>
                      <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                        <MetricButton source={s} highlight={t.shares.toLocaleString('en-US')}>{fmt.money(t.value)}</MetricButton>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-semibold">Top institutional holders <span className="font-normal text-muted">(13F)</span></h3>
          {top[0] && <span className="text-[11px] text-muted">as of {fmt.date(top[0].reportDate)}</span>}
        </div>
        {top.length === 0 ? (
          <EmptyState icon={Building2} title="No 13F holders" description={`No institutional ownership data returned for ${ticker}. 13F coverage excludes non-US listings and very recent IPOs.`} />
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-xs">
              <thead className="bg-panel-2 text-muted">
                <tr>
                  <th scope="col" className="px-2 py-1.5 text-left font-medium">Holder</th>
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">% out</th>
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">Value</th>
                  <th scope="col" className="w-[38%] px-2 py-1.5 text-center font-medium">QoQ change</th>
                </tr>
              </thead>
              <tbody>
                {top.map((h) => {
                  const s = holderSource(h, instSource, instMock);
                  const w = (Math.abs(h.changePct) / maxChg) * 50;
                  return (
                    <tr key={h.holder} className="border-t border-border hover:bg-panel-2/60">
                      <td className="px-2 py-1.5"><MetricButton source={s} label={`${h.holder} holding`} className="font-medium">{h.holder}</MetricButton></td>
                      <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                        <MetricButton source={s} highlight={`${h.pctOfShares.toFixed(2)}%`}>{h.pctOfShares.toFixed(2)}%</MetricButton>
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono tabular-nums">{fmt.money(h.value)}</td>
                      <td className="px-2 py-1.5">
                        <div className="flex items-center gap-2">
                          <div className="relative h-2.5 flex-1 rounded-sm bg-panel-2" role="img" aria-label={`${h.changePct >= 0 ? 'Increased' : 'Decreased'} ${Math.abs(h.changePct).toFixed(2)} percent`}>
                            <span className="absolute inset-y-0 left-1/2 w-px bg-border" aria-hidden />
                            <span className={cn('absolute inset-y-0 rounded-sm', h.changePct >= 0 ? 'left-1/2 bg-up/80' : 'right-1/2 bg-down/80')} style={{ width: `${w}%` }} aria-hidden />
                          </div>
                          <span className={cn('w-14 text-right font-mono tabular-nums', h.changePct >= 0 ? 'text-up' : 'text-down')}>{fmt.pct(h.changePct, 1)}</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
