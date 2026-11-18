import 'server-only';
import type { NextAuthOptions } from 'next-auth';
import { getServerSession } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { createHash, timingSafeEqual } from 'node:crypto';
import GoogleProvider from 'next-auth/providers/google';
import { db } from './db';
import { asPlan, type Plan, type Role } from './plans';
import { log } from './log';

export interface SessionUser {
  id: string;
  orgId: string;
  email: string;
  name: string;
  role: Role;
  plan: Plan;
  image?: string | null;
}

export const googleEnabled = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

/** Owner sign-in (email + password from env) — the production login for a personal deployment. */
export const ownerLoginEnabled = !!(process.env.PULSE_OWNER_EMAIL && process.env.PULSE_OWNER_PASSWORD);
/**
 * Demo "magic link" (email only, no password) — local development only. Off in production unless
 * ALLOW_DEMO_LOGIN=1 is set explicitly, because anyone could sign in as any seeded user.
 */
export const demoLoginEnabled = process.env.ALLOW_DEMO_LOGIN === '1' || process.env.NODE_ENV !== 'production';

function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** First owner sign-in creates the organisation and an admin user on the top plan. */
async function upsertOwner(email: string) {
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) return existing;
  const org = (await db.organization.findFirst({ orderBy: { createdAt: 'asc' } }))
    ?? (await db.organization.create({ data: { name: 'Nidhiksh', slug: 'nidhiksh' } }));
  return db.user.create({ data: { email, name: process.env.PULSE_OWNER_NAME || email.split('@')[0], orgId: org.id, role: 'ADMIN', plan: 'PRO_PLUS' } });
}

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  session: { strategy: 'jwt', maxAge: 30 * 24 * 3600 },
  pages: { signIn: '/login' },
  providers: [
    CredentialsProvider({
      id: 'credentials',
      name: 'Email',
      credentials: { email: { label: 'Email', type: 'email' }, password: { label: 'Password', type: 'password' } },
      async authorize(creds) {
        const email = String(creds?.email ?? '').trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
        const owner = process.env.PULSE_OWNER_EMAIL?.trim().toLowerCase();
        if (ownerLoginEnabled && email === owner) {
          if (!safeEqual(String(creds?.password ?? ''), process.env.PULSE_OWNER_PASSWORD!)) {
            log.info('auth.owner_password_rejected', { email });
            return null;
          }
          const u = await upsertOwner(email);
          return { id: u.id, email: u.email, name: u.name, image: u.image };
        }
        if (!demoLoginEnabled) return null;
        const user = await db.user.findUnique({ where: { email } });
        if (!user) return null;
        log.info('auth.magic_link_simulated', { email, link: `${process.env.NEXTAUTH_URL ?? 'http://localhost:4200'}/api/auth/callback/email?token=dev-simulated` });
        return { id: user.id, email: user.email, name: user.name, image: user.image };
      },
    }),
    ...(googleEnabled
      ? [GoogleProvider({ clientId: process.env.GOOGLE_CLIENT_ID!, clientSecret: process.env.GOOGLE_CLIENT_SECRET! })]
      : []),
  ],
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider !== 'google') return true;
      const email = user.email?.toLowerCase();
      if (!email) return false;
      const existing = await db.user.findUnique({ where: { email } });
      if (!existing) {
        const org = await db.organization.findFirst({ orderBy: { createdAt: 'asc' } });
        if (!org) return false;
        await db.user.create({ data: { email, name: user.name ?? email, image: user.image, orgId: org.id, role: 'VIEWER', plan: 'FREE' } });
      }
      return true;
    },
    async jwt({ token, user }) {
      if (user?.email) {
        const u = await db.user.findUnique({ where: { email: user.email.toLowerCase() } });
        if (u) {
          token.uid = u.id;
          token.orgId = u.orgId;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as { id?: string }).id = token.uid as string | undefined;
      }
      return session;
    },
  },
};

/**
 * Current user (fresh from DB so plan toggles apply immediately), or null if signed out.
 * Use in server components, route handlers and server actions.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const s = await getServerSession(authOptions);
  const id = (s?.user as { id?: string } | undefined)?.id;
  if (!id) return null;
  const u = await db.user.findUnique({ where: { id } });
  if (!u) return null;
  return { id: u.id, orgId: u.orgId, email: u.email, name: u.name ?? u.email, role: (u.role as Role) ?? 'VIEWER', plan: asPlan(u.plan), image: u.image };
}

/** Like getSessionUser but redirects to /login (server components) when signed out. */
export async function requireSessionUser(): Promise<SessionUser> {
  const u = await getSessionUser();
  if (!u) {
    const { redirect } = await import('next/navigation');
    redirect('/login');
  }
  return u as SessionUser;
}
