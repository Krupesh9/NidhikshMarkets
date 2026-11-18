import { withApi } from '@/lib/http';
import { getMarketData } from '@/lib/data';

export const dynamic = 'force-dynamic';

/** GET /api/market/universe → { data: UniverseItem[], meta } */
export const GET = withApi(async () => getMarketData().getUniverse());
