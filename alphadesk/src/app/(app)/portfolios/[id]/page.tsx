import type { Metadata } from 'next';
import { PlaceholderPage } from '@/components/shell/PlaceholderPage';

export const metadata: Metadata = { title: 'Portfolio' };

export default function Page() {
  return <PlaceholderPage title="Portfolio" description="Positions, exposures and performance." owner="D" />;
}
