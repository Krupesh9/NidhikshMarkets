import { z } from 'zod';
import { badRequest, notFound, upgradeRequired, withApi } from '@/lib/http';
import { assertFeature } from '@/lib/plans';
import { screenRepo } from '@/lib/repos';
import { fromSavedScreen, parseFilters, parseSort } from '@/lib/screener/engine';
import { exportColumns, toCsv, toXlsx } from '@/lib/screener/export';
import { runScreenForPlan } from '@/lib/screener/service';

export const dynamic = 'force-dynamic';

function parseJsonParam(s: string | undefined): unknown {
  if (!s) return undefined;
  try { return JSON.parse(s); } catch { throw badRequest('filters/sort must be JSON'); }
}

/**
 * GET ?format=csv|xlsx&screen=<savedScreenId>  — or ad-hoc: &filters=<json>&sort=<json>&columns=a,b,c
 * Pro and Pro Plus only (402 upgrade_required on Free).
 */
export const GET = withApi(
  async ({ user, query }) => {
    const gate = assertFeature(user, 'export');
    if (!gate.allowed) throw upgradeRequired(gate.reason ?? 'Export requires an upgrade', gate.upgradeTo);

    let title = 'Ad-hoc screen';
    let def = { filters: parseFilters(parseJsonParam(query.filters)), sort: parseSort(parseJsonParam(query.sort)), columns: query.columns ? query.columns.split(',').filter(Boolean) : [] };
    if (query.screen) {
      const s = await screenRepo.get({ orgId: user.orgId, userId: user.id }, query.screen);
      if (!s) throw notFound('Saved screen not found');
      title = s.name;
      def = { ...fromSavedScreen(s), columns: query.columns ? def.columns : (s.columns ?? []) };
    }
    const res = await runScreenForPlan(user.plan, def.filters, def.sort);
    const cols = exportColumns(def.columns);
    const stamp = new Date().toISOString().slice(0, 10);
    const base = `${title.replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'screen'}-${stamp}`;
    if (query.format === 'csv') {
      return new Response(toCsv(res.rows, cols), {
        headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${base}.csv"`, 'cache-control': 'no-store' },
      });
    }
    const buf = await toXlsx(res.rows, cols, { title, filters: res.applied, meta: res.meta });
    return new Response(new Uint8Array(buf), {
      headers: {
        'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'content-disposition': `attachment; filename="${base}.xlsx"`,
        'cache-control': 'no-store',
      },
    });
  },
  {
    query: z.object({
      format: z.enum(['csv', 'xlsx']).default('csv'),
      screen: z.string().max(64).optional(),
      filters: z.string().max(4000).optional(),
      sort: z.string().max(500).optional(),
      columns: z.string().max(500).optional(),
    }),
    audit: 'screen.export',
  },
);
