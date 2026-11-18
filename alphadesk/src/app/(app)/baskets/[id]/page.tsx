import type { Metadata } from 'next';
import { PlaceholderPage } from '@/components/shell/PlaceholderPage';

export const metadata: Metadata = { title: 'Basket' };

export default function Page() {
  return <PlaceholderPage title="Basket" description="Holdings, weights and thesis." owner="D" />;
}
