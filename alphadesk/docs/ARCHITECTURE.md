# NidhikshDesk — Architecture

A single Next.js 14 (App Router) process serves both the UI and the API on port 4200. Everything that touches data,
keys or AI runs server-side and is marked `import 'server-only'`. Every external system sits behind an interface, so
the phase-two infrastructure (Postgres, Redis, workers) can replace the in-process implementations without touching
feature code.

## Layers

| Layer | Location | Responsibility |
|---|---|---|
| UI | `src/app/(app)/*`, `src/components/*` | Pages, shell (sidebar, topbar, right rail, ⌘J chat, `?` overlay), shadcn-style UI kit |
| Edge gate | `src/middleware.ts` | Redirects signed-out users to `/login`. Public: `/login`, `/shared/[token]`. Skips `/api/*` and static assets |
| API | `src/app/api/**/route.ts` + `src/lib/http.ts` | `withApi(handler, opts)` runs the same pipeline on every route (see below) |
| Domain services | `src/lib/plans.ts`, `usage.ts`, `audit.ts`, `src/lib/ai/*`, `src/lib/screener/*` | Plan gates, metering, audit, AI orchestration, screening |
| Repositories | `src/lib/repos/*` | Org-scoped persistence with typed DTOs (JSON columns parsed here) |
| Market data | `src/lib/data/*` | `MarketDataProvider` interface + composite fallback chain |
| Platform | `cache.ts`, `rate-limit.ts`, `jobs.ts`, `log.ts`, `crypto.ts`, `csrf.ts`, `sanitize.ts` | Cross-cutting infrastructure behind small interfaces |
| Storage | `prisma/schema.prisma` (SQLite) · `prisma/postgres/schema.prisma` (phase two) | Prisma 5 |

### `withApi` request pipeline
`correlation id` → `getSessionUser()` (401 if required) → role check (403) → **CSRF same-origin** on mutations
(403) → **rate limit** keyed per user or IP (429 + `retry-after`) → zod body/query validation (400) → handler →
optional **audit** event → JSON response. Errors always have the shape `{ error: { code, message, details? } }` and
include the `x-correlation-id` header. Plan gates return 402 `upgrade_required` with `upgradeTo`.

## Repository interfaces
Every repo method takes a `Scope = { orgId, userId }` and only returns rows from that org:
`portfolioRepo`, `screenRepo` (saved screens + watchlist), `researchRepo` (notes, chat threads and messages),
`shareRepo` (shares, comments, public tokens), `usageRepo`, `auditRepo`. DTOs live in `src/lib/repos/types.ts`.
Features never call Prisma for these entities directly. That keeps the move to a different storage engine (Postgres
JSONB, pgvector, Timescale) contained inside the repos.

## Market-data provider abstraction
`MarketDataProvider` (`src/lib/data/types.ts`) has these methods: `getUniverse`, `getQuote(s)`, `getHistory`,
`getProfile`, `getFinancials`, `getEstimates`, `getInsiders`, `getInstitutional`, `getNews`, `getFilings`,
`getCatalysts`, `getScreenRows` and `getTranscripts`. Each one returns
`{ data, meta: { source: SourceRef[], isMock, asOf, provider } }`.

Providers can be **partial**, meaning they implement only some methods. The `CompositeProvider` walks
**Massive → Nidhiksh local cache → SEC EDGAR → Mock** per method. The first non-empty result wins. A provider that
throws or comes back empty is skipped, and the code never throws to the UI. `ALPHADESK_FORCE_MOCK=1` reduces the
chain to Mock only. `getQuotes` falls through per ticker and sets `isMock` if any ticker was served by mock. Results
are cached by method and arguments. TTLs: quotes 30 s, screen rows 60 s, news 5 min, history 10 min, filings,
profile and financials 60 min. Concurrent identical calls share a single in-flight promise.
`getDataMode()` (`mode.ts`) drives the topbar indicator.

## AI and tool calling
`src/lib/ai` defines a provider-neutral conversation format (`LLMMessage`, `ToolSpec`, `ToolCall`, `ProviderEvent`)
with three providers: **Claude** (Anthropic SDK), **Gemini** and **Mock**. Keys are resolved per request: the user's
encrypted key first, then env, then Mock. The orchestrator runs this loop:

