import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { providerFlags } from '@/lib/data/providers-status';
import { fmpUsage } from '@/lib/data/fmp';
import { usageHealth } from '@/lib/usage-meter';
import pkg from '../../../../package.json';

export const dynamic = 'force-dynamic';

/**
 * GET /api/health — unauthenticated liveness/readiness probe. Booleans and counters only; never secrets.
 * { ok, version, commit, db, providers: { alpaca: true, …, mockData: false }, fmpCallsToday,
 *   apiUsage: { fmp: { usedToday, usedThisMinute, limit: '250 / day', status }, … }, time }
 */
export async function GET() {
  let dbOk = false;
  try {
    await db.$queryRawUnsafe('SELECT 1');
    dbOk = true;
  } catch { dbOk = false; }
  let fmpCallsToday: number | null = null;
  try { fmpCallsToday = fmpUsage().calls; } catch { fmpCallsToday = null; }
  let apiUsage: ReturnType<typeof usageHealth> | null = null;
  try { apiUsage = usageHealth(); } catch { apiUsage = null; }
  const body = {
    ok: dbOk,
    version: pkg.version,
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? null,
    db: dbOk,
    providers: providerFlags(),
    fmpCallsToday,
    apiUsage,
    time: new Date().toISOString(),
  };
  return NextResponse.json(body, { status: dbOk ? 200 : 503, headers: { 'cache-control': 'no-store' } });
}
