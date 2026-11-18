'use client';
import * as React from 'react';
import { Lock } from 'lucide-react';
import { FEATURE_LABEL, PLAN_INFO, type Feature } from '@/lib/plans';
import { cn } from '@/lib/utils';
import { useUpgrade } from './UpgradeDialog';

/**
 * Glass-blur lock over a STATIC sample of a premium section. The sample is fixed placeholder content defined in
 * `LockedSamples.tsx` — never the user's real data, which the server does not fetch or serialize for Free users.
 * The sample is aria-hidden + inert; screen readers hear "Locked — Pro feature".
 */
export function LockedOverlay({ feature, title, includes, sample, className, minHeight = 260 }: {
  feature: Feature; title?: string; includes: string; sample: React.ReactNode; className?: string; minHeight?: number;
}) {
  const { openUpgrade } = useUpgrade();
  const heading = title ?? `${FEATURE_LABEL[feature]} is a Pro feature`;
  const inertRef = React.useCallback((el: HTMLDivElement | null) => { if (el) el.setAttribute('inert', ''); }, []);
  return (
    <div className={cn('relative isolate overflow-hidden rounded-lg', className)} style={{ minHeight }} data-locked-feature={feature}>
      <div ref={inertRef} aria-hidden className="pointer-events-none select-none p-1 opacity-90">{sample}</div>
      <div
        role="group" aria-label={`Locked — Pro feature: ${FEATURE_LABEL[feature]}`}
        onClick={() => openUpgrade(feature)}
        className="nd-glass absolute inset-0 flex cursor-pointer items-center justify-center p-4"
      >
        <div className="flex max-w-md flex-col items-center gap-2.5 rounded-xl border border-white/10 bg-panel/70 px-6 py-5 text-center shadow-2xl">
          <span className="flex h-10 w-10 items-center justify-center rounded-full border border-accent/40 bg-accent/15 text-accent"><Lock className="h-4 w-4" aria-hidden /></span>
          <h3 className="text-[15px] font-semibold tracking-tight text-text">{heading}</h3>
          <p className="text-xs leading-relaxed text-text/80">{includes}</p>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); openUpgrade(feature); }}
            className="mt-1 inline-flex h-9 items-center gap-2 rounded-md bg-accent px-4 text-sm font-semibold text-accent-foreground shadow hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info focus-visible:ring-offset-2 focus-visible:ring-offset-panel"
          >
            <Lock className="h-3.5 w-3.5" aria-hidden /> Unlock with {PLAN_INFO.PRO_PLUS.priceLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
