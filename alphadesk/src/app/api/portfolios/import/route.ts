import { z } from 'zod';
import { withApi, badRequest, notFound } from '@/lib/http';
import { portfolioRepo, type Scope } from '@/lib/repos';
import { jobs } from '@/lib/jobs';
import { getMarketData } from '@/lib/data';
import { cache } from '@/lib/cache';
import { mergeCsvRows, parsePositionsCsv, type CsvParseResult, type CsvPositionRow } from '@/lib/analytics/csv';
import { newTickerCount, positionsGate } from '@/lib/analytics/limits';
import { BENCH, clean, enforcePositions } from '../_shared';

export const dynamic = 'force-dynamic';

/** Files with more rows than this are written by a background job. */
const BACKGROUND_ROWS = 250;

interface ImportJob { status: 'queued' | 'running' | 'done' | 'failed'; orgId: string; portfolioId?: string; imported?: number; error?: string; startedAt: number; finishedAt?: number }
const store = (globalThis as unknown as { __ndImportJobs?: Map<string, ImportJob> }).__ndImportJobs ??= new Map<string, ImportJob>();

async function universe() {
  const u = await cache.wrap('an:universe', async () => (await getMarketData().getUniverse()).data, 60 * 60_000);
  return new Map(u.map((x) => [x.ticker.toUpperCase(), x]));
}

async function write(scope: Scope, d: { portfolioId?: string; name?: string; description?: string | null; benchmark?: string; mode: 'replace' | 'append'; rows: CsvPositionRow[] }) {
  const u = await universe();
  const toInput = (r: CsvPositionRow) => ({ ticker: r.ticker, quantity: r.quantity, costBasis: r.costBasis, targetWeight: r.targetWeight, sector: u.get(r.ticker)?.sector ?? null, country: u.get(r.ticker)?.country ?? null });
  if (!d.portfolioId) {
    const p = await portfolioRepo.create(scope, { name: d.name ?? 'Imported portfolio', description: d.description ?? undefined, benchmark: d.benchmark, positions: d.rows.map(toInput) });
    return { portfolioId: p.id, imported: d.rows.length };
  }
  const p = await portfolioRepo.get(scope, d.portfolioId);
  if (!p) throw notFound('Portfolio not found');
  if (d.mode === 'replace') {
    await portfolioRepo.replacePositions(scope, p.id, d.rows.map(toInput));
  } else {
    // append: merge with existing positions by ticker
    const merged = mergeCsvRows([...p.positions.map((x, i) => ({ ticker: x.ticker, quantity: x.quantity, costBasis: x.costBasis, targetWeight: x.targetWeight, line: -i })), ...d.rows]);
    await portfolioRepo.replacePositions(scope, p.id, merged.map(toInput));
  }
  return { portfolioId: p.id, imported: d.rows.length };
}

jobs.register<{ id: string; scope: Scope; args: Parameters<typeof write>[1] }>('portfolio.import', async (job) => {
  const s = store.get(job.data.id);
  if (s) s.status = 'running';
  try {
    const r = await write(job.data.scope, job.data.args);
    store.set(job.data.id, { ...(s ?? { orgId: job.data.scope.orgId, startedAt: Date.now() }), status: 'done', portfolioId: r.portfolioId, imported: r.imported, finishedAt: Date.now() });
  } catch (e) {
    store.set(job.data.id, { ...(s ?? { orgId: job.data.scope.orgId, startedAt: Date.now() }), status: 'failed', error: (e as Error).message, finishedAt: Date.now() });
  }
});

/**
 * POST /api/portfolios/import
 *   { csv, portfolioId? | name?, mode: 'replace'|'append', dryRun?, skipInvalid? }
 * dryRun → { preview, errors, warnings, gate } with no writes. Commit with errors requires skipInvalid=true.
 * Small files are written inline → { status:'done', portfolioId, imported }; large files → 202 { status:'queued', jobId }.
 */
export const POST = withApi(
  async ({ user, body }) => {
    const scope = { orgId: user.orgId, userId: user.id };
    const u = await universe();
    const parsed: CsvParseResult = parsePositionsCsv(body.csv, { knownTickers: new Set(u.keys()) });
    const rows = mergeCsvRows(parsed.rows);
    const existing = body.portfolioId ? await portfolioRepo.get(scope, body.portfolioId) : null;
    if (body.portfolioId && !existing) throw notFound('Portfolio not found');
    const have = body.mode === 'append' && existing ? existing.positions.map((p) => p.ticker) : [];
    const adding = newTickerCount(have, rows.map((r) => r.ticker));
    const gate = positionsGate(user, have.length, adding);
    const summary = { totalRows: parsed.totalRows, validRows: parsed.rows.length, positions: rows.length, errors: parsed.errors, warnings: parsed.warnings, gate: { ...gate, maxAddable: gate.maxAddable === Infinity ? null : gate.maxAddable, limit: gate.limit === Infinity ? null : gate.limit, remaining: gate.remaining === Infinity ? null : gate.remaining } };
    if (body.dryRun) return { status: 'preview', preview: rows.slice(0, 200), ...summary };
    if (!rows.length) throw badRequest('No valid rows to import', parsed.errors.slice(0, 50));
    if (parsed.errors.length && !body.skipInvalid) throw badRequest(`${parsed.errors.length} row error(s). Fix them or import valid rows only.`, parsed.errors.slice(0, 50));
    enforcePositions(user, have.length, adding);
    const args = { portfolioId: body.portfolioId, name: clean(body.name, 120) ?? undefined, description: clean(body.description ?? undefined, 1000), benchmark: body.benchmark, mode: body.mode, rows };
    if (parsed.totalRows > BACKGROUND_ROWS) {
      const id = `imp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
      store.set(id, { status: 'queued', orgId: user.orgId, startedAt: Date.now() });
      jobs.enqueue('portfolio.import', { id, scope, args }, { maxAttempts: 1 });
      return Response.json({ status: 'queued', jobId: id, ...summary }, { status: 202 });
    }
    const r = await write(scope, args);
    return { status: 'done', ...r, ...summary };
  },
  {
    body: z.object({
      csv: z.string().min(1).max(2_000_000),
      portfolioId: z.string().max(64).optional(),
      name: z.string().trim().min(1).max(120).optional(),
      description: z.string().max(1000).nullable().optional(),
      benchmark: BENCH.optional(),
      mode: z.enum(['replace', 'append']).default('replace'),
      dryRun: z.boolean().optional(),
      skipInvalid: z.boolean().optional(),
    }),
    rateLimit: 'mutation', audit: 'portfolio.import',
  },
);

/** GET /api/portfolios/import?jobId=… → background import status. */
export const GET = withApi(
  async ({ user, query }) => {
    const j = store.get(query.jobId);
    if (!j || j.orgId !== user.orgId) throw notFound('Import job not found');
    const { orgId: _o, ...rest } = j;
    void _o;
    return { jobId: query.jobId, ...rest };
  },
  { query: z.object({ jobId: z.string().min(1).max(64) }) },
);
