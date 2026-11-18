import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireSessionUser } from '@/lib/auth';
import { portfolioRepo } from '@/lib/repos';
import { PortfolioDashboard } from '@/components/portfolio/PortfolioDashboard';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const u = await requireSessionUser();
  const p = await portfolioRepo.get({ orgId: u.orgId, userId: u.id }, params.id);
  return { title: p?.name ?? 'Portfolio' };
}

export default async function Page({ params }: { params: { id: string } }) {
  const u = await requireSessionUser();
  const p = await portfolioRepo.get({ orgId: u.orgId, userId: u.id }, params.id);
  if (!p) notFound();
  return <PortfolioDashboard portfolio={{ id: p.id, name: p.name, description: p.description, benchmark: p.benchmark, tickers: p.positions.map((x) => x.ticker) }} />;
}
