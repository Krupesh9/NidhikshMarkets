# Security boundaries

- Local-only preview. No public hosting, tunnel, DNS, router, firewall or NAS changes were made.
- All research/API routes require a session. Login itself is public, origin-checked and throttled. HttpOnly SameSite=Strict cookies; secure cookies are mandatory in NAS Compose behind approved private HTTPS.
- Argon2 password verification uses pwdlib. Session tokens use cryptographic randomness, are stored only as SHA-256 hashes, expire, and can be revoked. No default shared password or public signup.
- Admin/Viewer authorization is enforced by FastAPI. Watchlists, indicator presets and settings are user-isolated. Viewer market-feed display is off until licensing approval; synthetic demo remains available.
- Mutations require the exact configured Origin and session CSRF token. No permissive CORS. Backend has no exposed NAS Compose port; database and Docker socket are not exposed.
- Backend provider URLs are explicitly allowlisted. No user-controlled arbitrary outbound URL fetches. Logos are binary PNG/JPEG/WebP/ICO only; uploads accept PNG/JPEG, not SVG/HTML.
- `.env` and unique first-login credentials are private local files. Runtime directories and backups are excluded from Git. API keys never enter client JavaScript or response metadata.
- Request accounting and provider cooldowns persist in SQLite. Conservative caps apply to every attempt routed through the provider helper. Other applications using the same key are outside this app's visibility.
- The same-origin proxy deliberately uses one shared login-throttle bucket; do not trust arbitrary X-Forwarded-For. Review trusted proxy client-IP handling before wider private partner use.
- Optional remote access requires separate approval, HTTPS, individual identities, ACLs and application auth. No anonymous guest access or NAS admin sharing.

Local browser role isolation, session expiry/revocation, CSRF/origin and production-header checks passed. Python/frontend package advisory audits returned zero findings after the pip build-tool update. Native services bind to loopback; Compose leaves the API unpublished. Docker/NAS network-isolation execution remains unverified, and this work is not a full penetration test. Use `app.cli create-user --username NAME --role viewer` locally for approved accounts; invitations/remote access require owner authorization.
