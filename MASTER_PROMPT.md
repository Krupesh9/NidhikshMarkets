# NIDHIKSH MARKETS — FINAL MASTER BUILD PROMPT (v2)

**Mandatory companion specifications:** Read `INSTITUTIONAL_STANDARDS.md`, `PRIVATE_PARTNER_ACCESS.md`, `DATA_SOURCES_AND_RIGHTS.md`, `ARCHITECTURE_AND_ROADMAP.md` and `NAS_DXP2800_SETUP.md` before coding. All are binding; if in doubt follow the stricter security, licensing, or point-in-time correctness rule. Deliver real working code, not just architecture documents.


You are a senior full-stack engineer, financial data engineer, quant researcher, and premium fintech product designer. Build a **working, private, personal-use desktop-first market intelligence application**, not a static mockup. Follow this specification, implement in small verified milestones, and report actual tests and limitations. Do not claim data is live unless confirmed.

## Non-negotiable scope
Phase 1 ONLY: excellent desktop UI, real permitted free data, 12 months historical daily candles, global market overview, stock research, news/filings, chart annotations for candidate entry/exit signals, user-configurable indicators, SQLite persistence. **NO paper-trading execution, order placement, real-money trading, subscription billing, mobile native app, multi-tenant platform, or backtesting engine in Phase 1.** Signal history inspection and next-day/5-day/20-day outcomes may be added only after core features work; label retrospective analyses and avoid future leakage. Keep future modules documented but disabled.

## Visual references
Use `assets/white_ui_reference.png` as primary visual inspiration. Use `assets/dark_ui_reference.png` for optional dark theme. These are conceptual images with fabricated prices/headlines: NEVER use their example values as market data. Create an original polished UI with generous whitespace, excellent typography, subtle motion, and responsive desktop widths. Avoid crowded terminal grids, flashy animations, excessive cards, and misleading green/red signal certainty.

## Brand and interaction design
- Brand: **Nidhiksh Markets**. Premium white private-banking UI by default, dark navy toggle. Manrope interface, Sora headings, IBM Plex Mono tabular numerals for prices/metrics. Self-host/subset fonts and honor reduced motion.
- Restrained 120–220ms animations, lazy-loaded heavy panels, no perpetual effects, efficient chart updates and cache. Optimize performance and measure actual latency; never invent performance results.

## Stack
- Next.js App Router, React, TypeScript, Tailwind CSS, accessible components, theme toggle
- TradingView Lightweight Charts (check license and required attribution); OHLC candles, line/area, volume, SMA overlays, separate RSI pane, and marker overlays
- Python 3.12+ FastAPI, Pydantic, SQLAlchemy 2, Alembic, pandas/numpy, httpx
- SQLite with WAL, foreign keys, indexes, migrations, UTC ISO timestamps; backend owns all DB writes
- Docker Compose REQUIRED for UGREEN NASync DXP2800 deployment, plus native macOS development support; `.env.example`, README, scripts, tests
- No paid SaaS or API subscriptions required for core local development

## UI navigation
Home (Global Overview), Markets, Watchlists, Research, Signals, News & Filings, Settings. Search command palette for symbols and actions. Default light theme; dark toggle. Simple / Technical / Pro preset. Persist theme, layout, watchlist, indicators, time range, and chart type.

## Home layout
Top: US / Asia / Europe benchmarks, VIX, US 10Y, oil, gold, data freshness and market-session status. Left: searchable ticker/watchlist. Center: selected stock, quote and as-of time, large chart, 1D/5D/1M/3M/6M/1Y/3Y/5Y buttons (only enable supported granularities), candle/line toggle, indicator chips, entry/exit candidate markers anchored to bar time/price. Right: concise three-insight summary, expandable fundamentals, news, filings and insider activity. Provide clear skeletons, empty/error/stale states. Never fabricate market values or news. Mark proxies (e.g. EWJ for Japan) as proxies, never official index values.

## Indicator Studio
SMA selectable 20,30,50,90,100,200; EMA; RSI default 14 with configurable thresholds 30/70; Bollinger Bands 20/2; MACD 12/26/9; ATR 14; relative volume 20. Allow Simple/Technical/Pro and custom named presets; preview changes before Save/Apply; per-user local settings. Use adjusted price history appropriately and document formulas. Chart must not visually obscure the candles.

## Starter universe
Individual stocks NVDA, AAPL, AMD, MSFT, TSLA. ETFs SPY, QQQ, DIA, IWM, SMH, SOXX, SOXL, VNQ, TLT, IEF, BND, GLD, EWJ, INDA, FXI, EEM. REIT examples O and PLD. VIX, Nikkei 225, Nifty 50, Hang Seng, CSI 300, DAX and other official indices only when a permitted provider supplies them; otherwise use explicitly labeled proxies or unavailable. Mutual funds may have daily NAV only; do not invent intraday candles. Treat leveraged SOXL as a daily-reset leveraged ETF.

