import type { Metadata } from 'next';
import { Logo } from '@/components/shell/Logo';
import { PageSkeleton } from '@/components/ui/skeleton';

export const metadata: Metadata = { title: 'Shared item' };

/** Public/org share view (owner: agent E). Lives outside (app) so link-visibility shares work signed out. */
export default function Page() {
  return (
    <div className="mx-auto max-w-4xl p-6">
      <Logo className="mb-6" />
      <h1 className="mb-4 text-xl font-semibold">Shared item</h1>
      <PageSkeleton />
    </div>
  );
}
