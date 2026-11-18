import { withApi } from '@/lib/http';
import { researchRepo } from '@/lib/repos';

export const dynamic = 'force-dynamic';

/** GET /api/ai/threads → { threads: ChatThreadDTO[] } (current user's research threads, newest first) */
export const GET = withApi(async ({ user }) => {
  const threads = await researchRepo.listThreads({ orgId: user.orgId, userId: user.id }, 100);
  return { threads };
});
