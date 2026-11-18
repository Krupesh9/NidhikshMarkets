import type { Metadata } from 'next';
import { PageHeader } from '@/components/shell/PageHeader';
import { ResearchWorkspace } from '@/components/ai/ResearchWorkspace';

export const metadata: Metadata = { title: 'Research thread' };

export default function Page({ params }: { params: { threadId: string } }) {
  return (
    <>
      <PageHeader title="Research" description="Conversation with cited sources. Research only — not investment advice." />
      <ResearchWorkspace threadId={params.threadId} />
    </>
  );
}
