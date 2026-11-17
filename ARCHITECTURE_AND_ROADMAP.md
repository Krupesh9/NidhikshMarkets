# Nidhiksh Markets — architecture and roadmap

## Architecture now
MacBook (VS Code, Claude Code/Codex) -> private Git repository -> verified Docker Compose deployment on UGREEN NASync DXP2800. NAS runs Next.js frontend, internal FastAPI backend, scheduled ingestion worker and a single-writer SQLite database on a NAS-local filesystem. Separate persistent data and backups; no database or admin ports exposed. Default local-only access; secure partner remote access only after separate approval.

### Backend bounded modules
- instruments and calendars
- price/quote provider adapters
- corporate actions and adjustments
- macro/benchmark adapter
- news and SEC filing ingestion
- technical indicators and versioned signal evaluation
- watchlists, presets, user settings
- authentication, authorization, audit
- provider status and ingestion administration

Keep provider DTOs independent of domain model and domain model independent of FastAPI routes. Migrations with Alembic. Use idempotent ingestion, uniqueness constraints and provenance. Back up SQLite with online backup API and restore test.

### Suggested repository
```
nidhiksh-markets/
  frontend/
  backend/app/{api,domain,providers,signals,db,auth,workers}/
  backend/tests/
  infra/{compose.dev.yml,compose.nas.yml,Dockerfile.frontend,Dockerfile.backend}/
  scripts/
  docs/
  assets/
  .env.example
  .gitignore
  README.md
```
Runtime data, `.env`, NAS credentials, backups and caches must be outside version control.

## Phase 1 — private working prototype
Premium white-first UI and dark toggle; chart with candlestick/line/area, time ranges and configurable indicators; five stocks with >=12 months daily bars where provider permits; watchlists; global overview with accurate proxy labeling; SEC and news; explainable historical candidate markers; source freshness; secure Admin/Viewer accounts; MacBook development and approved DXP2800 deployment. No paper execution, no actual trading, no claims of strategy profitability.

## Phase 2 — validated strategy laboratory
Point-in-time backtesting and walk-forward evaluation, slippage/spread/fees, realistic calendar and order assumptions, risk management, paper-trading ledger, portfolio analytics, monitoring and alerts. Migrate to PostgreSQL/TimescaleDB when concurrent workload and data size justify it. Validate against historical regimes and out-of-sample periods; no overfitting claims.

## Phase 3 — commercial platform
Licensed exchange/consolidated data, entitlements and audit reports; managed cloud deployment, high availability, queues/workers, multi-tenant authorization, subscriptions/billing, compliance and legal review, mobile experience, optional broker integrations. Additional data stores (Redis, object storage, ClickHouse) only when justified by measured demand. Direct NYSE/Nasdaq feeds alone do not necessarily supply all US consolidated prints.

## Quality gates
Each milestone requires both investment research review and software architecture review, working tests, actual screenshots/metrics, provider and license notes, and an explicit known-issues list. Separate "implemented", "tested locally", "deployed on NAS", and "verified remotely" statuses; never merge them.
