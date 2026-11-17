# Nidhiksh Markets

Private market research app: Next.js/React/TypeScript frontend, FastAPI/Python backend, SQLite with Alembic migrations. Local development is running at **http://localhost:3000**. Unique initial login: `runtime/first-login.txt` (local, ignored by Git).

**Start with [CLAUDE_HANDOFF.md](CLAUDE_HANDOFF.md) for the exact implementation status, remaining work, and latest user decisions.** Local unit/API and browser acceptance tests are implemented and run. A private captioned walkthrough is available in `artifacts/Nidhiksh-Markets-Walkthrough.webm`; see [acceptance evidence](docs/ACCEPTANCE_REPORT.md). NAS deployment remains deferred by the owner. The owner has authorized the verified `codex/partner-demo` branch for the private repository; main remains separate.

## Local setup

Python 3.12+ and Node 24 are required. On this Mac:

```sh
BOOTSTRAP_PYTHON=/opt/homebrew/bin/python3 make setup
make dev
```

On subsequent starts: `make dev`. In another terminal: `make health`, `make test`, `make build`. `make stop` stops processes started by `make dev`.

Copy `.env.example` to `.env` only if `.env` does not already exist. Fill in credentials locally; never paste them into chat or commit them. Existing configured `.env` must be preserved. Frontend receives no provider secrets.

## Included

- Authenticated private workspace with Admin/Viewer roles, server-side authorization, CSRF protection, session revocation, and login throttling.
- Supported US stock/ETF directory cached locally; company/ticker search; on-demand history ingestion and watchlists.
- Five-year daily chart ranges with extra indicator warm-up, candle/line/area icons, Simple/Technical/Pro tabs, Indicator Studio, saved per-user preferences.
- Optional Buy/Sell research badges with arrows, source-bar closing prices and evidence. Trend, mean-reversion, and breakout strategies are deterministic and **unvalidated**.
- S&P 500 / Nasdaq 100 / Russell 2000 heatmaps using explicitly labeled IVV / QQQ / IWM holdings proxies. Sector drill-down, table view and recent-price hover cards use cached data.
- Public news links, dismissible company-update banners, SEC filings, reported financial cards and source-aware valuation fields. Dismissals persist; new cached article IDs reappear.
- Month/week earnings views defaulting to S&P 500; largest-50 and personal-watchlist scopes, expected EPS where supplied.
- Upcoming IPOs under Markets: sourced expected dates, indicative ranges and filing links. A broad schedule is cached for 24 hours when fetched within budget.
- Auto appearance follows regular US market hours: light while open, dark when closed. Light/dark overrides remain available in Settings.
- Analyst-consensus gauge UI; Alpha Vantage OVERVIEW is currently premium-only. It is disabled for the free connection and no counts are fabricated. An entitled source is required for ratings/forward P/E.
- Separate latest-IEX and delayed-consolidated price cards. Both batch all researched symbols once per minute while regular markets are open and an Admin view is active; feed timestamps and coverage are explicit. Daily charts/signals remain daily.
- Persistent per-provider request accounting, cooldowns, conservative app caps and cache reuse. Search and chart interactions use cached data; automatic price polling uses only the shared batches described above.
- Docker Compose preparation, online SQLite backup and restore-test commands.

## Configuration

| Setting | Purpose |
| --- | --- |
| `ALPACA_API_KEY`, `ALPACA_SECRET_KEY` | Daily market data, asset directory, news |
| `SEC_USER_AGENT` | `Nidhiksh Markets your-real-email@example.com`; no SEC API key |
| `ALPHA_VANTAGE_API_KEY` | Optional earnings and IPO schedules; conservative shared app budget |
| `ALPHA_VANTAGE_OVERVIEW_ENABLED` | Defaults false; enable only for a subscription entitled to the premium company-overview endpoint |
| `FRED_API_KEY` | Key verified; local storage is disabled under current API terms |
| `INTRADAY_ENABLED`, `INTRADAY_REFRESH_SECONDS` | Enables both price caches; minimum60seconds, active/open-session refresh only |
| `COLLECTORS_ENABLED` | Defaults false; enables backend scheduled collection when explicitly set |
| `DEMO_ENABLED` | Isolated, clearly labeled synthetic demonstration mode |
| `PARTNER_DATA_DISPLAY_APPROVED` | Defaults false; Viewer access to real feed data requires rights review |

[Partner demo](docs/PARTNER_DEMO.md) · [Local setup](LOCAL_MAC_SETUP.md) · [Backup/restore](BACKUP_AND_RESTORE.md) · [Security](SECURITY.md) · [NAS checklist](NAS_DXP2800_SETUP.md) · [Decisions](DECISIONS.md) · [Source rights](docs/SOURCE_RIGHTS.md)

## Verification and limitations

Run `make test`, `make build`, then `make e2e` against the running app. The build output is isolated from the development server to protect preview assets. Unit/API checks include deterministic indicators/signals, rate limits, auth, persistence, migrations and backup/restore. Browser checks cover chart/indicator persistence, layouts, hover details, market-hour themes, news dismissal, roles, outage recovery and sessions. See the handoff and acceptance report for actual results and coverage boundaries.

Analyst data needs an entitled source. FRED storage stays off without written permission. Docker image execution, NAS/remote access and off-device backup remain unverified prerequisites, not completed deployment claims.

The intended source repository is `https://github.com/Krupesh9/NidhikshMarkets.git`. This folder is prepared locally; the authorized ready branch is `codex/partner-demo`. No external app publication or NAS deployment has occurred.
