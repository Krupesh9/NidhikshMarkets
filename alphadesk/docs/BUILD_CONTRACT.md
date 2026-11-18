# NidhikshDesk (formerly AlphaDesk) — build contract (read before writing code)

AlphaDesk is a Bloomberg-inspired **research and decision** platform for hedge fund PMs and equity analysts.
Phase One = information and insight only. **No trading, order routing, broker integration or execution.**
Local demo mode tonight: must launch and be fully demonstrable with **zero external dependencies**.

## Location, branch, port
- App root: `/Users/krupeshpatel/Documents/ChatGPT/Nidhiksh Markets AlphaDesk/alphadesk` (git worktree, branch `feat/alphadesk`).
- Dev server: `npm run dev` → `next dev -H 127.0.0.1 -p 4200`. **Port 4200 only.** Never touch ports 3000/3100/8000/8100 (other running apps) or any other folder.
- Do not commit; the lead commits. Do not push.

## Stack (fixed)
- Next.js 14 (App Router) + React 18 + TypeScript strict, `src/` dir, alias `@/*` → `src/*`.
- Tailwind CSS 3 + hand-written shadcn/ui-style components in `src/components/ui/*` (Radix primitives, `cva`, `tailwind-merge`, `clsx`). Icons: `lucide-react`.
- Charts: Recharts. Grids: TanStack Table v8.
- Prisma 5. **Local DB = SQLite** at `prisma/dev.db` (no Docker on this Mac). JSON stored as `String` columns with typed helpers. A Postgres+pgvector schema variant and `docker-compose.yml` are provided for phase two.
- Auth: NextAuth v4, JWT sessions, httpOnly cookies. Providers: dev "magic link" (Credentials: email → signs in seeded/known users; logs a simulated magic link to the server console) and Google if `GOOGLE_CLIENT_ID` is set.
- AI: provider interface (Claude / Gemini / Mock). Keys from user settings (AES-256-GCM encrypted in DB) or env. Missing key → Mock provider with realistic canned synthesis + citations.
- Tests: Vitest (`npm test`).
- Fonts: Inter + JetBrains Mono via `@fontsource-variable/inter` and `@fontsource/jetbrains-mono` (offline-safe).

## Design system
Dark-first, charcoal, institutional-modern (not Bloomberg orange-on-black). Tokens as CSS variables in `src/app/globals.css`, mapped in `tailwind.config.ts`:
- `--bg #0b0d10`, `--panel #12151a`, `--panel-2 #171b21`, `--border #242a33`, `--text #e7eaee`, `--muted #8a93a3`
- `--accent #ff8a1f` (subtle orange, primary CTAs/active nav), `--info #3b82f6` (electric blue: links, citations, focus rings)
- `--up #22c55e`, `--down #ef4444`, `--warn #f59e0b`
- Light mode via `[data-theme=light]` optional; dark is default.
Rules: skeletons for loading (never spinner-only), helpful empty states with next action, tabular mono numbers, WCAG AA contrast, visible focus rings, keyboard reachable.

## Layout (owned by foundation)
`src/app/(app)/layout.tsx`: three columns on desktop
- Left: collapsible sidebar — nav (`src/config/nav.ts`), watchlist, saved screens.
- Center: page content.
- Right: **context rail** for citations/sources/context; pages push content via `useRightRail()` (`src/components/shell/RightRail.tsx`); hidden when empty.
- Global **AI chat slide-over** (`src/components/ai/ChatPanel.tsx`), toggled by ⌘J / topbar button, from every screen.
- Topbar: ticker search (⌘K), plan badge + AI usage meter, mock-data indicator, user menu.
- `?` opens keyboard shortcut overlay (`src/components/shell/ShortcutOverlay.tsx`, registry in `src/lib/shortcuts.ts`).
- `<MockBanner/>`: small banner on any screen whose data `isMock`.
- Mobile: single column + bottom tab bar (Dashboard, Research, Screener, Portfolios, Shared).

## Routes
| Route | Owner |
|---|---|
| `/login` | foundation |
| `/dashboard` | E |
| `/company/[ticker]` | A |
| `/research`, `/research/[threadId]` + global ChatPanel | B |
| `/screener` | C |
| `/portfolios`, `/portfolios/[id]`, `/baskets`, `/baskets/[id]` | D |
| `/shared`, `/shared/[token]` | E |
| `/settings` (plan toggle, AI keys, usage, team) | E |

