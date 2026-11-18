import 'server-only';
import { loadFundamentals } from '@/lib/fundamentals/load';
import { getValuationDefaults } from '@/lib/fundamentals/settings.server';
import { getPreset, getUserRequiredMos } from '@/lib/fundamentals/presets.server';
import type { SavedPreset } from '@/lib/fundamentals/defaults';
import { log } from '@/lib/log';
import { SectionCard } from '@/components/company/SectionCard';
import { FundamentalsPanel } from './FundamentalsPanel';

/**
 * Async server section "Fundamental values" (id `fundamentals`): Graham intrinsic value, 3-year DCF, PEG, P/B, D/E.
 * Uses the org owner's valuation defaults, then the user's saved assumptions for this ticker (if any).
 * Wrap in <Suspense fallback={<FundamentalsSkeleton/>}>. Gating is the caller's job (see the API route's GATE note).
 */
export async function FundamentalsSection({ ticker, user }: { ticker: string; user: { id: string; orgId: string } }) {
  const defaults = await getValuationDefaults(user.orgId);
  const [model, preset, mine] = await Promise.all([
    loadFundamentals(ticker, undefined, defaults),
    getPreset(user.id, ticker.toUpperCase()).catch((err: Error): SavedPreset | null => { log.warn('fundamentals.preset_read_failed', { err: err.message }); return null; }),
    getUserRequiredMos(user.id).catch(() => ({ requiredMos: null, updatedAt: null })),
  ]);
  return (
    <SectionCard
      id="fundamentals"
      title="Fundamental values"
      description="Intrinsic value (Graham), 3-year DCF, PEG, price-to-book and debt-to-equity — every figure links to its filing or formula."
      isMock={model.isMock}
      providers={model.providers}
    >
      <FundamentalsPanel model={model} preset={preset} userRequiredMos={mine.requiredMos} />
    </SectionCard>
  );
}
