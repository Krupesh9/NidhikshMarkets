# Nidhiksh Markets — Institutional research and enterprise standards

This document is normative. Implement these requirements alongside MASTER_PROMPT.md. If documents conflict, follow the stricter security, licensing, data-integrity or non-trading requirement and document the conflict.

## Two mandatory review lenses

**Investment research reviewer:** independently challenge financial methodology, data completeness, market structure assumptions, corporate actions, timestamp semantics, trading costs, statistical claims, survivorship and selection bias, and the interpretation of insider/institutional disclosures. Do not imply any actual Wall Street professional endorsed the product.

**Principal software architect:** independently challenge reliability, accessibility, latency, testability, threat model, dependency risk, data ownership, operational recovery, multi-user isolation, and migration readiness. Record both reviews in a DECISIONS.md log at each milestone.

## Data integrity and provenance

- Use UTC for internal timestamps and explicit exchange-local display timezone. Track `event_time`, `available_at` (first legally/publicly observable time), `ingested_at`, and `source_last_updated` separately. Do not conflate a trade date with the filing publication time.
- Preserve source, feed/venue coverage (IEX vs consolidated SIP), currency, timeframe, timezone, corporate-action adjustment, revision/version, entitlement/delay, and quality flags for each observation. Never label a partial feed as consolidated.
- Use canonical instrument IDs and symbol history. Handle ticker changes, delistings, splits, dividends, ETF distributions, trading halts, and exchange calendars; maintain raw and adjusted bars with explicit semantics. Never combine adjusted close with unadjusted OHLC for indicators.
- No future leakage: at historical timestamp T use only bars closed by T and facts available by T. A backfilled filing or restated earnings value must not appear before its actual release. Preserve provider payload metadata and deduplicate safely.
- Distinguish trade time, SEC acceptance/publication time, and time the system first observed a filing. 13F data is backward-looking and delayed. Form 4 reports disclosed insider transactions, not a real-time feed or material nonpublic information.
- Provide explicit stale, missing, delayed, proxy, revised, and error states. If a free provider lacks a benchmark (e.g. VIX, mutual fund intraday NAV, international cash index), show unavailable or a separately named ETF proxy. Never fabricate.
- Licensing matrix per provider: personal research, private partner display, caching, derived works, redistribution, commercial use, required attribution, and unresolved legal review. A private investor demonstration is not necessarily covered by a personal-use license. Use synthetic or appropriately licensed demo content where permissions are uncertain.

## Research signal standards

- Phase 1 candidate indicators and signal annotations are descriptive research, NOT an execution or profitability engine. Do not add win-rate, alpha, annualized returns, or confidence/probability percentages without valid evaluation methodology and evidence.
- Implement three versioned strategies from MASTER_PROMPT. Use pure, deterministic calculation functions. For crosses, use prior and current closed-bar values; for breakout, exclude the current bar from the prior high window. Define missing-data and warm-up periods.
- Every signal event must record instrument, strategy ID/version, parameter snapshot, timeframe, bar timestamp, evaluation timestamp, source/adjustment mode, evidence per condition, and algorithm version. No repainting historical markers from later data.
- Mark Entry Candidate and Exit Candidate on the corresponding chart candle, with tooltip/drawer explaining exactly why; never imply an order was filled. If no validated signal exists, display No Candidate.
- Add unit tests against independent fixture datasets, property tests for timestamp monotonicity and indicator warm-up, split/adjustment cases, and tests that perturb future candles to ensure earlier signals remain unchanged.
- Phase 2 design: point-in-time backtests, purged or chronological train/validation/test, walk-forward evaluation, survivorship-aware universes, benchmark comparisons, realistic fees/spread/slippage/market hours, and paper-trading ledger with deterministic fills. No Phase 2 implementation now.

## Security and private partner access