## Data layer (owned by foundation) — `src/lib/data`
`MarketDataProvider` interface; every return value includes `meta: { source: SourceRef[]; isMock: boolean; asOf: string }`.
`SourceRef = { id: string; name: string; url?: string; kind: 'filing'|'transcript'|'news'|'price'|'estimate'|'ownership'|'mock'; excerpt?: string; locator?: string }`.
Methods: `getUniverse()`, `getQuote(t)`, `getQuotes(ts)`, `getHistory(t, range)`, `getProfile(t)`, `getFinancials(t, period)`, `getEstimates(t)`, `getInsiders(t)`, `getInstitutional(t)`, `getNews(t?)`, `getFilings(t)`, `getCatalysts(t?)`, `getScreenRows()`.
Provider chain (composite, per method, first success wins): **Polygon** (`POLYGON_API_KEY`) → **Nidhiksh local cache** (read-only `better-sqlite3` on `NIDHIKSH_DB_PATH`, default `../../Nidhiksh Markets/runtime/market.sqlite`; tables `instruments`, `price_bars` (provider 'alpaca', adjustment 'split', timeframe '1d'), `fundamentals` (provider 'sec' JSON payload), `news_events`, `filings`) → **SEC EDGAR** live for filings (`SEC_USER_AGENT`) → **Mock** (deterministic seeded 50-stock universe in `src/lib/data/mock/*`, plausible tickers/prices/filings/news). Never throw to the UI for missing data.
Server-only: `import 'server-only'` in data, ai, crypto modules. Keys never reach the client.

## Platform libs (owned by foundation)
- `src/lib/db.ts` Prisma singleton; `src/lib/repos/*` repository interfaces (portfolio, screen, research, share, usage, audit).
- `src/lib/auth.ts` (NextAuth options, `getSessionUser()` returning `{id, orgId, email, name, role, plan}`), `src/middleware.ts` protects `(app)` routes.
- `src/lib/plans.ts`: tiers `FREE | PRO | PRO_PLUS` (+ prices: Pro $50/mo or $500/yr; Pro Plus $100/mo or $1,000/yr). Limits: FREE: 3 deep dives/day, 5 positions, no AI; PRO: 100 AI queries/mo, 50 positions, 1 workspace, sharing; PRO_PLUS: unlimited AI, unlimited positions, custom basket sharing, 5 seats, priority refresh. `assertFeature(user, feature)` / `checkLimit(user, limit)` server-side; returns structured `{allowed, reason, upgradeTo}` for non-blocking upgrade prompts (`<UpgradeHint/>` inline component, never blocking modals). Stripe skipped: **plan toggle** in settings updates the user's plan.
- `src/lib/usage.ts` monthly AI query counter; `src/lib/cache.ts` in-memory TTL cache (5 min default) behind `Cache` interface; `src/lib/rate-limit.ts` in-memory token bucket behind interface; `src/lib/audit.ts` audit log for data access + AI queries; `src/lib/crypto.ts` AES-256-GCM with `ENCRYPTION_KEY`; `src/lib/log.ts` JSON logs with correlation id (`x-correlation-id`); `src/lib/jobs.ts` in-process queue interface (BullMQ later); `src/lib/csrf.ts` (same-origin check on mutations) + `src/lib/http.ts` route helper `withApi(handler, {auth, rateLimit, audit})` that applies auth, CSRF, zod validation, rate limiting, correlation id, error shape `{error:{code,message}}`.
- `src/lib/sanitize.ts` for user text.
- Every table has `orgId` + indexes on ticker/sector/date/userId.

## Rules for feature agents
1. Only create/edit files in your owned paths. Shared files (`prisma/schema.prisma`, `package.json`, shell, nav, platform libs) are read-only for you — if you truly need a change, list it in your final report.
2. No `npm install`. Every dependency is pre-installed by foundation; if something is missing, report it.
3. `npx tsc --noEmit` errors in your files must be zero; ignore errors clearly in other agents' in-progress files.
4. Use `withApi`, `getSessionUser`, `assertFeature`, the data provider, `useRightRail`, `MockBanner`, UI components. Do not create parallel versions.
5. Verify with the running dev server on http://127.0.0.1:4200 (curl API routes with a session cookie from `scripts/dev-login.mjs` or check pages render). Write Vitest tests for your critical logic in `src/**/__tests__`.
6. Label mock data, cite sources on every number you can, no investment advice wording; show "research only — not investment advice" where conclusions appear.