## Provider architecture / licensing
Create typed provider-neutral interfaces for historical bars, quotes, fundamentals, market benchmarks, news metadata, macro observations, SEC filings. Provider records must carry source, observed_at, fetched_at, exchange timezone, delay, license/usage category, adjustment mode, and status. Per-provider caching and rate-limit handling. Implement:
1. Alpaca official free Basic API: user registers free and supplies keys. Prioritize 12 months of daily OHLCV and permitted 15-min-delayed SIP history, plus IEX live where entitled; clearly distinguish IEX from consolidated volume. Batch calls, backoff, avoid rate-limit assumptions.
2. SEC EDGAR public data (no API key): use descriptive User-Agent and respectful rate limits; company filings, Forms 4, 8-K, 10-Q/10-K and 13F with filing/publication times; no material nonpublic information.
3. FRED (free API key): rates, Treasury yields, inflation, macro; record release dates and revisions.
4. GDELT free news discovery: title, source, URL, published time, company mapping; original links only; avoid scraping copyrighted article bodies.
5. Optional Yahoo Finance/yfinance adapter DISABLED by default and gated for personal research only after reviewing terms. Do not scrape Robinhood, CNBC, Bloomberg or TradingView internal endpoints, bypass auth, or redistribute restricted feeds.
6. Missing/unavailable data must be visibly labeled; never silently substitute another source.
Provider failures must not crash the UI; use last cached data with clear stale badge and timestamp.

## Signal research (not trading advice)
Implement three **configurable, unvalidated** candidate signal strategies:
A. Trend: entry when price > SMA200, SMA20 > SMA50, RSI crosses above 50; exit candidate when close < SMA20 or RSI crosses below 45.
B. Mean reversion: entry candidate when price moves below lower BB with RSI <30 and subsequently closes back inside; exit candidate at mid-band or RSI >55.
C. Breakout: entry candidate on close above PRIOR 20-session high with relative volume >1.5; exit candidate below trailing prior 10-session low.
Use bar-close signals, next-bar execution assumptions for future Phase 2 only; no future data, no repainting. Show marker tooltip: time, source bar, condition-by-condition evidence, strategy version, and 'research candidate — not a guaranteed trade'. Separate observed historical signals from hypothetical forward signals. Do not show fabricated win rates.

## Data model
SQLite schema/migrations for instruments, exchanges, price_bars (unique instrument+timeframe+timestamp+provider+adjustment), corporate_actions, fundamentals, economic_series, news_events, filings, insider_transactions, watchlists, indicator_presets, strategy_definitions, signal_events, provider_status, ingestion_runs, app_settings. Include indexes and provider provenance. Starter `market_terminal.sqlite` is a reference; inspect and migrate rather than blindly overwrite. Do not include paper-trading tables now.

## API endpoints (suggested)
GET /health, /providers/status, /instruments/search, /markets/overview, /instruments/{symbol}/bars?timeframe=1d&range=1y, /instruments/{symbol}/quote, /instruments/{symbol}/fundamentals, /instruments/{symbol}/news, /instruments/{symbol}/filings, /instruments/{symbol}/signals, /settings, /watchlists, /presets. POST /admin/refresh and CRUD for settings/watchlists/presets. Validate inputs and restrict admin endpoints to local/private use.

## Build order and acceptance tests
1. Scaffold frontend/backend, local startup, SQLite migration, env sample, tests. Build static polished layout using clearly labeled fixtures.
2. Alpaca integration with 12 months real daily bars for five stocks, SQLite persistence, retries and as-of timestamps. Verify real API response and database counts.
3. Chart interactions: candle/line, 1M/3M/1Y/5Y when available, volume, SMA/RSI/BB, settings persisted and marker tooltip. Unit-test indicator calculations using independent known reference series.
4. Global overview with real permitted indices or explicit ETF proxies; FRED macro; market calendars, session status, timezone and delay.
5. SEC filings and GDELT headlines, deduplication, provenance and source links.
6. Signal candidates on actual bars, no look-ahead; golden tests, deterministic signals, missing-history behavior.
7. Polish accessibility, keyboard shortcuts, fast chart rendering, error/loading/stale states, Playwright screenshots, README.

## Operational rules
Do not put API keys in client code, public GitHub, screenshots or logs. No claims of real-time SIP without entitlement. Don't promise 'news before the media'. Never use insider nonpublic data. No live brokerage orders or paper execution in Phase 1. Explain that a private demo to prospective investors can still raise contractual data-display questions; check provider terms before sharing credentials or displaying to a group. All mock UI numbers must be labeled demo. Source licensing must be reviewed before public commercialization.

