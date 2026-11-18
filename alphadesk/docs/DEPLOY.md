# Deploying Nidhiksh Pulse to Vercel

This guide takes you from a new Vercel account to a running production deployment with your existing local data
carried over. Budget about 30 minutes.

Production differs from local development in four ways:

- **Postgres instead of SQLite.** Vercel's filesystem is read-only, so you need Supabase or Neon.
- **No demo data.** The mock provider is off unless you set `ALLOW_MOCK_DATA=1`. Sections without a real source
  show an empty state instead of simulated numbers.
- **No demo logins.** The email-only "magic link" is off unless you set `ALLOW_DEMO_LOGIN=1`, which you shouldn't.
  You sign in as the owner with an email and password, and others can use Google if you enable it.
- **No self-serve plan toggle.** Only an ADMIN can change plans, in **Settings → Team**.

Plans: **Free** ($0) and **Pro** ($100/month). Stripe isn't connected yet. The "Upgrade to Pro" button emails the
owner (`PULSE_OWNER_EMAIL`), and the owner upgrades the user in Settings → Team.

---

## 1. Create the database

Pulse keeps all of its tables in a Postgres schema called **`pulse`** (override with `PULSE_DB_SCHEMA`). You can
point it at a database that other apps also use, and it won't touch their tables. The schema is created on the first
build.

### Option A: Supabase

