# Implementation decisions and review log

## Scaffold, persistence and auth

Research review: no mock/reference prices or headlines enter actual market tables. Legacy starter inspected read-only (zero instruments/bars) and preserved; legacy import quarantines unknown feed/adjustment records. No execution, brokerage orders, paper ledger or backtest engine.

Architecture review: FastAPI modular backend; SQLAlchemy/Alembic, WAL/foreign keys/indexes; per-user storage; standard Argon2 verification and revocable opaque sessions. Same-origin proxy; no backend public container port. Runtime data is excluded from source control.

## History, indicators and candidates

Research review: five years plus warm-up requested in batched raw and split-adjusted history. Daily session completion uses exchange calendars. RSI/ATR use Wilder smoothing; BB population deviation; breakout excludes current high/low and volume from reference windows. Candidate events preserve evidence, parameter snapshots and version. Mean-reversion setup expires after three sessions and will not enter after its mid-band target is already passed (v1.1.0).

Architecture review: pure causal indicator/signal functions, immutable stored event keys, version-filtered reads, unit golden references, prefix invariance, split-scale, API isolation and backup tests. Chart badges are optional, strategy-specific and anchored to bar time/price. Profitable performance is not validated; no retrospective label reversal.

## Provider controls, news and macro

Research review: source coverage and available/fetched timestamps retained. GDELT rate-limited; an additional documented news source was verified. Current FRED storage restriction overrides the original caching plan; data removed and adapter storage gated. Forward P/E and analyst counts require actual profile data and remain empty if unavailable.

Architecture review: persistent attempt accounting, separate conservative provider budgets, retry/cooldown handling and local reads. Company search uses a cached asset directory, avoiding calls per keystroke. Provider failure retains cached research. Broad heatmap refresh reuses issuer holdings and batches recent bars.

## New market views

Research review: IVV/QQQ/IWM holdings are labeled proxies; unsupported/missing quotes remain gray. Heatmap sparkline uses actual cached recent daily closes. Earnings dates are scheduled, may change, and have no invented release time. S&P 500 is the default calendar scope; no unsupported global revenue ranking. Analyst consensus is separate from strategy candidates.

Architecture review: Chrome regression and isolated-user acceptance suites now cover layouts, pinned hover details, marker collisions, settings persistence, role isolation, outage recovery and sessions. The owner reauthorized local completion and the walkthrough; NAS deployment remains deferred.

## Local completion and provider boundaries

Research review: an analyst endpoint assumed available was verified against current official documentation as premium-only. Free-account calls are now blocked with a clear access reason; the app does not fill missing analyst counts with invented consensus. QQQ common/ADR/DRNY holdings are retained, giving 101 current holdings with actual cached prices. Corporate actions preserve day-level event dates, first-observed availability and revisions; current ticker associations do not establish historical identity. Upcoming IPOs remain conditional schedules, and the public issuer source is kept separately from the broad provider calendar.

Architecture review: Bollinger Save validates locally in one step rather than relying on an unexplained disabled button. Automatic theme uses the exchange session/calendar with local polling. News dismissals persist in per-user settings. Rate-budget status reflects an exhausted cap immediately, before an extra reservation attempt. Development/build outputs and native startup source paths are explicit. Dependency audits were rerun after updating the affected pip build tool. Runtime caches, private video, test reports and credentials stay ignored by Git.

## Partner-demo branch and price updates

Research review: latest IEX trades are explicitly limited-venue data, while the broad-market view uses completed consolidated minute bars at least15minutes old. Both retain source timestamps and keep daily charts/signals unchanged. Change percentages use a verified previous consolidated session close; missing/stale baselines or known split days suppress that comparison.

Architecture review: demand-driven per-feed caches persist attempt times, serialize refreshes, share batches across clients and enforce the existing request caps. A dual-feed loading race was reproduced by the browser test and fixed before shipping. Automatic appearance is checked against session changes, holidays and early closes. The owner authorized a private branch push and selected same-Mac partner demo access; no public or NAS deployment follows from that choice.
