/**
 * Login brute-force protection (pure; unit-tested). Used by the NextAuth route wrapper for
 * POST /api/auth/callback/credentials. In-memory token buckets (per instance) behind src/lib/rate-limit.ts.
 */
import { createHash } from 'node:crypto';
import { getLimiter, type RateLimitOptions, type RateLimiter } from './rate-limit';

const WINDOW_SEC = 15 * 60;
/** 20 attempts per IP and 5 per email per 15 minutes (bucket refills continuously). */
export const LOGIN_LIMITS: Record<'ip' | 'email', RateLimitOptions> = {
  ip: { capacity: 20, refillPerSec: 20 / WINDOW_SEC },
  email: { capacity: 5, refillPerSec: 5 / WINDOW_SEC },
};

/**
 * Client IP. X-Forwarded-For / X-Real-IP are only trusted behind a known proxy (TRUST_PROXY=1, e.g. Vercel);
 * otherwise clients could spoof them to dodge the per-IP limit.
 */
export function clientIp(headers: Headers, reqIp: string | undefined | null, trustProxy = process.env.TRUST_PROXY === '1'): string {
  if (trustProxy) {
    const fwd = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
    if (fwd) return fwd;
    const real = headers.get('x-real-ip')?.trim();
    if (real) return real;
  }
  return reqIp || 'unknown';
}

/** Log-safe identifier for an email: masked local part + short hash (never the full address). */
export function maskEmail(email: string): string {
  const e = email.trim().toLowerCase();
  const [local = '', domain = ''] = e.split('@');
  const h = createHash('sha256').update(e).digest('hex').slice(0, 10);
  return `${local.slice(0, 1)}***@${domain || '?'}#${h}`;
}

export interface LoginRateResult { allowed: boolean; retryAfterSec: number; scope?: 'ip' | 'email' }

/** Consume one attempt from both the IP and the email bucket. */
export function checkLoginRate(email: string, ip: string, limiters?: { ip: RateLimiter; email: RateLimiter }): LoginRateResult {
  const l = limiters ?? { ip: getLimiter('login-ip', LOGIN_LIMITS.ip), email: getLimiter('login-email', LOGIN_LIMITS.email) };
  // Unknown IP (self-hosted `next start` without TRUST_PROXY): skip the IP bucket rather than sharing one global
  // bucket that a single attacker could exhaust for everybody. The per-email bucket still applies.
  if (ip && ip !== 'unknown') {
    const byIp = l.ip.take(`ip:${ip}`);
    if (!byIp.allowed) return { allowed: false, retryAfterSec: byIp.retryAfterSec, scope: 'ip' };
  }
  const key = email.trim().toLowerCase();
  if (key) {
    const byEmail = l.email.take(`email:${key}`);
    if (!byEmail.allowed) return { allowed: false, retryAfterSec: byEmail.retryAfterSec, scope: 'email' };
  }
  return { allowed: true, retryAfterSec: 0 };
}