- Local MacBook development and UGREEN NASync DXP2800 production-style private prototype. Private GitHub source control does NOT secure a running site. Require auth for the web app and every API route; enforce server-side RBAC. Admin can manage system; Partner/Viewer can only view authorized research.
- Initial deployment: private LAN only, no WAN forwarding, no anonymous login, no default credentials. Optional remote access by explicit approval using Tailscale with restricted ACLs OR Cloudflare Tunnel + Access with carefully configured identity policies. Remote access disabled by default. Never expose UGOS, Docker daemon/socket, SQLite, or backend admin endpoints.
- Prefer proven authentication library/identity gateway over custom cryptography. Use secure HttpOnly SameSite cookies, CSRF defenses for state-changing endpoints, secure session expiry, login throttling, audit events, and optional MFA. Avoid embedding reusable API keys or secrets in client bundles, logs, screenshots, or Git.
- Rate limit and authorize every sensitive endpoint; constrain CORS; use HTTPS for any remote access. Keep external network dependencies outbound-only. Separate NAS administrative credentials from app identities.
- Never assume Claude Code/Codex has NAS access because a mounted folder exists. Discovery read-only; obtain explicit owner approval for storage, network, package, Docker and deployment changes. Never overwrite existing NAS data.
- Local NAS RAID is not a backup. Perform SQLite online backups and test restores to a separate directory/device. Provide rollback and incident-response notes.

## Architecture and scale pathway

- Modular monolith with typed interfaces for price providers, news, filings, macro, instruments, signals, auth and admin. Use provider-neutral DTOs and contract tests. Keep domain code independent of FastAPI routes and UI.
- SQLite single-writer with WAL on local NAS filesystem, indexed candles, migration versioning, bounded data retention, transaction boundaries and online backups. No SQLite on SMB/NFS shares. SQLAlchemy + Alembic to prepare migration to PostgreSQL/TimescaleDB.
- Background worker owns polling and signal calculation. Jobs must be idempotent, checkpointed, rate-limit aware and retry with bounded exponential backoff. Show provider health and last successful ingestion.
- Production growth: PostgreSQL/TimescaleDB for relational/time-series data, Redis only when caching/queueing warrants it, object storage for immutable historical files, optional ClickHouse for large tick-level analytics. Introduce queues and multiple workers only when measured load requires them. Oracle is not recommended for this stage.
- Future licensed direct-exchange and consolidated feeds require entitlements, redistribution rights, coverage across US venues, audits and compliance review. Do not assume one direct Nasdaq/NYSE feed provides all market prints.
- Add reproducible Docker builds, pinned dependencies, vulnerability scanning, migrations, integration tests, browser E2E tests, health/readiness checks, structured logs and documented deployment rollback.

## Premium UI and performance

- Default premium white UI; dark navy toggle. Manrope for text, Sora for display headings, IBM Plex Mono for market numbers with tabular numerals. Self-host/subset licensed font assets and use a graceful fallback. Avoid overly tiny labels and color-only meaning.
- Clear information hierarchy: global markets -> selected instrument/chart -> signal explanation -> expandable news/filings/fundamentals. Simple, Technical and Pro workspace modes; one-click chart style/range/indicator controls. No visual overload.
- Animate transforms/opacity sparingly, generally 120-220ms; respect prefers-reduced-motion. Avoid rerendering full chart on every quote. Use memoization, chart incremental updates, request caching, list virtualization and abortable stale requests.
- Define measurable budgets (targets, not claims): local chart interaction feedback <100ms on typical hardware, 60fps during simple transitions, and fast cached page navigation. Measure with browser profiling and record actual results; gracefully degrade under NAS load.
- Use semantic accessibility, keyboard navigation, contrast checks, error/skeleton/empty states, source timestamp and delayed-feed badges. Charts must remain readable without animations.

## Acceptance criteria

1. Real 12-month daily candles for NVDA, AAPL, AMD, MSFT and TSLA fetched from a permitted provider, persisted and verified against source responses; report any unavailable symbols.
2. Chart ranges, candle/line mode, indicators, signal markers, explainable evidence and saved settings work end-to-end.
3. SEC and news items link to original sources with actual timestamps and no invented articles.
4. User authentication and role isolation are tested, including direct API access by a Viewer.
5. Data source outage produces a stale/empty state, not a fabricated quote.
6. NAS deployment is only considered complete after owner approval, verified health checks, restart persistence, network isolation, and a tested backup restore.
7. Provide screenshots from the actual running application (concept reference images do not count), test results, source/license caveats and an honest known-issues list.
