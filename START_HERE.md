# Start here — Nidhiksh Markets (final handoff)

## What this package is
A complete build specification and starter artifacts for Claude Code or Codex. **Not a finished application or an already deployed NAS service.** All concept images contain illustrative figures and are not market data.

## Read in this order
1. `MASTER_PROMPT.md` — scope, UI, data integrations, research candidates, phased build.
2. `INSTITUTIONAL_STANDARDS.md` — binding financial correctness, security, performance and acceptance requirements.
3. `NAS_DXP2800_SETUP.md` — safe discovery, explicit approval gates and Docker deployment requirements.
4. `PRIVATE_PARTNER_ACCESS.md` — private partner login architecture and security constraints.
5. `DATA_SOURCES_AND_RIGHTS.md` — registration, refresh, provenance and license review.
6. `ARCHITECTURE_AND_ROADMAP.md` — boundaries, future database/scale pathway and milestones.
7. `assets/` — white-first and dark UI reference concepts.

## Tonight / tomorrow preparation
- Create a **private** GitHub repository named `nidhiksh-markets` (or work fully local first).
- Install VS Code, Claude Code or Codex, Git, Python 3.12+, Node LTS, Docker Desktop if supported by your Mac.
- Create a free Alpaca account; optionally request a free FRED API key. SEC EDGAR and GDELT do not require API keys for the documented public interfaces.
- Keep credentials only in `.env`/secrets storage, never in repository, chat, screenshots or frontend.
- Have authorized access to your UGREEN DXP2800 ready, but **do not change NAS settings until you approve the agent's plan**.

## Paste this to your coding agent

> Read MASTER_PROMPT.md, INSTITUTIONAL_STANDARDS.md, NAS_DXP2800_SETUP.md, PRIVATE_PARTNER_ACCESS.md, DATA_SOURCES_AND_RIGHTS.md, and ARCHITECTURE_AND_ROADMAP.md completely. Build Nidhiksh Markets Phase 1 as an actual working premium white-first application using Next.js, FastAPI, SQLite, and documented permitted free data. Begin locally on my MacBook. Build in tested milestones, show actual running screenshots and verified provider responses, and do not invent market data. Prepare NAS Docker Compose deployment for my UGREEN DXP2800, but perform read-only NAS discovery and ask for my explicit approval before any NAS change or deployment. Include secure private Partner/Viewer access and backend authorization. Do not build paper trading or paid subscriptions yet. Do not stop after writing a plan: implement and test the working app.

## Milestone sequence
1. Working local scaffold, migrations, auth skeleton and white UI.
2. Real five-stock 12-month daily candles, cached SQLite and interactive chart.
3. Indicators, candidate signal markers and evidence drawer with golden tests.
4. Global overview with labeled proxies, SEC filings, news, freshness monitor.
5. Private login/partner roles, operational checks, backup/restore.
6. NAS discovery report -> owner approval -> deployment -> verified LAN access and optional separate remote-access approval.

## Important constraints
A personal API plan may prohibit displaying data to a partner or potential investors; obtain rights or use synthetic/authorized demo data for such demonstrations. An HTTPS link alone is not private without authentication. No exchange-level real-time claims without entitlements. Future commercial scale is designed for, not implemented in Phase 1.
