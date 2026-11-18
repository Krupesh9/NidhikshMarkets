import type { Metadata } from 'next';
import { PlaceholderPage } from '@/components/shell/PlaceholderPage';

export const metadata: Metadata = { title: 'Shared' };

export default function Page() {
  return <PlaceholderPage title="Shared" description="Notes, screens and portfolios shared across your team." owner="E" />;
}
