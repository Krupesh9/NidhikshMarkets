# Data sources, registration and rights — implementation guide

Provider terms and limits change. Coding agent must check current official documentation at implementation time; do not hardcode historical plan limits as guarantees.

| Source | Credentials | Prototype use | Important caveat |
|---|---|---|---|
| Alpaca Market Data | Free account and API key | US equity/ETF historical OHLCV; eligible IEX quotes and delayed consolidated history | IEX != full-market SIP; plan entitlements and rate limits vary; private partner display may require separate rights |
| Yahoo Finance via yfinance | Generally no key | Optional disabled-by-default personal research adapter | Unofficial endpoints; terms/personal-use restrictions; fragile for production |
| SEC EDGAR | No API key | Public submissions, Form 4, 8-K, 10-Q/10-K, 13F | Use identifying User-Agent, polite requests, distinguish filed/publication and trade dates |
| FRED | Free API key | Macro, Treasury rates and economic series | Frequency, release lag and revisions differ; point-in-time vintage data where possible |
| GDELT | No key for public endpoints | Global news discovery and source URLs | Batch freshness, noisy entity matching, no guaranteed breaking-news edge |
| Company IR / press releases | Varies | Primary company announcements | Respect feed terms and robots; retain original link |
| Exchange/CTA/UTP/authorized vendor | Commercial agreements | Future licensed commercial phase | Venue coverage, real-time entitlements, redistribution, audits and usage reports |

Official starting points:
- Alpaca: https://docs.alpaca.markets/docs/about-market-data-api
- SEC: https://www.sec.gov/search-filings/edgar-application-programming-interfaces
- FRED: https://fred.stlouisfed.org/docs/api/fred/
- GDELT: https://www.gdeltproject.org/
- TradingView Lightweight Charts: https://tradingview.github.io/lightweight-charts/

## Refresh strategy
- Daily OHLCV: refresh after market close and reconcile adjustments/corrections. Backfill at least 12 months for five core stocks, then extend on demand.
- Intraday: only when supported and entitled; clearly label IEX vs delayed consolidated feed and query limits.
- SEC and company releases: modest polling with deduplication and source timestamps; never promise to beat professional news desks.
- GDELT news: poll no more often than meaningful upstream updates, with deduplication and entity mapping.
- FRED: update according to release schedule, not every second.
- Store fetch metadata, errors, retry-after, last success, data lag and entitlement notes. Show status in UI.

## Legal and product cautions
- A personal-use data entitlement is not automatically permission to show quotes to potential investors, even through an authenticated private link.
- Do not scrape authenticated Robinhood/TradingView/Bloomberg/CNBC application endpoints or bypass controls. Use documented integrations and approved source links.
- Insider activity means PUBLICLY DISCLOSED filings, not material nonpublic information. 13F holdings are reported with delay.
- A direct Nasdaq or NYSE connection alone may not give complete US consolidated coverage; commercial plan must assess CTA/UTP, other venues and vendor agreements.
