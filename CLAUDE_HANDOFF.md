# Nidhiksh Markets — current local handoff

The owner reauthorized completion, parallel agents, E2E testing and the walkthrough on November 17, 2026. Local app work and discovered regressions have been addressed. **Latest authorization:** the owner requested parallel agents, the single newest price per stock, readable Nov 17, 2026 dates, an upbeat walkthrough soundtrack, and merging all verified changes into `main` in the private repository https://github.com/Krupesh9/NidhikshMarkets.git. External deployment is outside this authorization. NAS work remains explicitly deferred until after the demo.

## Running app and first actions

- Preview: http://localhost:3000. It now serves a compiled standalone build from an immutable `runtime/preview/<build-id>/` directory, so another build cannot replace its CSS/chunks mid-session. Frontend is loopback-only.
- API: http://127.0.0.1:8000, loopback-only, explicit `--app-dir backend`; current process was started directly in a Codex session with reload and private `runtime/api.log` logging. Native launcher exports the backend source path as well.
- Unique owner credentials: `runtime/first-login.txt`. **Never print credentials or `.env` contents.** Preserve the existing `.env`, runtime DB and backups.
- Read this file, MASTER_PROMPT.md and its mandatory companion specifications before further implementation. Read frontend/AGENTS.md and the relevant installed Next.js documentation before framework/API changes.
- `make preview` requires an existing API and `make build`; `make dev` is the source-editing workflow. Inspect existing processes before starting services. `make stop` only stops tracked processes and validates the process/workspace.
- `make test`, `make build`, `make e2e`, `make health`, `make backup` and `BACKUP_PATH=... make restore-test` are available. `make build` isolates output in `.next-build`, development uses `.next-dev`.

## Implemented local product

- Next.js 16 / React 19 / TypeScript; FastAPI / SQLAlchemy / Alembic; single-writer SQLite WAL. Self-hosted Manrope, Sora and IBM Plex Mono. Supplied transparent green/gold tree logo is the brand.
- Private Argon2 login, opaque revocable/expiring sessions, CSRF/origin enforcement, login throttling, Admin/Viewer roles and per-user settings/watchlists/presets. Multiple 401 responses now trigger one redirect rather than racing multiple navigations.
- Auto theme follows the regular US exchange calendar: light while open, dark otherwise, including holidays/early closes. Local session polling every 30 seconds makes no external provider requests. Explicit light/dark overrides remain in Settings.
- Local supported-US search directory, on-demand history for new tickers, actual cached logos or readable fallback. No claim of every global security or a pre-IPO price.
- Daily candle/line/area charts, supported 1/3/5-year ranges with warm-up, Simple/Technical/Pro tabs, SMA/EMA/RSI/BB/MACD/ATR/relative volume. Bollinger Save validates locally and saves in one step; preview is optional. Named presets persist.
- Three original deterministic, unvalidated historical strategies, v1.1.0. Buy/Sell badges are optional and source-bar-close anchored. Green ▲ Buy / red ▼ Sell plus price; no B/S abbreviations. Collision avoidance and connectors keep labels readable; overcrowded views advise zooming. No execution, backtest or profit claims.
- Heatmaps for S&P 500/IVV, Nasdaq 100/QQQ, Russell 2000/IWM and personal watchlists. Holdings are explicitly proxies, with sector drill-down and complete tables. Thin mouse-following hover strips show actual cached mini charts; Details pins the richer card until closed. Missing quotes stay neutral.
- Financial metric/fact cards, reporting periods and filing links. The freshest equivalent revenue concept is primary; older concepts remain expandable. No fabricated four-quarter EPS/P/E.
- News and filings use source timestamps/links. A company-update banner persists until dismissed; per-user dismissal IDs are stored, and newly cached articles reappear. This is cached metadata, not comprehensive/live press-release coverage.
- Earnings month/week views default to S&P 500; top 50 by ETF weight and watchlist scopes. Scheduled EPS/date only where supplied. No invented release times, revenue estimates or global revenue ranking.
- Upcoming IPOs under Markets: conditional debut dates, indicative price ranges, public filing/company links and ticker search. Verified Anthropic/ANT announcement is separate from the broad provider schedule. Its SEC-filed materials expected November 19 trading and November 18 pricing, subject to clearance; not a completed listing or quote.
- Persistent request accounting and cooldowns. Exhausted budgets immediately disable calendar/profile/IPO refresh actions and expose reset times. Long batches are paced against minute caps; all outbound attempts reserve a request before sending.
- Corporate-action pagination, validation, revision retention and observed symbol history. No automatic symbol renaming/merging or synthetic price readjustment. Raw/split prices remain separate, not total return.
- Current SEC ticker/CIK bulk association with 24-hour cache and one-hour failure cache. Ambiguous mappings are rejected. A missing issuer file (404) is isolated to that issuer/component, preserving other filings/caches and allowing the batch to finish. Authentication/rate-limit/transport failures still stop the batch.

