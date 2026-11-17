# Local acceptance evidence

This report covers the local Mac app. It does not claim NAS deployment or external display rights.

## Expanded end-to-end checks

`npm --prefix frontend run test:e2e -- acceptance.spec.ts`

Latest completed run: **4 passed in 11.3 seconds**, using installed Google Chrome and isolated temporary Admin, Viewer and expiring-session accounts. Test accounts, their settings, presets, watchlists and sessions are cleaned up. Owner preferences were not modified by this suite.

| Flow | Verified result |
| --- | --- |
| Viewer permissions | Admin routes and real market data denied; synthetic data allowed. |
| CSRF and origin | Missing CSRF and an untrusted origin are rejected. |
| Account isolation | Viewer cannot see/delete the test Admin’s private watchlist or preset; preferences remain isolated. |
| Persistent chart controls | Area chart and supported three-month range survive a reload. |
| Navigation | Watchlists, Research, Signals, News & Filings, Markets, scanner, Earnings Calendar and Settings render. |
| Scanner | Filtering local synthetic bars by SMA200 produces a rendered result. |
| Outage and recovery | A browser-injected 503 produces an explicit error and no fabricated chart; Retry renders source bars after the injected outage is removed. |
| Logout | Session is cleared and API access returns 401. |
| Expiry and revocation | Expired sessions redirect to login; revoked Viewer sessions return 401. |

The browser outage is a deterministic test fixture, not a real upstream outage. Provider/cache failure semantics are also covered by the backend suite. No provider refreshes are triggered by these acceptance tests.

The initial run coincided with a temporarily unresponsive development API. It was rerun after service health returned. Two test corrections used the appropriate app error selector and a supported demo range; neither required a product-code workaround.

## UI walkthrough

`node frontend/scripts/record-walkthrough.cjs`

The recorder creates a temporary Admin and authenticates before creating the recorded browser page. It uses already cached daily-close data, source-labeled schedules and real UI controls. No login screen, passwords, API keys, raw headers, or provider refreshes are recorded. Its temporary account is removed afterward.

Video: `artifacts/Nidhiksh-Markets-Walkthrough.webm` (ignored, private local file). The latest recording is **72.32 seconds**, 1600×1000 at 25 fps, with **zero page errors**, and demonstrates automatic single-price selection and readable dates. Representative extracted frames were inspected for Home, Indicator Studio, Upcoming IPOs, expanded heatmap, earnings week and Settings. The Indicator Studio caption sits above the form so its Save button remains visible. Final calendar footage shows the request-budget pause and disabled refresh while cached events stay available. All temporary acceptance/walkthrough accounts were confirmed removed afterward.

Chapter offsets are approximate:

| Time | Chapter |
| --- | --- |
| 0:01 | Research workspace and timestamps |
| 0:07 | Chart styles and ranges |
| 0:12 | Optional historical candidate markers |
| 0:18 | Bollinger settings and Save & apply |
| 0:24 | Company search |
| 0:29 | News and filings |
| 0:34 | Upcoming IPOs |
| 0:39 | Heatmap hover and sector details |
| 0:46 | Earnings week |
| 0:51 | Source connections and request budgets |
| 0:56 | Closing guide |

Machine-readable recording evidence is in ignored `artifacts/walkthrough-metadata.json`.

The original WebM retains captions without audio. The updated `artifacts/Nidhiksh-Markets-Walkthrough-Music.mp4` adds an original 112 BPM instrumental with gentle fades (H.264/AAC stereo, full decode verified, no clipping). The app itself remains silent. It is intended for the owner’s local review. Provider display rights still require review before wider sharing.

The matching Playwright video encoder was installed into ignored `artifacts/browser-tools`. To recreate it on another Mac:

```sh
PLAYWRIGHT_BROWSERS_PATH="$PWD/artifacts/browser-tools" frontend/node_modules/.bin/playwright install ffmpeg
node frontend/scripts/record-walkthrough.cjs
```

## Boundaries

Full market-feed entitlement, premium analyst coverage, newly listed ticker coverage, off-device restore, Docker image execution and NAS/remote deployment require their own evidence. Nothing in this report treats missing data as a passed feed integration. The owner subsequently authorized the verified private feature branch; source publication is separate from runtime deployment.

## Final integrated run

`make e2e`: **13 passed in 53.0 seconds**, against the compiled standalone preview. This includes the four acceptance tests above plus Bollinger persistence, auto-theme/news dismissal, layout/badge/pinned-tooltip regressions, refresh failure/timeout checks and general workspace flows. `make test`: **57 passed**. `make build`: TypeScript and production compilation passed. Package advisory audits returned zero findings; Docker OS-image execution/auditing remains outside this evidence.

The final browser tests wait for the requested history/badges and automatic session redirect, rather than racing asynchronous rendering/navigation. Product fixes include one401redirect at a time, collision-aware chart labels, pinned hover details, timer cleanup and explicit missing-issuer handling.

## Dual-feed branch verification

Latest app verification: **66 backend tests passed** and **14 Chrome E2E tests passed in55.2seconds**. Production compilation and clean-source TypeScript checking passed. The extra browser case verifies that consolidated-delayed and IEX price views remain separate from daily candles, Auto appearance changes from open/light to closed/dark, and price refresh requests stop at close or budget pause. The general browser fixtures suppress real intraday polling; the dedicated case uses explicit fixtures.

A separate live, authenticated two-request check returned **26/26researched symbols in each feed**. The service enforces one shared batch per feed per60seconds, across browser clients. At roughly780requests for a full regular session, both feeds remain subject to the conservative1000/day cap and source cooldowns.

The walkthrough is refreshed for these price cards. Its metadata separates manual source refreshes from normal automatic intraday requests; credentials and login remain excluded.

## Single-price and readable-date refinement

The current build removes both feed cards and automatically selects the newest valid market-event timestamp per symbol. Regression checks cover delayed/daily fallback, invalid/future quotes, consolidated timestamp ties, refresh failure cache retention, synthetic search isolation, accessible coverage information and regular-session Auto appearance. Dates use the requested month-day-year format with calendar-day preservation. Browser tests reuse source caches or explicit fixtures and do not spend provider allowance.

Final refinement verification: **66 backend unit/API tests passed in 4.71s**, **18 Chrome checks passed in 1.1 minutes**, and the production build/typecheck passed. The full browser rerun passed after updating one legacy ISO-date expectation and waiting for chart readiness before fallback assertions. An independent review found and confirmed fixes for retaining the newer GET cache on POST failure and isolating synthetic search from real directory prices. The current local preview uses the reviewed immutable build.

## Period comparison and direct theme toggle

Production build and typecheck passed. All **20 Chrome regressions passed in 1.3 minutes**, including the selected-range percent/dollar comparison, invalid baseline/missing quote handling, direct header light/dark switching without navigation, actual settings persistence and Auto session transitions. A dedicated temporary Viewer is removed after the theme regression; the owner’s preferences are preserved. No additional provider requests are introduced by the period comparison.
