import { Delta } from '@/components/ui/delta';
import { fmt } from '@/lib/utils';
import type { CoreData } from './server/data';
import { rangePosition } from './lib/helpers';
import { MetricButton } from './MetricButton';
import { HeaderActions } from './HeaderActions';
import { CompanyLogo } from '@/components/ui/company-logo';

function KeyStat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-[92px]">
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-0.5 font-mono text-sm font-semibold tabular-nums">{children}</div>
    </div>
  );
}

/** Deep-dive header: monogram, identity, price + change, key multiples, 52-week range, actions. */
export function CompanyHeader({ core, canShare }: { core: CoreData; canShare: boolean }) {
  const { profile, quote, ticker, sources, valuation, forward, week52 } = core;
  const name = profile?.name ?? ticker;
  const pos = quote && week52.high && week52.low ? rangePosition(quote.price, week52.low, week52.high) : null;
  return (
    <header className="rounded-lg border border-border bg-panel p-4" aria-label={`${ticker} overview`}>
      <div className="flex flex-wrap items-start gap-4">
        <CompanyLogo ticker={ticker} size={52} className="rounded-xl" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <h1 className="font-mono text-xl font-bold tracking-tight">{ticker}</h1>
            <MetricButton source={sources.profile} className="truncate text-base font-medium text-text">{name}</MetricButton>
          </div>
          <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted">
            {profile?.sector && <span>{profile.sector}</span>}
            {profile?.industry && <><span aria-hidden>·</span><span>{profile.industry}</span></>}
            {profile?.exchange && <><span aria-hidden>·</span><span className="font-mono">{profile.exchange}</span></>}
            {profile?.hq && <><span aria-hidden>·</span><span>{profile.hq}</span></>}
          </div>
        </div>
        <HeaderActions ticker={ticker} name={name} canShare={canShare} />
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-x-8 gap-y-4">
        <div>
          {quote ? (
            <MetricButton source={sources.price} highlight={quote.price.toFixed(2)} label={`${ticker} price`} className="block">
              <span className="font-mono text-3xl font-semibold tabular-nums">${fmt.price(quote.price)}</span>
            </MetricButton>
          ) : (
            <span className="font-mono text-3xl text-muted">—</span>
          )}
          {quote && (
            <div className="mt-0.5 flex items-center gap-2 text-sm">
              <Delta value={quote.change} suffix="" dp={2} />
              <Delta value={quote.changePct} showArrow={false} />
              <span className="text-xs text-muted">as of {fmt.date(quote.ts)}</span>
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-3">
          <KeyStat label="Market cap">
            <MetricButton source={sources.marketCap} label="Market cap">{fmt.money(core.marketCap)}</MetricButton>
          </KeyStat>
          <KeyStat label="P/E (TTM)">
            <MetricButton source={sources.pe} highlight={valuation.pe ? `${valuation.pe.toFixed(1)}x` : undefined} label="P/E">{fmt.multiple(valuation.pe)}</MetricButton>
          </KeyStat>
          <KeyStat label="Fwd EPS">
            <MetricButton source={sources.fwdEps} highlight={forward.eps != null ? `$${forward.eps.toFixed(2)}` : undefined} label="Forward EPS">{forward.eps != null ? `$${forward.eps.toFixed(2)}` : '—'}</MetricButton>
          </KeyStat>
          <KeyStat label="Fwd P/E">
            <MetricButton source={sources.fwdPe} highlight={forward.pe ? `${forward.pe.toFixed(1)}x` : undefined} label="Forward P/E">{fmt.multiple(forward.pe)}</MetricButton>
          </KeyStat>
          <KeyStat label="EV/EBITDA">
            <MetricButton source={sources.evEbitda} highlight={valuation.evEbitda ? `${valuation.evEbitda.toFixed(1)}x` : undefined} label="EV/EBITDA">{fmt.multiple(valuation.evEbitda)}</MetricButton>
          </KeyStat>
          <KeyStat label="Volume">{quote ? fmt.compact(quote.volume) : '—'}</KeyStat>
        </div>
        <div className="min-w-[220px] flex-1 sm:max-w-xs">
          <div className="flex justify-between text-[10px] font-medium uppercase tracking-wide text-muted">
            <span>52-week range</span>
          </div>
          <MetricButton source={sources.range} className="mt-1 block w-full" label="52-week range">
            <div className="relative mt-1 h-1.5 w-full rounded-full bg-gradient-to-r from-down/50 via-muted/30 to-up/50">
              {pos != null && (
                <span className="absolute top-1/2 h-3.5 w-1 -translate-x-1/2 -translate-y-1/2 rounded-sm bg-text shadow" style={{ left: `${pos}%` }} aria-hidden />
              )}
            </div>
            <div className="mt-1 flex justify-between font-mono text-xs tabular-nums text-muted">
              <span>{fmt.price(week52.low)}</span>
              {pos != null && <span className="text-text">{pos.toFixed(0)}% of range</span>}
              <span>{fmt.price(week52.high)}</span>
            </div>
          </MetricButton>
        </div>
      </div>
    </header>
  );
}
