# Private partner access: threat model and implementation

## Objective
Allow the owner (Admin) and a specifically invited partner (Viewer) to use the browser-based Nidhiksh Markets app hosted on the UGREEN DXP2800. No NAS filesystem, source-code, database, Docker, or UGOS administrator access is granted to the partner.

## Recommended rollout
**Stage A: LAN-only authenticated app.** Next.js UI is available only on the home LAN, via a private bind/address and NAS firewall policy. API is internal to Compose and proxied via a same-origin route; database is not network-exposed. Test that an unauthenticated browser and API request are denied.

**Stage B: Remote partner access (explicit separate approval).** Prefer Tailscale with individual identities, narrowly scoped device/application ACLs and application login. Partner installs Tailscale and accesses the NAS-hosted app via a private address. Alternative for browser-only access: a securely configured Cloudflare Tunnel + Access policy, allowing only explicitly invited identities with MFA/OTP; this creates a publicly reachable endpoint protected by identity controls and must be separately reviewed. Never open home router ports. Do not expose the NAS admin UI.

## Authentication and authorization
- Use a well-maintained auth system or identity-aware proxy, not homemade password hashing/session cryptography.
- Admin and Viewer roles, enforced on every backend endpoint. Viewer can read authorized research and their own preferences; no provider credentials, refresh/admin commands, user management or raw NAS paths.
- Secure HttpOnly SameSite cookies, session expiry/revocation, login rate limits, CSRF defenses, audit trail for logins and privileged actions, secure logout, optional MFA.
- App authentication is required even when Tailscale is used. Do not rely on a secret URL or private GitHub repository for app security.
- No self-service public signup. Admin explicitly invites and revokes users.

## Deployment safeguards
- Verify network paths and DNS resolution before remote-access work. Require owner approval for installation, tunnel creation, ACL/firewall modifications, DNS, TLS certificates, and partner invitation.
- Do not place secrets in frontend JS, URLs, shared screenshots, or logs. Do not send proprietary raw strategy source to the browser.
- Add tests: anonymous access rejected, Viewer denied admin endpoints, session revocation works, CORS/CSRF controls, API unreachable outside intended route, NAS admin unreachable through partner path.

## Investor demonstrations
Even invite-only access can be redistribution or display under market-data licenses. Review terms for each feed and use permitted demonstration datasets where needed. Avoid representing signals as recommendations or performance guarantees.
