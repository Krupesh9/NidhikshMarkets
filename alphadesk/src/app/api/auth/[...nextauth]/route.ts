import NextAuth from 'next-auth';
import { NextResponse, type NextRequest } from 'next/server';
import { authOptions } from '@/lib/auth';
import { checkLoginRate, clientIp, maskEmail } from '@/lib/auth-guard';
import { log } from '@/lib/log';

const handler = NextAuth(authOptions);
type Ctx = { params: { nextauth: string[] } };

/**
 * Rate-limit the credentials callback per IP and per email before NextAuth sees it.
 * next-auth/react `signIn(..., { redirect: false })` reads `data.url` and takes `?error=` from it, so a limited
 * attempt returns 429 + `{ url: '/login?error=RateLimited&retryAfter=N' }` (absolute URL) → `r.error === 'RateLimited'`.
 */
async function POST(req: NextRequest, ctx: Ctx) {
  const path = ctx.params?.nextauth ?? [];
  if (path[0] === 'callback' && path[1] === 'credentials') {
    let email = '';
    try {
      const form = await req.clone().formData();
      email = String(form.get('email') ?? '');
    } catch { /* malformed body: NextAuth will reject it */ }
    const ip = clientIp(req.headers, req.ip);
    const r = checkLoginRate(email, ip);
    if (!r.allowed) {
      log.warn('auth.login_rate_limited', { scope: r.scope, ip, email: email ? maskEmail(email) : undefined, retryAfterSec: r.retryAfterSec });
      const url = new URL(`/login?error=RateLimited&retryAfter=${r.retryAfterSec}`, req.nextUrl.origin).toString();
      return NextResponse.json({ url }, { status: 429, headers: { 'retry-after': String(r.retryAfterSec) } });
    }
  }
  return handler(req, ctx);
}

export { handler as GET, POST };
