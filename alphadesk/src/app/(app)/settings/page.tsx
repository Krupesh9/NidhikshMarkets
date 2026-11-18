import type { Metadata } from 'next';
import { PlaceholderPage } from '@/components/shell/PlaceholderPage';

export const metadata: Metadata = { title: 'Settings' };

export default function Page() {
  return <PlaceholderPage title="Settings" description="Plan, AI keys, usage and team." owner="E" />;
}
