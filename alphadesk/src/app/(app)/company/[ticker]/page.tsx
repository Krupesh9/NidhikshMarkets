import type { Metadata } from 'next';
import { PlaceholderPage } from '@/components/shell/PlaceholderPage';

export function generateMetadata({ params }: { params: { ticker: string } }): Metadata {
  return { title: params.ticker.toUpperCase() };
}

export default function Page({ params }: { params: { ticker: string } }) {
  return <PlaceholderPage title={params.ticker.toUpperCase()} description="Overview, financials, estimates, ownership, filings and news." owner="A" />;
}
