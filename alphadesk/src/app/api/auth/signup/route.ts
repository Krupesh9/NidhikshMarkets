import { z } from 'zod';
import { withApi, ApiError } from '@/lib/http';
import { db } from '@/lib/db';
import { log } from '@/lib/log';
import { hashPassword, passwordProblem, PASSWORD_MAX } from '@/lib/password';
import { sanitizeText } from '@/lib/sanitize';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/signup { name, email, password } → creates a Free account (role VIEWER) in the workspace.
 * Public (no session), rate-limited per IP, same-origin only. The owner account can't be claimed here.
 */
export const POST = withApi(
  async ({ body }) => {
    const email = body.email.trim().toLowerCase();
    const owner = process.env.PULSE_OWNER_EMAIL?.trim().toLowerCase();
    if (owner && email === owner) throw new ApiError(409, 'email_taken', 'An account with this email already exists. Sign in instead.');
    const problem = passwordProblem(body.password);
    if (problem) throw new ApiError(400, 'weak_password', problem);
    const existing = await db.user.findUnique({ where: { email } });
    if (existing) throw new ApiError(409, 'email_taken', 'An account with this email already exists. Sign in instead.');
    const org = (await db.organization.findFirst({ orderBy: { createdAt: 'asc' } })) ?? (await db.organization.create({ data: { name: 'Nidhiksh', slug: 'nidhiksh' } }));
    const passwordHash = await hashPassword(body.password);
    const name = sanitizeText(body.name).slice(0, 80) || email.split('@')[0];
    try {
      await db.user.create({ data: { email, name, orgId: org.id, role: 'VIEWER', plan: 'FREE', passwordHash } });
    } catch (e) {
      // Never let the ORM error (which echoes the inserted row, incl. the hash) reach the logs.
      const code = (e as { code?: string }).code;
      if (code === 'P2002') throw new ApiError(409, 'email_taken', 'An account with this email already exists. Sign in instead.');
      log.error('auth.signup_failed', { code: code ?? 'unknown' });
      throw new ApiError(500, 'signup_failed', 'Could not create the account. Try again in a moment.');
    }
    log.info('auth.signup', { domain: email.split('@')[1] });
    return { ok: true };
  },
  {
    auth: false,
    rateLimit: 'auth',
    body: z.object({
      name: z.string().trim().min(1, 'Enter your name').max(80),
      email: z.string().trim().email('Enter a valid email').max(200),
      password: z.string().min(1).max(PASSWORD_MAX),
    }),
  },
);
