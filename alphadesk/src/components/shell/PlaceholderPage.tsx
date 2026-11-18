import { PageHeader } from './PageHeader';
import { PageSkeleton } from '@/components/ui/skeleton';

/** Temporary placeholder used until a feature agent replaces the page. */
export function PlaceholderPage({ title, description, owner }: { title: string; description: string; owner: string }) {
  return (
    <div>
      <PageHeader title={title} description={description} />
      <p className="mb-4 text-xs text-muted">This screen is being built (owner: agent {owner}).</p>
      <PageSkeleton />
    </div>
  );
}
