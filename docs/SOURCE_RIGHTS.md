# Source and display notes

These are implementation observations, not commercial redistribution clearance.

| Source | Local use / cache | Partner/public display |
| --- | --- | --- |
| Alpaca daily bars, assets, news | Documented authenticated endpoints; SIP delayed history, IEX explicitly partial. Raw and split-adjusted OHLCV stored separately. | Personal entitlement is not permission to display to investors; owner review required. |
| SEC EDGAR | Public submissions and companyfacts; identifying User-Agent; conservative request spacing. | Public disclosures; preserve dates, revisions and original filing links. |
| Alpha Vantage | Earnings and IPO schedule CSVs use one broad request and cache. OVERVIEW is currently premium-only and gated off by default. Conservative five-call daily app cap is shared; no repeated attempts on the free connection. | Personal research; check current plan and downstream rights before third-party display. |
| FRED | Key verification succeeded. Current API terms prohibit local caching without written permission; observations removed and collection gated off. | Do not display cached FRED data under the default configuration. |
| iShares / Invesco holdings | Public download/component data for IVV, QQQ, IWM. Current ETF holdings are **proxies**, not official index histories or licensed index values. | Review issuer terms before wider redistribution; no historical membership claims. |
| LogoAPI.sh / company site icons | Small company/issuer logos for researched symbols; caching permitted by logo provider terms, never bulk copy the entire catalog. | Marks belong to their owners; informational identification only. |
| GDELT | Headline metadata and discovery timestamps, no article bodies. Rate-limit response observed; pause respected. | Link to original publishers; discovery time is not publication time. |
| Yahoo | Disabled. No unofficial data scraping. | Requires separate terms review before any implementation. |

References: [Alpaca](https://docs.alpaca.markets/us/docs/about-market-data-api), [SEC](https://www.sec.gov/about/developer-resources), [FRED terms](https://fred.stlouisfed.org/legal/), [Alpha Vantage](https://www.alphavantage.co/documentation/), [LogoAPI.sh terms](https://logoapi.sh/terms), [Lightweight Charts](https://tradingview.github.io/lightweight-charts/docs).

Provider names are intentionally minimized in the research UI. Detailed provenance remains in API records and advanced connection details. TradingView chart attribution remains because the library requires it.

IPO issuer announcements retain links to the SEC-filed materials and issuer news, an observation timestamp and conditional schedule wording. They are not quotes, completed listings or final offer prices. News banners reuse cached headline metadata and do not promise every press release or breaking-news coverage.

Intraday price views: researched symbols are fetched in two distinct batches, latest IEX trades (limited exchange coverage) and consolidated SIP minute closes ending at least15minutes earlier. Per-feed caches/timestamps are retained; neither changes completed daily chart inputs. Both share the existing market-data request allowance. Wider partner display is not enabled by this feature.
