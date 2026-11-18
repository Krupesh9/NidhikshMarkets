import { withApi } from '@/lib/http';
import { getUsageSnapshot } from '@/lib/usage-meter';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/usage → UsageSnapshot — ADMIN only. Outbound API calls per external provider against its
 * published limit (used today / this minute, status, reset time, last error path + status). Numbers only, no secrets.
 */
export const GET = withApi(async () => getUsageSnapshot(), { roles: ['ADMIN'] });
