# Native Mac setup

1. Keep this complete project folder. Do not overwrite the existing `.env` or `runtime/`.
2. Use Python 3.12+ (this session used `/opt/homebrew/bin/python3`, Python 3.14.6) and Node 24.
3. First installation: `BOOTSTRAP_PYTHON=/opt/homebrew/bin/python3 make setup`. It creates a project-local venv, installs locked dependencies, migrates SQLite, seeds the starter universe and creates a unique owner login.
4. Run `make dev`, then open http://localhost:3000. Use `localhost` consistently: the configured CSRF origin is `http://localhost:3000`.
5. Open `runtime/first-login.txt` locally for the unique initial password. Use `make reset-password` to change it; all sessions are revoked. Never share this file.
6. Provider credentials are backend-only in `.env`. `SEC_USER_AGENT` is an app-name/contact-email label, not an API key. Restart the backend after `.env` changes.
7. Prefer the authenticated Settings refresh buttons while the backend is running. `make refresh-data` is a local maintenance command; avoid concurrent manual CLI collection and app refreshes.
8. `make stop` applies to processes launched by `make dev`. Servers started directly in Codex/terminal are stopped in their owning session. A busy port should be investigated, not killed indiscriminately.

Development binds frontend and backend to loopback only. Production Compose exposes only the frontend, with the backend internal. Do not put SQLite on an SMB/NFS share.

Generated outputs, `.env`, runtime DB, logs and backups are ignored by Git. No commit is created by setup or development commands.

`make build` uses `.next-build`; development uses `.next-dev`. Keep those separate when the preview is running. The native launcher sets the backend import path explicitly, so CLI and server imports do not depend on editable-package startup hooks.

Use Settings → Appearance → Auto · market hours for the requested day/night behavior. Markets contains Upcoming IPOs, heatmaps and the local scanner. Company-update banners remain visible until dismissed; dismissals do not delete news records.

For a steady demo preview, leave the local API running, stop the development frontend, then run `make build` and `make preview`. This serves the compiled standalone frontend on the same loopback URL. `make dev` remains the source-editing workflow. The production preview creates no external deployment.
