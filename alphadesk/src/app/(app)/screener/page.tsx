import type { Metadata } from 'next';
import { PlaceholderPage } from '@/components/shell/PlaceholderPage';

export const metadata: Metadata = { title: 'Screener' };

export default function Page() {
  return <PlaceholderPage title="Screener" description="Filter the universe on fundamentals, revisions, ownership and catalysts." owner="C" />;
}
