# NidhikshDesk — Product spec (Phase One)

## Problem
Fundamental analysts spend much of their day stitching context together by hand. Prices come from one terminal,
filings from EDGAR, transcripts from a third tool, and the portfolio lives in a spreadsheet. Notes end up in chat
threads, so the reasoning behind a call is scattered and hard to cite. Terminal seats are expensive, and generic AI
chat tools answer without sources.

NidhikshDesk gives analysts one keyboard-driven workspace. Every number is sourced, AI answers come with citations,
and research can be shared across the team.

## Users
| Persona | Needs |
|---|---|
| **Portfolio manager** (e.g. `pm@`, Pro Plus) | Book-level exposure and risk, quick reads on why names are moving, a team research feed |
| **Equity analyst** (`analyst@`, Pro) | Fast deep dives, filings and transcripts with citations, screens, theses to share |
| **Intern / junior** (`intern@`, Free) | Learning the coverage universe with limited deep dives and no AI |

## Five features
1. **Company deep dive** (`/company/[ticker]`): profile, price history, financials, estimates, insiders,
   institutional holders, filings, transcripts, news and catalysts. Every figure links to its source in the right rail.
2. **AI research** (`/research`, plus the global ⌘J chat panel): ask questions in plain language. The model calls the
   data tools and answers with numbered citations and inline tables and charts. Notes can be saved and shared.
   Providers are Claude, Gemini or Mock.
3. **Screener** (`/screener`): filter the universe by valuation, growth, quality and catalysts. Each row has a
   cited "why now" line. Screens can be saved, and Pro and up can export them to CSV or Excel.
4. **Portfolios and baskets** (`/portfolios`, `/baskets`): positions, P&L, sector and country exposure versus a
   benchmark, and thematic baskets with target weights and rationale.
5. **Dashboard and sharing** (`/dashboard`, `/shared`): market overview, watchlist, catalysts and a team feed. Share
   notes, screens, portfolios, baskets and threads with your org or by link, and comment on them.

## Pricing
| Plan | Price | Highlights |
|---|---|---|
| Free | $0 | 3 deep dives/day, 5 positions, no AI |
| **Pro** | **$50/month or $500/year** | 100 AI queries/month, 50 positions, 1 workspace, sharing and export |
| **Pro Plus** | **$100/month or $1,000/year** | Unlimited AI and positions, custom basket sharing, priority refresh, 5 seats |

Phase One uses a **plan toggle** (mock billing) instead of Stripe. Upgrade prompts appear inline and never block the
page.

## Non-goals (Phase One)
- Trading, order routing, broker connections, execution or any action that moves money.
- Investment advice, recommendations or price targets presented as advice. Where the app shows conclusions, it says
  "Research only — not investment advice".
- Real-time tick streaming, Level 2 data, options chains.
- Native mobile apps. The web app is responsive and has a mobile tab bar.
- Real billing, SSO/SAML and multi-region hosting. These are on the roadmap.
