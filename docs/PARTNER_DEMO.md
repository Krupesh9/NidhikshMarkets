# Partner review on this Mac

The owner selected same-Mac access for the demo. Open http://localhost:3000 and sign in using the Viewer credentials in the private local `runtime/partner-login.txt`. Keep the owner/Admin credentials private. Use the Viewer account for the partner session.

The Viewer can explore the app and save their own watchlists/settings, with no ingestion or administrator privileges. Actual market-feed display remains gated until permissions are confirmed; synthetic demonstration mode is available. This account does not grant GitHub, NAS, filesystem or Docker access.

For source review after the demo, invite the partner to the private GitHub repository through its collaborator settings. Do not share API keys or runtime files. The completed demo is published on `main`; review #1 retains its change history.

GitHub Pages serves static sites ([official documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)). This application requires a running FastAPI service, protected sessions and persistent SQLite storage, so Pages alone is not a full application host. An approved private NAS deployment or other private backend/HTTPS arrangement is a separate post-demo step. No public hosting or network exposure has been configured.

To collect feedback now, use the app on this Mac and record the page, ticker, expected behavior and screenshot without credentials. The private source repository can also track follow-up issues once partner access is granted.

Prices now choose the newest valid market-event timestamp automatically for each stock across available intraday quotes and the daily-close fallback. There is one displayed price and no feed selector. Hover, focus or tap the small information icon for quote time, delay, limited exchange coverage and any cache/refresh pause. Headline, watchlist and market-summary prices share this selection; heatmaps, charts and historical candidates retain their labeled daily basis.