1. Create a project at [supabase.com](https://supabase.com) and pick the region closest to Vercel's `iad1` (US East).
2. Open **Project Settings → Database → Connection string**.
3. Copy two URLs, replacing `[YOUR-PASSWORD]` in each:
   - **Transaction pooler** (port **6543**) → `DATABASE_URL`. Pulse adds `pgbouncer=true` automatically.
   - **Direct connection** or **Session pooler** (port **5432**) → `DIRECT_URL`. Schema changes during the build use
     this one.

### Option B: Neon

1. Create a project at [neon.tech](https://neon.tech), or add the Neon integration from the Vercel Marketplace.
2. Set `DATABASE_URL` to the **pooled** connection string and `DIRECT_URL` (or `DATABASE_URL_UNPOOLED`) to the
   **direct** one. The Marketplace integration sets both for you.

## 2. Import the repo into Vercel

1. Sign in at [vercel.com](https://vercel.com) with GitHub and click **Add New… → Project**.
2. Pick the repository and click **Import**.
3. Set **Root Directory** to **`alphadesk`**. This step is required because the app lives in that folder.
4. Keep the framework preset at **Next.js**. Don't override the build or install commands. `vercel.json` sets
   `npm ci` and `node scripts/vercel-build.mjs`, which:
   1. writes `prisma/postgres.generated.prisma`, a copy of the SQLite schema with Postgres as the provider;
   2. runs `prisma generate` and `prisma db push` into the `pulse` schema only, and refuses any change that would lose
      data;
   3. runs `next build`.
5. Add the environment variables from section 3 **before** the first deploy, then click **Deploy**.

## 3. Environment variables

Add these in **Project → Settings → Environment Variables**, for the Production environment and also Preview if you
use preview deploys. Never commit `.env`.

### Required

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Pooled Postgres URL (Supabase port 6543 or Neon pooled). |
| `DIRECT_URL` | Direct Postgres URL, used for schema changes at build time. Neon can use `DATABASE_URL_UNPOOLED` instead. |
| `NEXTAUTH_SECRET` | Signs session cookies. Generate with `openssl rand -base64 32`. |
| `NEXTAUTH_URL` | Public base URL, e.g. `https://pulse.example.com` or `https://<project>.vercel.app`. |
| `ENCRYPTION_KEY` | 32-byte base64 key (`openssl rand -base64 32`) that encrypts users' saved AI keys. Keep it stable: if it changes, saved keys can't be decrypted. |
| `PULSE_OWNER_EMAIL` | Your sign-in email. Your first sign-in creates the organisation and makes you ADMIN on Pro. "Upgrade" requests are emailed here. |
| `PULSE_OWNER_PASSWORD` | Your password. Use a long random one. It's compared in constant time and never stored. |
| `TRUST_PROXY` | Set to `1` on Vercel so rate limits use the real client IP from `X-Forwarded-For`. |

### Recommended data providers (optional)

Each one is optional. Without any of them, the app runs but most sections show empty states.

| Variable | Purpose |
|---|---|
| `ALPACA_API_KEY` / `ALPACA_SECRET_KEY` | Quotes, daily bars and intraday bars from Alpaca's market-data API. No trading endpoints are called. |
| `ALPACA_FEED` | `sip` (default) or `iex`. |
| `MASSIVE_API_KEY` | Massive (Polygon) market data and news. `POLYGON_API_KEY` is a legacy alias. |
| `SEC_USER_AGENT` | Turns on live SEC EDGAR filings and XBRL financials. Use a contact string such as `"Nidhiksh Pulse you@example.com"`. |
| `ALPHA_VANTAGE_API_KEY` | Consensus estimates (Fwd EPS / Fwd P/E) and the earnings calendar. |
| `FMP_API_KEY` | Financial Modeling Prep: analyst ratings, price targets and analyst actions. `FMP_DAILY_LIMIT` caps calls per day (default 240). |
| `FRED_API_KEY` | Macro release dates on the calendar, and Treasury yields. |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | Claude for the AI research assistant (Pro). Default model: `claude-opus-5-5`. |
| `GEMINI_API_KEY` / `GEMINI_MODEL` | Gemini as an alternative AI provider. |
| `AI_PROVIDER` | Forces `anthropic`, `gemini` or `mock` when that provider's key is available. |

### Sign-in and behaviour (optional)

| Variable | Default | Purpose |
|---|---|---|
| `PULSE_OWNER_NAME` | email prefix | Display name for the owner account. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | — | Adds "Continue with Google". New Google users join the first organisation as **VIEWER on Free**. |
| `ALLOW_MOCK_DATA` | off in production | `1` turns the simulated demo universe back on as a fallback. Leave it unset in production. |
| `ALLOW_DEMO_LOGIN` | off in production | `1` turns on email-only sign-in as any existing user. **Never set this in production.** |
| `PULSE_DB_SCHEMA` | `pulse` | Postgres schema that holds Pulse's tables. |
| `NIDHIKSH_DB_PATH` | — | Local Nidhiksh Markets cache. It doesn't exist on Vercel, so leave it unset. |
| `ALPHADESK_FORCE_MOCK` | — | Demos and CI only. Serves only mock data. |

Vercel sets `VERCEL`, `VERCEL_GIT_COMMIT_SHA` and `NODE_ENV=production` itself. `/api/health` reports the commit.

## 4. First sign-in

1. Open `https://<your-deployment>/login`.
2. Sign in with `PULSE_OWNER_EMAIL` and `PULSE_OWNER_PASSWORD`. The first sign-in creates the organisation and your
   ADMIN / Pro account.
3. Check `https://<your-deployment>/api/health`. It needs no sign-in and returns `ok`, the commit, whether the
   database is reachable, and which providers are configured (true/false only, never key values).

Failed sign-ins are rate-limited per IP and per email, and logged without secrets.

## 5. Bring your local data over

Your watchlists, saved screens, portfolios, baskets, research notes, AI threads, shares and comments can move with
you. Sessions, OAuth accounts, saved API keys, audit logs and usage counters are never exported.

**Export locally.** Run this on your Mac, inside `alphadesk/`:

```bash
node scripts/export-data.mjs
# → data-export/pulse-export-YYYY-MM-DD.json   (git-ignored; it contains your data, so don't commit it)
```

**Import into production.** Deploy at least once first, so the tables exist. Then run:

```bash
DATABASE_URL='postgresql://…:6543/postgres' \
DIRECT_URL='postgresql://…:5432/postgres' \
node scripts/import-data.mjs --file data-export/pulse-export-YYYY-MM-DD.json --owner you@example.com --dry-run

# Looks right? Run it again without --dry-run.
```

What the import does:

- **Generates its own Postgres Prisma client** in `.cache/prisma-import/`. Your local SQLite client is left alone,
  and the `pulse` schema is pinned the same way the app pins it.
- **Creates or upgrades the owner.** `--owner` gets ADMIN / Pro, in the first organisation.
- **Merges demo content into your account.** Everything owned by the demo users (`…@nidhikshdesk.dev`) moves to the
  owner. Watchlists with the same name are merged and duplicate symbols are removed.
- **Imports real users as themselves.** Any non-demo users in the export are imported with their own content. The
  retired `PRO` plan becomes Pro (`PRO_PLUS`).
- **Is idempotent.** Rows keep their ids and are upserted, so you can safely run it again.
- **Can add users.** `--add-user email:PLAN:ROLE` (repeatable) adds more users to your organisation, for example
  `--add-user analyst@fund.com:FREE:VIEWER`.

## 6. Custom domain

1. In **Project → Settings → Domains**, add `pulse.example.com` and create the DNS record Vercel shows (CNAME to
   `cname.vercel-dns.com`, or A records for an apex domain).
2. Change `NEXTAUTH_URL` to `https://pulse.example.com` and redeploy.
3. If you use Google sign-in, add `https://pulse.example.com/api/auth/callback/google` to the OAuth client's
   **Authorized redirect URIs** in Google Cloud Console.

## 7. Users and plans

- **Add a teammate:** go to **Settings → Team → Invite** (ADMIN only). They get Free by default. A teammate can also
  sign in with Google if it's enabled, and joins as VIEWER on Free.
- **Change a plan or role:** go to **Settings → Team** and change the member's plan (Free / Pro) or role
  (ADMIN / ANALYST / VIEWER). Every change is checked on the server and written to the audit log. Users can't change
  their own plan.
- **What Free and Pro include:**
  - Free: the basic price chart (area/line, 1M–1Y), quote, P/E (TTM), EPS (TTM), market cap, news, filings list,
    calendar, watchlist, home page, and market charts and news.
  - Pro: everything in Free, plus the AI research assistant, advanced charts (indicators, candlesticks, intraday,
    5Y/MAX), analyst research, financial statements, EV/EBITDA, ownership, index holdings, sharing, export and team
    seats.

## 8. Rollback and backups

- **Roll back the app:** in **Project → Deployments**, open an earlier deployment and choose **Instant Rollback**
  (or **Promote to Production**). The rollback is immediate and doesn't rebuild.
- **Database:**
  - The build only runs `prisma db push` and never accepts data loss. A schema change that would drop data fails the
    build instead.
  - Supabase takes daily backups (Point-in-Time Recovery on paid plans), under **Database → Backups**. Neon supports
    branch restore.
  - For your own copy, run `pg_dump --schema=pulse "$DIRECT_URL" > pulse-backup.sql`.
- **Data export:** the local `export-data.mjs` reads SQLite only. To snapshot production, use `pg_dump` as above.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Build fails with "DATABASE_URL must be a Postgres URL" | Set `DATABASE_URL` for the environment that's building (Production or Preview). |
| Build fails on `prisma db push` with a pooler or prepared-statement error | Set `DIRECT_URL` to the port 5432 / unpooled URL. |
| Sign-in loops back to `/login` | `NEXTAUTH_URL` must match the URL you're using, and `NEXTAUTH_SECRET` must be set. |
| "Sign-in failed" for the owner | Check `PULSE_OWNER_EMAIL` and `PULSE_OWNER_PASSWORD`, then redeploy after changing env vars. |
| Sections show "No data" | Add the matching provider key (see section 3). Production never shows simulated data. |
| `/api/health` reports `db: false` | Check the database URL and password, and that the project isn't paused (Supabase pauses free projects). |

## Security headers and production behaviour

- **Headers** (CSP, `X-Frame-Options: DENY`, `nosniff`, referrer and permissions policies, HSTS) are set in
  `next.config.mjs`, not `vercel.json`. Everything the browser loads is same-origin (logos go through `/api/logo`,
  fonts are bundled), so the CSP is `default-src 'self'` with `'unsafe-inline'` scripts/styles, which the Next.js App
  Router and React `style` attributes need. If you add a third-party script or image host, add it there.
- **No simulated data.** With `NODE_ENV=production` the Mock provider is off unless `ALLOW_MOCK_DATA=1`. Sections
  without a real source show an empty state. The AI assistant answers `503 ai_not_configured` until
  `ANTHROPIC_API_KEY` or `GEMINI_API_KEY` is set, or the user saves their own key in Settings → AI keys.
- **Plan enforcement** is server-side. Plans are read from the database on every request. Free users get
  `403 upgrade_required` from premium APIs: chart ranges 1D/1W/5Y/MAX, `?section=` on `/api/company/:ticker`,
  `/api/company/:ticker/fundamentals`, and every `/api/ai/*` data route. Premium sections are not fetched for them at
  all, and share links are redacted for Free or signed-out viewers.
