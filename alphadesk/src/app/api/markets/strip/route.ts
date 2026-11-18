import { withApi } from '@/lib/http';
import { getMarketTiles } from '@/lib/markets/global';

export const dynamic = 'force-dynamic';

/** GET /api/markets/strip → global market tiles for the scrolling ticker (server caches decide freshness). */
export const GET = withApi(async () => {
  const { tiles, asOf } = await getMarketTiles();
  return { asOf, tiles: tiles.map(({ spark, ...t }) => ({ ...t, spark: spark.slice(-20) })) };
});
