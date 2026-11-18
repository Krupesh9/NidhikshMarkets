import type { Metadata } from 'next';
import { PortfolioList } from '@/components/portfolio/PortfolioList';

export const metadata: Metadata = { title: 'Portfolios' };
export const dynamic = 'force-dynamic';

export default function Page() {
  return <PortfolioList />;
}
