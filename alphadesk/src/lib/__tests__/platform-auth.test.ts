/**
 * Critical path: session user shape (auth.ts) and the middleware protection matrix (middleware.ts).
 * Prisma and next-auth's server session are mocked so this runs without a DB or a running server.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  users: new Map<string, Record<string, unknown>>(),
  session: null as null | { user?: Record<string, unknown> },
}));

vi.mock('@/lib/db', () => {
  const findUnique = async ({ where }: { where: { id?: string; email?: string } }) => {
    for (const u of h.users.values()) if ((where.id && u.id === where.id) || (where.email && u.email === where.email)) return u;
    return null;
  };
  const db = { user: { findUnique } };
  return { db, default: db };
});
vi.mock('next-auth', async (orig) => ({ ...(await orig<object>()), getServerSession: vi.fn(async () => h.session) }));
// withAuth(opts) -> return the options so we can exercise the `authorized` callback directly.
vi.mock('next-auth/middleware', () => ({ withAuth: (opts: unknown) => opts }));

import { authOptions, getSessionUser } from '@/lib/auth';
import middlewareOptions, { config as middlewareConfig } from '@/middleware';

const PM = { id: 'u_pm', orgId: 'org_1', email: 'pm@nidhikshdesk.dev', name: 'Priya Mehta', role: 'ADMIN', plan: 'PRO_PLUS', image: null };
const INTERN = { id: 'u_in', orgId: 'org_1', email: 'intern@nidhikshdesk.dev', name: null, role: 'VIEWER', plan: 'bogus', image: null };

beforeEach(() => {
  h.users.clear();
  h.users.set(PM.id, PM);
  h.users.set(INTERN.id, INTERN);
  h.session = null;
});

describe('getSessionUser', () => {
  it('returns null when signed out', async () => {
    expect(await getSessionUser()).toBeNull();
  });

  it('returns null when the session user no longer exists', async () => {
    h.session = { user: { id: 'u_deleted' } };
    expect(await getSessionUser()).toBeNull();
  });

  it('returns {id, orgId, email, name, role, plan} fresh from the DB', async () => {
    h.session = { user: { id: PM.id, email: PM.email } };
    const u = await getSessionUser();
    expect(u).toEqual({ id: 'u_pm', orgId: 'org_1', email: PM.email, name: 'Priya Mehta', role: 'ADMIN', plan: 'PRO_PLUS', image: null });
  });

  it('reflects plan toggles immediately (DB is the source of truth, not the JWT)', async () => {
    h.session = { user: { id: PM.id } };
    h.users.set(PM.id, { ...PM, plan: 'FREE' });
    expect((await getSessionUser())?.plan).toBe('FREE');
  });

  it('falls back to email for name and FREE for unknown plans', async () => {
    h.session = { user: { id: INTERN.id } };
    const u = await getSessionUser();
    expect(u?.name).toBe(INTERN.email);
    expect(u?.plan).toBe('FREE');
  });
});

describe('authOptions', () => {
  it('uses JWT sessions and the /login page', () => {
    expect(authOptions.session?.strategy).toBe('jwt');
    expect(authOptions.pages?.signIn).toBe('/login');
  });

  it('dev credentials provider signs in only known, well-formed emails', async () => {
    const cred = authOptions.providers.find((p) => p.id === 'credentials') as unknown as {
      options: { authorize: (c: Record<string, string>) => Promise<unknown> };
    };
    const authorize = cred.options.authorize;
    expect(await authorize({ email: '  PM@NidhikshDesk.dev ' })).toMatchObject({ id: PM.id, email: PM.email });
    expect(await authorize({ email: 'nobody@nidhikshdesk.dev' })).toBeNull();
    expect(await authorize({ email: 'not-an-email' })).toBeNull();
    expect(await authorize({})).toBeNull();
  });

  it('jwt callback stamps uid + orgId; session callback exposes id', async () => {
    const token = await authOptions.callbacks!.jwt!({ token: {}, user: { id: 'x', email: PM.email } } as never);
    expect(token).toMatchObject({ uid: PM.id, orgId: PM.orgId });
    const s = await authOptions.callbacks!.session!({ session: { user: { email: PM.email }, expires: '' }, token } as never);
    expect((s.user as { id?: string }).id).toBe(PM.id);
  });
});

describe('middleware protection matrix', () => {
  const { callbacks } = middlewareOptions as unknown as {
    callbacks: { authorized: (a: { req: { nextUrl: { pathname: string } }; token: unknown }) => boolean };
  };
  const allowed = (pathname: string, signedIn: boolean) => callbacks.authorized({ req: { nextUrl: { pathname } }, token: signedIn ? { uid: 'u' } : null });

  const PROTECTED = ['/', '/dashboard', '/company/AAPL', '/research', '/research/t_123', '/screener', '/portfolios', '/portfolios/p1', '/baskets', '/baskets/b1', '/shared', '/settings', '/shared/tok/extra'];
  const PUBLIC = ['/login', '/login/', '/shared/abc123', '/shared/abc123/'];

  it.each(PROTECTED)('%s requires a session', (p) => {
    expect(allowed(p, false)).toBe(false);
    expect(allowed(p, true)).toBe(true);
  });

  it.each(PUBLIC)('%s is public', (p) => {
    expect(allowed(p, false)).toBe(true);
  });

  // Next matchers are path-to-regexp strings; this one is a plain regex group, so it compiles directly.
  const matcher = new RegExp(`^${middlewareConfig.matcher[0]}$`);
  it.each(['/dashboard', '/company/AAPL', '/settings', '/shared/abc'])('middleware runs on %s', (p) => {
    expect(matcher.test(p)).toBe(true);
  });
  it.each(['/api/me', '/api/auth/csrf', '/_next/static/chunk.js', '/_next/image', '/favicon.ico', '/nidhiksh-logo.png', '/fonts/inter.woff2'])(
    'middleware skips %s (API routes enforce auth via withApi)',
    (p) => {
      expect(matcher.test(p)).toBe(false);
    },
  );
});
