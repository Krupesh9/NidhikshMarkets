import { withApi, notFound, requireFeature } from '@/lib/http';
import { researchRepo } from '@/lib/repos';

export const dynamic = 'force-dynamic';

/** GET /api/ai/threads/:id → { thread } with messages (citations, structured blocks, tool steps). */
export const GET = withApi(async ({ user, params }) => {
  requireFeature(user, 'ai');
  const thread = await researchRepo.getThread({ orgId: user.orgId, userId: user.id }, params.id);
  if (!thread || thread.userId !== user.id) throw notFound('Thread not found');
  return { thread };
});

/** DELETE /api/ai/threads/:id */
export const DELETE = withApi(
  async ({ user, params }) => {
    const ok = await researchRepo.removeThread({ orgId: user.orgId, userId: user.id }, params.id);
    if (!ok) throw notFound('Thread not found');
    return { ok: true };
  },
  { rateLimit: 'mutation', audit: 'ai.thread.delete' },
);