## Actual latest data evidence

See ignored `artifacts/local-verification.json` for timestamped counts.

- 26 researched instruments; 13,212 directory entries; 79,618 raw/split daily bars.
- NVDA/AAPL/AMD/MSFT/TSLA each have 1,533 split daily bars, October 9, 2020–November 16, 2026. Available history supports five visible years plus warm-up; new listings only have actual available history.
- Heatmap holdings/priced/recent series: S&P 500 505/504/504; Nasdaq 100 **101/101/101**; Russell 2000 1965/1947/1947. QQQ now includes ASML/ARM/PDD ADR/DRNY rows, retaining original source/date provenance.
- 50 news records; 400 filings; 22 financial snapshots across 10 companies; 686 corporate actions; 847 earnings source events; 21 cached company/issuer logos plus three static official-site icons.
- 12 instruments have SEC CIKs after the bulk association. Latest SEC refresh completed with 410 processed records and explicit missing companyfacts for SPY/DIA. Missing fund companyfacts do not abort other issuers.
- No actual analyst-overview profile was returned. Current official documentation identifies OVERVIEW as premium-only; it is now gated off by default, rather than wasting free-account calls.

## Verification and artifacts

- Latest complete backend run: **66 passed**. Covers reference indicators, golden strategies, no-look-ahead/prefix invariance, corporate actions, SEC mapping/404 isolation, budgets/pacing, auth/roles/CSRF, persistence, calendar parsing, migrations and online backup/restore.
- Production build and TypeScript checks passed after app changes. Final integrated Chrome suite: **14 passed in 55.2 seconds against the compiled preview**. See `frontend/playwright-report/` and `docs/ACCEPTANCE_REPORT.md`. Earlier failed runs exposed synchronization/product issues that were corrected; this is the completed final run.
- Browser coverage: anonymous boundaries; roles/user isolation; expiry/revocation/logout; supported chart types/ranges; indicator/preset persistence; automatic theme; news dismissal; calendar/financial layouts; badge collisions; pinned tooltip and narrow viewport; simulated outage/retry and refresh timeouts. No provider refreshes are triggered by browser tests. Test outage/sessions/theme fixtures are distinct from live-source evidence.
- Chart measurements at 1Y/3Y/5Y: zero overlapping or clipped badges after the fix. Screenshots include `artifacts/ui-agent-chart-fixed.png`, `ui-agent-pinned-tooltip-fixed.png`, `ui-financials-fixed.png`, `ui-calendar-fixed.png`, `ui-heatmap-strip-fixed.png`.
- Captioned silent walkthrough: `artifacts/Nidhiksh-Markets-Walkthrough.webm`, 66.00s, 1600×1000, 12.34MB, zero page errors. Login and credentials are excluded. Chapters/metadata in `artifacts/walkthrough-metadata.json`; reproducible recorder `frontend/scripts/record-walkthrough.cjs`.
- Python and frontend dependency advisory audits returned zero findings after updating the affected pip build tool to 26.3. These are package audits, not a full penetration test or Docker OS-image scan.
- Frontend client-asset scan found zero configured provider-secret matches. Private credentials, DBs, logs, reports, videos and generated builds remain Git-ignored.
- Native health and script syntax passed. Compose YAML parsed and backend ports are unpublished; Docker execution was not verified because Docker is unavailable.

## External prerequisites / honest remaining limits

