import type { Metadata } from 'next';
import { BasketList } from '@/components/portfolio/BasketList';

export const metadata: Metadata = { title: 'Baskets' };
export const dynamic = 'force-dynamic';

export default function Page() {
  return <BasketList />;
}
