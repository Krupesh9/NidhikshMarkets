import type { Metadata } from 'next';
import { PlaceholderPage } from '@/components/shell/PlaceholderPage';

export const metadata: Metadata = { title: 'Baskets' };

export default function Page() {
  return <PlaceholderPage title="Baskets" description="Thematic baskets with target weights." owner="D" />;
}
