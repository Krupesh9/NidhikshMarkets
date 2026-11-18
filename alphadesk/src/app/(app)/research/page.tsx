import type { Metadata } from 'next';
import { PageHeader } from '@/components/shell/PageHeader';
import { ResearchWorkspace } from '@/components/ai/ResearchWorkspace';

export const metadata: Metadata = { title: 'Research' };

export default function Page() {
  return (
    <>
      <PageHeader title="Research" description="Ask questions across filings, transcripts, estimates and news — every number cited. Research only — not investment advice." />
      <ResearchWorkspace />
    </>
  );
}
