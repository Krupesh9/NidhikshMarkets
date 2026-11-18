import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireSessionUser } from '@/lib/auth';
import { portfolioRepo } from '@/lib/repos';
import { BasketDetail } from '@/components/portfolio/BasketDetail';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const u = await requireSessionUser();
  const b = await portfolioRepo.getBasket({ orgId: u.orgId, userId: u.id }, params.id);
  return { title: b?.name ?? 'Basket' };
}

export default async function Page({ params }: { params: { id: string } }) {
  const u = await requireSessionUser();
  const b = await portfolioRepo.getBasket({ orgId: u.orgId, userId: u.id }, params.id);
  if (!b) notFound();
  return <BasketDetail initial={JSON.parse(JSON.stringify(b))} />;
}
