import type { Metadata } from 'next';
import { PageHeader } from '@/components/shell/PageHeader';
import { ResearchWorkspace } from '@/components/ai/ResearchWorkspace';
import { ResearchLocked } from '@/components/billing/ResearchLocked';
import { requireSessionUser } from '@/lib/auth';
import { hasFeature } from '@/lib/plans';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Research thread' };

export default async function Page({ params }: { params: { threadId: string } }) {
  // Plan from the DB on every request; Free users never get the workspace (which would fetch threads).
  const canAi = hasFeature(await requireSessionUser(), 'ai');
  return (
    <>
      <PageHeader title="Research" description="Conversation with cited sources. Research only — not investment advice." />
      {canAi ? <ResearchWorkspace threadId={params.threadId} /> : <ResearchLocked />}
    </>
  );
}
