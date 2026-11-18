/**
 * Content-Security-Policy. Everything the browser loads is same-origin: company logos are proxied through
 * /api/logo, fonts are bundled (@fontsource), market/AI/provider calls happen server-side.
 *  - script-src needs 'unsafe-inline' for the Next.js App Router's inline bootstrap/RSC scripts (no nonce pipeline);
 *    'unsafe-eval' only in development (React Refresh).
 *  - style-src needs 'unsafe-inline' for React `style={…}` attributes (Recharts, layout widths).
 *  - Google sign-in is a top-level redirect started by fetch(), so it needs no CSP allowance; accounts.google.com is
 *    still listed in form-action for browsers that apply form-action to redirects.
 */
const isDev = process.env.NODE_ENV !== 'production';
const googleOn = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? ' ws: wss:' : ''}`,
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  `form-action 'self'${googleOn ? ' https://accounts.google.com' : ''}`,
  "manifest-src 'self'",
  "worker-src 'self' blob:",
].join('; ');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  eslint: { ignoreDuringBuilds: true },
  experimental: {
    serverComponentsExternalPackages: ['better-sqlite3', '@prisma/client', 'exceljs'],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          ...(isDev ? [] : [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' }]),
        ],
      },
    ];
  },
};
export default nextConfig;