## Required output from coding agent
Working code, reproducible setup, .env.example, migrations, unit/integration tests, screenshot(s) of real running UI, API/provider status screen, known limitations, and prioritized Phase 2 roadmap (backtesting, paper trading) / Phase 3 (licensed feeds, subscriptions, mobile, brokerage partnerships). Build and verify, not merely describe.


## REQUIRED: UGREEN NASync DXP2800 private deployment (Phase 1)
The owner has a UGREEN NASync **DXP2800** on a private local network and a MacBook with VS Code, Claude Code and Codex. The owner states their local development agents can access the relevant folder and NAS; DO NOT assume access until you verify it. Prioritize a secure, self-hosted NAS deployment with no AWS, public GitHub Pages, or paid cloud hosting.

### Deployment topology
- Develop and test on MacBook; source in **PRIVATE** GitHub repo `nidhiksh-markets`. Never make repo public. Do not commit `.env`, credentials, SQLite DB, backups, logs, market-data cache, or NAS mount details.
- Run Next.js production frontend and Python FastAPI backend as separate containers on DXP2800 using UGOS Pro Docker/Compose or an equivalent supported Docker Engine/Compose installation. Check the actual installed Docker support and host CPU architecture before selecting images.
- Run SQLite on the NAS **local persistent volume on its own filesystem**, NOT on a Mac SMB/NFS share. Use a single backend writer and WAL mode only if filesystem supports it; ensure transactional backups and migration handling. Do not run multiple concurrent backend replicas writing SQLite.
- Use NAS private storage directories for app data, historical OHLCV, news metadata cache, logs, and backup archives. Create directories only after confirming exact NAS paths and permission model; do not invent `/volume1` or any model-specific location.
- NAS runs scheduled collectors and signal calculations even when MacBook is off. Add provider throttling, timestamps, backoff, health checks, container restart policies, and retention settings.
- Bind frontend to a private LAN interface or localhost behind a private access gateway as appropriate; **do not expose FastAPI, database, Docker daemon, or NAS administration to the public internet**. Never configure router port forwarding, UPnP, public tunnels, public DNS, or public NAS sharing.
- Protect app with authentication even on LAN. For future invited investor access, propose Tailscale with individual identities, device/user ACLs, least privilege and an additional application auth layer. Do not grant guests NAS admin or unrestricted LAN access. Remote access is **optional and disabled by default**.
- Treat NAS management services and the application as separate security boundaries. Secrets stay in private env files or a supported secrets mechanism with restrictive permissions; API keys only backend-side.
- Provide backups to a separate destination and test restoring them. NAS RAID/mirroring is not itself a backup. Avoid copying SQLite database files while actively writing; use SQLite online backup API or safe checkpointed snapshot procedure.

### Safe discovery and approval gates
1. Inspect repository and existing project before changes. Verify actual NAS reachability, UGOS Pro version, Docker/Compose availability, CPU architecture, free disk, RAM, and mapped folders using existing authorized connections.
2. If NAS access is missing, ask the owner for the NAS LAN hostname/IP, authorized access method (SSH/UGOS Docker UI/SMB), and non-admin deployment credentials. **Never ask the user to paste passwords or API keys into chat or code.** Do not bypass authentication.
3. Produce a short deployment plan showing container images, bind mounts, ports, data paths, permissions, backup strategy, and rollback steps.
4. Require explicit owner approval **before** installing packages, changing NAS settings, modifying firewall/Tailscale configuration, creating or deleting NAS folders, opening ports, or deploying/updating containers. Never overwrite existing NAS data.
5. After approval, deploy, run health checks, verify local access from MacBook, demonstrate restart persistence and backup/restore, and report the actual local URL and evidence. Never claim successful NAS deployment without verifying it.

### Deliverables
- `compose.nas.yml` and production Dockerfiles with architecture-compatible images and health checks.
- `compose.dev.yml` for MacBook development.
- `.env.example`, `.gitignore`, `NAS_DXP2800_SETUP.md`, `LOCAL_MAC_SETUP.md`, `BACKUP_AND_RESTORE.md`, and `SECURITY.md`.
- Makefile or scripts: `setup`, `dev`, `nas-config-check`, `deploy-nas` (requires confirmation), `stop`, `logs`, `health`, `refresh-data`, `backup`, `restore-test`, `rollback`.
- A deployment acceptance checklist: local-only access, auth required, no internet-exposed ports, source/DB persistence, secrets excluded from Git, five-stock data working, signal markers anchored correctly, collectors survive MacBook shutdown, backups verified.

### Future architecture (do not implement now)
Phase 2 adds rigorous walk-forward backtesting, paper trading, risk analytics, PostgreSQL/TimescaleDB migration planning. Phase 3 adds properly licensed direct exchange/consolidated data, cloud/multiuser scalability, subscriptions, mobile and brokerage integrations. Investor demonstrations must respect data provider usage/redistribution terms even if private.
