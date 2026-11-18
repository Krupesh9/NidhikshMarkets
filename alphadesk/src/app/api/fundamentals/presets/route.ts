import { requireFeature, withApi } from '@/lib/http';
import { listPresets } from '@/lib/fundamentals/presets.server';

export const dynamic = 'force-dynamic';

/** GET → { presets } — your saved assumptions across tickers (most recent first). */
export const GET = withApi(async ({ user }) => {
  requireFeature(user, 'financials');
  return { presets: await listPresets(user.id) };
});
