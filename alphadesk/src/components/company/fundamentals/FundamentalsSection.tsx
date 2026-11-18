import 'server-only';
import { loadFundamentals } from '@/lib/fundamentals/load';
import { SectionCard } from '@/components/company/SectionCard';
import { FundamentalsPanel } from './FundamentalsPanel';

/**
 * Async server section "Fundamental values" (id `fundamentals`): Graham intrinsic value, 3-year DCF, PEG, P/B, D/E.
 * Wrap in <Suspense fallback={<FundamentalsSkeleton/>}>. Gating is the caller's job (see the API route's GATE note).
 */
export async function FundamentalsSection({ ticker }: { ticker: string }) {
  const model = await loadFundamentals(ticker);
  return (
    <SectionCard
      id="fundamentals"
      title="Fundamental values"
      description="Intrinsic value (Graham), 3-year DCF, PEG, price-to-book and debt-to-equity — every figure links to its filing or formula."
      isMock={model.isMock}
      providers={model.providers}
    >
      <FundamentalsPanel model={model} />
    </SectionCard>
  );
}
