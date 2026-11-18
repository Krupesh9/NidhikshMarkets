import 'server-only';
import { canAccessSettings } from './owner';
import { NextResponse, type NextRequest } from 'next/server';
import type { z } from 'zod';
import { getSessionUser, type SessionUser } from './auth';
import { isSameOrigin } from './csrf';
import { getLimiter } from './rate-limit';
import { audit } from './audit';
import { CORRELATION_HEADER, getCorrelationId, log, type Logger } from './log';
import { assertFeature, type Feature, type Role } from './plans';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}
export const badRequest = (m: string, d?: unknown) => new ApiError(400, 'bad_request', m, d);
export const unauthorized = (m = 'Sign in required') => new ApiError(401, 'unauthorized', m);
export const forbidden = (m = 'Not allowed') => new ApiError(403, 'forbidden', m);
export const notFound = (m = 'Not found') => new ApiError(404, 'not_found', m);
/** Plan gate: 403 `upgrade_required`; body includes upgradeTo for <UpgradeHint/> and the upgrade dialog. */
export const upgradeRequired = (m: string, upgradeTo?: string) => new ApiError(403, 'upgrade_required', m, { upgradeTo });
/** Throws 403 upgrade_required unless the (DB-fresh) session user's plan includes `feature`. */
export function requireFeature(user: { plan: string } | null | undefined, feature: Feature): void {
  const g = assertFeature(user, feature);
  if (!g.allowed) throw upgradeRequired(g.reason ?? 'This is a Pro feature.', g.upgradeTo);
}

export interface ApiContext<B, Q, A extends boolean> {
  req: NextRequest;
  user: A extends false ? SessionUser | null : SessionUser;
  body: B;
  query: Q;
  params: Record<string, string>;
  correlationId: string;
  log: Logger;
}

export interface WithApiOptions<B extends z.ZodTypeAny | undefined, Q extends z.ZodTypeAny | undefined, A extends boolean> {
  /** require a signed-in user (default true) */
  auth?: A;
  /** allowed roles (default: any) */
  roles?: Role[];
  /** only the owner account may call this (Settings, team, plans, keys, usage, audit) */
  ownerOnly?: boolean;
  /** limiter preset name ('default' | 'ai' | 'auth' | 'mutation') or false. Default 'default'. Keyed per user (or IP). */
  rateLimit?: string | false;
  /** audit action name to record on success, e.g. 'ai.query'. */
  audit?: string | false;
  /** zod schema for JSON body (non-GET) */
  body?: B;
  /** zod schema for query-string params (object of strings) */
  query?: Q;
}

type Infer<S> = S extends z.ZodTypeAny ? z.infer<S> : undefined;

/**
 * Route helper:
 *   export const POST = withApi(async ({ user, body }) => ({ ok: true }), { body: schema, rateLimit: 'ai', audit: 'ai.query' });
 * Applies: correlation id, auth, role check, CSRF same-origin on mutations, rate limit, zod validation,
 * error shape `{ error: { code, message } }`. Handler may return a Response or any JSON-serialisable value.
 */
export function withApi<B extends z.ZodTypeAny | undefined = undefined, Q extends z.ZodTypeAny | undefined = undefined, A extends boolean = true>(
  handler: (ctx: ApiContext<Infer<B>, Infer<Q>, A>) => Promise<unknown> | unknown,
  opts: WithApiOptions<B, Q, A> = {},
) {
  return async (req: NextRequest, routeCtx?: { params?: Record<string, string | string[]> }): Promise<Response> => {
    const correlationId = getCorrelationId(req.headers);
    const l = log.child({ correlationId, method: req.method, path: req.nextUrl.pathname });
    const started = Date.now();
    const respond = (res: Response) => {
      res.headers.set(CORRELATION_HEADER, correlationId);
      return res;
    };
    try {
      const needAuth = opts.auth !== false;
      const user = await getSessionUser();
      if (needAuth && !user) throw unauthorized();
      if (opts.roles && (!user || !opts.roles.includes(user.role))) throw forbidden('Your role cannot perform this action');
      // Settings, team, plan, key, usage and admin endpoints are owner-only — enforced centrally by path so new routes are covered too.
      const ownerPath = /^\/api\/(settings|team|admin)(\/|$)/.test(new URL(req.url).pathname);
      if ((opts.ownerOnly || ownerPath) && !canAccessSettings(user)) throw forbidden('Only the owner can do this');
      if (!isSameOrigin(req)) throw forbidden('Cross-origin request blocked');

      if (opts.rateLimit !== false) {
        const name = opts.rateLimit ?? 'default';
        // Only trust X-Forwarded-For behind a known proxy (TRUST_PROXY=1); clients can spoof it otherwise.
        const fwd = process.env.TRUST_PROXY === '1' ? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() : undefined;
        const who = user?.id ?? fwd ?? req.ip ?? 'anon';
        const r = getLimiter(name).take(`${name}:${who}`);
        if (!r.allowed) {
          const res = NextResponse.json({ error: { code: 'rate_limited', message: `Too many requests. Retry in ${r.retryAfterSec}s.` } }, { status: 429 });
          res.headers.set('retry-after', String(r.retryAfterSec));
          return respond(res);
        }
      }

      let body: unknown = undefined;
      if (opts.body && !['GET', 'HEAD'].includes(req.method)) {
        let raw: unknown;
        try { raw = await req.json(); } catch { throw badRequest('Invalid JSON body'); }
        const parsed = opts.body.safeParse(raw);
        if (!parsed.success) throw badRequest('Validation failed', parsed.error.issues);
        body = parsed.data;
      }
      let query: unknown = undefined;
      if (opts.query) {
        const parsed = opts.query.safeParse(Object.fromEntries(req.nextUrl.searchParams.entries()));
        if (!parsed.success) throw badRequest('Invalid query parameters', parsed.error.issues);
        query = parsed.data;
      }
      const params = Object.fromEntries(Object.entries(routeCtx?.params ?? {}).map(([k, v]) => [k, Array.isArray(v) ? v.join('/') : v]));

      const out = await handler({ req, user: user as never, body: body as never, query: query as never, params, correlationId, log: l });
      if (opts.audit && user) audit({ orgId: user.orgId, userId: user.id, action: opts.audit, target: req.nextUrl.pathname, correlationId, meta: { method: req.method } });
      l.debug('api.ok', { ms: Date.now() - started });
      if (out instanceof Response) return respond(out);
      return respond(NextResponse.json(out ?? { ok: true }));
    } catch (e) {
      if (e instanceof ApiError) {
        l.info('api.error', { status: e.status, code: e.code });
        return respond(NextResponse.json({ error: { code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) } }, { status: e.status }));
      }
      // Next.js redirect()/notFound() throw special errors — rethrow them
      if (e && typeof e === 'object' && 'digest' in e && typeof (e as { digest: unknown }).digest === 'string' && (e as { digest: string }).digest.startsWith('NEXT_')) throw e;
      l.error('api.unhandled', { err: e as Error });
      return respond(NextResponse.json({ error: { code: 'internal', message: 'Something went wrong. Correlation id: ' + correlationId } }, { status: 500 }));
    }
  };
}
