import type { Metadata } from 'next';
import { PlaceholderPage } from '@/components/shell/PlaceholderPage';

export const metadata: Metadata = { title: 'Dashboard' };

export default function Page() {
  return <PlaceholderPage title="Dashboard" description="Market pulse, your watchlist, catalysts and team activity." owner="E" />;
}
