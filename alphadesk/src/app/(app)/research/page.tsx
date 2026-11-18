import type { Metadata } from 'next';
import { PlaceholderPage } from '@/components/shell/PlaceholderPage';

export const metadata: Metadata = { title: 'Research' };

export default function Page() {
  return <PlaceholderPage title="Research" description="Ask questions across filings, transcripts and news — every answer cited." owner="B" />;
}