1. Build the system prompt and tool specs. Tools wrap `getMarketData()` methods and repo lookups.
2. Stream a model turn. Text deltas and `tool_call` events go to the client over **SSE**
   (`POST /api/ai/chat`).
3. Run the tool calls server-side and register each returned `SourceRef` as a numbered **citation** (`[n]`).
4. Feed the tool results back to the model and repeat until `end_turn`, up to a step cap.
5. Persist the messages (`researchRepo`) with citations and structured blocks (table, chart, BQL hint).

AI calls are gated by `assertFeature('ai')` and `canUseAi()` (monthly counter), rate-limited with the `ai` preset
(burst 5, 10/min) and audited as `ai.query`.

## Caching, rate limits, jobs
All three are in-process today, each behind an interface that a Redis-backed implementation can replace:

| Concern | Interface | Today | Phase two |
|---|---|---|---|
| Cache | `Cache { get, set, delete, clear, wrap }` | LRU-ish `Map` with TTL (5 min default, 5,000 keys) | Redis |
| Rate limit | `RateLimiter { take(key) }` | Token bucket. Presets `default` 60/min, `ai` burst 5 @ 10/min, `auth` 10/min, `mutation` 30/min | Redis (sliding window) |
| Jobs | `JobQueue { register, enqueue, size }` | `setTimeout` queue, exponential backoff, 3 attempts | BullMQ workers |

All three are stored on `globalThis` so they survive dev HMR. They are per-process and don't survive a restart.

## Multi-tenancy
Every table has an `orgId` column and an index on it. Users belong to one `Organization`. `getSessionUser()` returns
`{ id, orgId, email, name, role, plan }`, read **fresh from the DB** on each request, so plan and role changes take
effect immediately. Repos filter by `Scope.orgId`. Public share links (`/shared/[token]`) resolve one share token to a
read-only **snapshot** and never run a live org query. Roles are `ADMIN`, `ANALYST` and `VIEWER`. Plan tiers are
`FREE`, `PRO` and `PRO_PLUS`.

## Security
- **Sessions:** NextAuth v4 JWT in an **httpOnly**, SameSite=Lax cookie (`__Secure-` prefixed over HTTPS), signed
  with `NEXTAUTH_SECRET`. Dev magic link for seeded users. Google OAuth is optional.
- **CSRF:** NextAuth's double-submit token protects the auth endpoints. API mutations also pass a same-origin check
  (`Origin` host must equal `Host`/`X-Forwarded-Host`; with no Origin, `Sec-Fetch-Site` must not be cross-site).
- **Secrets at rest:** user-supplied API keys are encrypted with **AES-256-GCM** (`ENCRYPTION_KEY`, random 96-bit IV,
  auth tag verified on decrypt). Only `last4` is kept for masked display. Keys never reach the client, and the
  Massive key is sent as a Bearer header, never in a URL.
- **Logging:** structured JSON logs with a correlation id. Field names matching
  key/secret/token/password/cookie/authorization are redacted.
- **Audit:** `AuditLog` records data access, AI queries, shares, key changes and plan changes, with correlation ids.
  Settings → Audit shows the org trail.
- **Input:** zod validation on every route, `sanitizeText` and `sanitizeMarkdown` for stored user text,
  `sanitizeTicker`, and `csvSafe` against formula injection in exports.
- **Least privilege on shared data:** the Nidhiksh cache is opened `readonly` with `query_only = ON`.

## Deployment shapes
- **Local demo:** `npm run dev` with SQLite and no external services.
- **Docker (phase two):** `docker-compose.yml` with `db` (pgvector/pg16), `redis` and `app` (Postgres Prisma client),
  plus an optional `worker` profile.
- **Vercel:** `vercel.json` with a Postgres Prisma client. Requires a managed Postgres instance.

Note: the repos currently serialize JSON as strings to match SQLite `String` columns. The Postgres schema uses native
`Json`, so the repos need a small adapter before the Postgres deploy shapes are production-ready (see README "Known
limitations").