1. **Analyst ratings and forward P/E:** require a source/plan entitled to those fields. `ALPHA_VANTAGE_OVERVIEW_ENABLED=false` is the default; only enable after obtaining that entitlement. No paid purchase was made. Core research does not require it.
2. **Broad IPO schedule:** implemented with one broad CSV call and 24-hour cache, but its first live fetch is paused by the shared conservative Alpha Vantage cap (five/day). Verified issuer announcements remain visible. Do not reset counters or raise caps to bypass a pause.
3. **FRED:** key verified, storage disabled under current API terms without written permission. No observations retained. Do not enable merely because the key exists.
4. **Coverage:** source directory is supported active US assets, not every world stock. Some logos/quotes/XBRL facts are unavailable. Historical ticker membership/point-in-time fundamentals and total-return adjustments are not promised. Corporate-action publication times are first-observed where unknown.
5. **Docker/NAS/remote:** Dockerfiles and Compose are prepared, not executed/deployed here. NAS was deferred by the owner; address, filesystem, architecture and approved paths are unknown. No scans, installations, firewall changes or deployments occurred.
6. **Off-device backup:** online backup/isolated restore works locally; a separate physical destination remains required for disaster recovery. No destination was invented or silently selected.
7. **Future phases:** backtesting, trading/paper execution, paid subscriptions, licensed commercial redistribution and native mobile remain out of Phase 1 scope. Do not add them as cleanup.

## Source/implementation map

Backend: main.py API; providers.py registered HTTP/adapters; budgets.py accounting; ingestion.py jobs; indicators.py/signals.py calculations; sec_mapping.py/corporate_actions.py; heatmap.py/earnings.py/ipos.py/profiles.py; auth.py/models.py/cli.py. Migration head: b92e71a605c8 (separate intraday caches).

Frontend: Workspace.tsx; MarketChart.tsx; IndicatorStudio.tsx; Financials.tsx; Heatmap.tsx; EarningsCalendar.tsx; ResearchTooltip.tsx; AnalystGauge.tsx; UpcomingIPOs.tsx; Scanner.tsx. Styling is in globals.css with feedback-driven overrides; consolidate only with regression evidence.

Operations: scripts/manage.sh and prepare_preview.py; Makefile; infra Dockerfiles; compose.dev.yml/compose.nas.yml. See README, LOCAL_MAC_SETUP, BACKUP_AND_RESTORE, SECURITY, docs/SOURCE_RIGHTS, docs/ACCEPTANCE_REPORT and DECISIONS.

## Latest two-feed and partner update

The owner requested both free price views and authorized pushing the ready branch. `intraday.py` caches separate consolidated SIP minute closes delayed15–16minutes and latest IEX trades with limited exchange coverage. An active, visible Admin view requests one shared batch per feed per60seconds during regular hours; no outbound refresh while closed. Persistent per-feed attempt times and the existing Alpaca budget prevent duplicate browser clients spending extra calls. Daily chart bars/signals are unchanged. Live verification returned26/26symbols in both feeds. Two feeds can use roughly780requests per full regular session, within the1000/day appcap when other usage permits; caps/cooldowns remain authoritative.

`INTRADAY_ENABLED=true` and `INTRADAY_REFRESH_SECONDS=60` are configured only in the private local `.env`. Example defaults remain off. The new migration is b92e71a605c8, adding a separate price cache. Browser regression fixtures disable actual polling and mock both feeds explicitly.

A `partner` Viewer was created locally. Credentials are in ignored `runtime/partner-login.txt`, mode600; never print or commit them. No credentials were sent. Viewer market-data display is still gated; default demonstration mode is available. The owner selected same-Mac access for the demo. Post-demo GitHub Pages was suggested, but the full app needs a private backend/database host; no public publishing or network changes are authorized by the same-Mac choice. See docs/PARTNER_DEMO.md.

## Latest single-price demo refinement

The two price cards and feed selector are removed. The app compares actual market-event timestamps and displays one newest valid quote per stock in the headline, watchlist, market cards and search. Consolidated data wins timestamp ties; daily close is the fallback. A small accessible information icon describes delay, limited venue coverage, timestamp, stale data and request pauses. A successful cache read is retained even when a subsequent refresh fails; synthetic search never reuses real directory quotes.

Displayed dates use `dateLabel` (Nov 17, 2026); date-only values keep their exact calendar day, and timestamp displays retain ET time. Charts and historical research keep their daily basis. The updated 72.32-second walkthrough with original music is `artifacts/Nidhiksh-Markets-Walkthrough-Music.mp4`; no login or secrets appear. The app does not autoplay music.

Latest verification: 66 backend tests and 18 Chrome checks passed; production build/typecheck passed. The current preview serves the reviewed immutable build. The music video is 72.32s, H.264/AAC stereo, 3,665,410 bytes, with a full decode check and no clipping.
