import type { Metadata } from 'next';
import { PlaceholderPage } from '@/components/shell/PlaceholderPage';

export const metadata: Metadata = { title: 'Research thread' };

export default function Page() {
  return <PlaceholderPage title="Research thread" description="Conversation with cited sources." owner="B" />;
}
