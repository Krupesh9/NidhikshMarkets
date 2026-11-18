import { FlaskConical } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Small banner for screens whose data is simulated. Server- or client-safe.
 *   <MockBanner isMock={meta.isMock} />            // renders nothing when false
 *   <MockBanner isMock provider={meta.provider} />
 */
export function MockBanner({ isMock = true, provider, className, children }: { isMock?: boolean; provider?: string; className?: string; children?: React.ReactNode }) {
  if (!isMock) return null;
  return (
    <div role="note" className={cn('flex items-center gap-2 rounded-md border border-warn/30 bg-warn/10 px-3 py-1.5 text-xs text-warn', className)}>
      <FlaskConical className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>
        {children ?? (
          <>
            <strong className="font-semibold">Demo data.</strong> Some figures on this screen are simulated{provider && provider !== 'Mock' ? ` (mixed with ${provider})` : ''}. Connect an Alpaca or Massive (Polygon) key for live prices. Research only — not investment advice.
          </>
        )}
      </span>
    </div>
  );
}
