import type { Metadata } from 'next';
import { PageHeader } from '@/components/shell/PageHeader';
import { ResearchWorkspace } from '@/components/ai/ResearchWorkspace';
import { ResearchLocked } from '@/components/billing/ResearchLocked';
import { requireSessionUser } from '@/lib/auth';
import { hasFeature } from '@/lib/plans';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Research' };

export default async function Page() {
  // Plan from the DB on every request; Free users never get the workspace (which would fetch threads).
  const canAi = hasFeature(await requireSessionUser(), 'ai');
  return (
    <>
      <PageHeader title="Research" description="Ask questions across filings, transcripts, estimates and news — every number cited. Research only — not investment advice." />
      {canAi ? <ResearchWorkspace /> : <ResearchLocked />}
    </>
  );
}
