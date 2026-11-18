/**
 * Production database URL for Pulse (shared by the Vercel build script and the Prisma client).
 * - SQLite URLs (local dev) are returned unchanged.
 * - Postgres URLs (Neon, Supabase, …) are pinned to their own schema (default "pulse", override with PULSE_DB_SCHEMA)
 *   so Pulse never creates, changes or drops tables that belong to another app in the same database.
 * - Supabase's transaction pooler (port 6543) gets pgbouncer=true, which Prisma needs there.
 */
export function pulseDbUrl(raw, { pooled = true } = {}) {
  if (!raw || !/^postgres(ql)?:\/\//.test(raw)) return raw;
  const u = new URL(raw);
  if (!u.searchParams.get('schema')) u.searchParams.set('schema', process.env.PULSE_DB_SCHEMA || 'pulse');
  if (pooled && (u.port === '6543' || u.hostname.includes('pooler.supabase.com')) && u.port !== '5432' && !u.searchParams.has('pgbouncer')) {
    u.searchParams.set('pgbouncer', 'true');
  }
  return u.toString();
}

/** Direct (non-pooled) URL for schema changes: Supabase DIRECT_URL, Neon DATABASE_URL_UNPOOLED, or Vercel Postgres. */
export function pulseDirectUrl() {
  const raw = process.env.DIRECT_URL || process.env.DATABASE_URL_UNPOOLED || process.env.POSTGRES_URL_NON_POOLING;
  return raw ? pulseDbUrl(raw, { pooled: false }) : undefined;
}
