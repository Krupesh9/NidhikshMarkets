#!/usr/bin/env bash
# NidhikshDesk smoke test: curls key pages and APIs on a running dev server and reports status codes.
#   bash tests/smoke.sh                       # against http://127.0.0.1:4200 as pm@nidhikshdesk.dev
#   ND_BASE_URL=http://127.0.0.1:4200 ND_EMAIL=intern@nidhikshdesk.dev bash tests/smoke.sh
# Exit code = number of failed checks (0 = all green). Requires: curl, node (for scripts/dev-login.mjs).
set -uo pipefail

BASE="${ND_BASE_URL:-http://127.0.0.1:4200}"
EMAIL="${ND_EMAIL:-pm@nidhikshdesk.dev}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
TIMEOUT="${ND_TIMEOUT:-60}"   # first hit on a page compiles it in dev mode
pass=0; fail=0

if ! curl -s -o /dev/null --max-time 10 "$BASE/api/auth/csrf"; then
  echo "Dev server not reachable at $BASE (start it with: npm run dev)"; exit 1
fi

COOKIE="$(ND_BASE_URL="$BASE" node "$HERE/scripts/dev-login.mjs" "$EMAIL" --raw 2>/dev/null)"
if [[ -z "$COOKIE" ]]; then echo "dev login failed for $EMAIL (is the DB seeded? npm run db:seed)"; exit 1; fi
echo "Signed in as $EMAIL against $BASE"
printf '%-6s %-44s %-6s %-10s %s\n' RESULT PATH CODE EXPECTED NOTE

# check <label> <method> <path> <expected codes regex> <auth: yes|no> [json body]
check() {
  local method="$2" path="$3" want="$4" auth="$5" body="${6:-}"
  local args=(-s -o /dev/null -w '%{http_code}' --max-time "$TIMEOUT" -X "$method")
  [[ "$auth" == yes ]] && args+=(-b "$COOKIE")
  [[ -n "$body" ]] && args+=(-H 'content-type: application/json' -H "origin: $BASE" --data "$body")
  local code; code="$(curl "${args[@]}" "$BASE$path")"
  if [[ "$code" =~ ^($want)$ ]]; then res=PASS; pass=$((pass+1)); else res=FAIL; fail=$((fail+1)); fi
  printf '%-6s %-44s %-6s %-10s %s\n' "$res" "$method $path" "$code" "$want" "$1"
}

# --- auth boundary ---
check 'login page public'               GET /login                     200     no
check 'protected page redirects'        GET /dashboard                 '307|302' no
check 'API rejects anonymous'           GET /api/me                    401     no
check 'NextAuth csrf endpoint'          GET /api/auth/csrf             200     no

# --- pages (signed in) ---
for p in /dashboard /company/AAPL /company/NVDA /research /screener /portfolios /baskets /shared /settings; do
  check 'page renders' GET "$p" 200 yes
done

# --- platform APIs ---
check 'session user + usage'            GET '/api/me'                               200 yes
check 'mock/live universe'              GET '/api/market/universe'                  200 yes
check 'quotes'                          GET '/api/market/quotes?tickers=AAPL,MSFT'  200 yes
check 'quotes validation'               GET '/api/market/quotes'                    400 yes
check 'watchlist'                       GET '/api/watchlist'                        200 yes
check 'mutation validation (no write)'  PUT  '/api/watchlist' 400 yes '{"symbols":"not-an-array"}'
# cross-origin mutation with a forged Origin header must be rejected before the handler runs
code="$(curl -s -o /dev/null -w '%{http_code}' --max-time "$TIMEOUT" -X PUT -b "$COOKIE" -H 'origin: https://evil.example' -H 'content-type: application/json' --data '{"symbols":[]}' "$BASE/api/watchlist")"
if [[ "$code" == 403 ]]; then pass=$((pass+1)); r=PASS; else fail=$((fail+1)); r=FAIL; fi
printf '%-6s %-44s %-6s %-10s %s\n' "$r" "PUT /api/watchlist (Origin: evil)" "$code" 403 'CSRF same-origin check'

echo "----"
echo "passed: $pass  failed: $fail"
exit "$fail"
