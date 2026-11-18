import type { Metadata } from 'next';
import { PlaceholderPage } from '@/components/shell/PlaceholderPage';

export const metadata: Metadata = { title: 'Portfolios' };

export default function Page() {
  return <PlaceholderPage title="Portfolios" description="Exposure, risk and attribution across your books." owner="D" />;
}
