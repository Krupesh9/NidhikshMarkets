import { withAuth } from 'next-auth/middleware';

/** Public page paths (everything else under the app requires a session). API routes enforce auth via withApi. */
const PUBLIC = [/^\/login(\/|$)/, /^\/signup(\/|$)/, /^\/shared\/[^/]+\/?$/];

export default withAuth({
  pages: { signIn: '/login' },
  callbacks: {
    authorized: ({ req, token }) => !!token || PUBLIC.some((r) => r.test(req.nextUrl.pathname)),
  },
});

export const config = {
  matcher: ['/((?!api/|_next/static|_next/image|favicon.ico|icon.png|nidhiksh-logo.png|manifest.webmanifest|icons/|.*\\.(?:png|svg|jpg|ico|woff2?)$).*)'],
};
