#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
PYTHON="${PYTHON_BIN:-.venv/bin/python}"
# Resolve local source reliably after the workspace is moved.
export PYTHONPATH="$PWD/backend${PYTHONPATH:+:$PYTHONPATH}"
action="${1:-help}"
case "$action" in
 setup)
  if ! command -v "${BOOTSTRAP_PYTHON:-python3.14}" >/dev/null; then
   echo 'Python 3.12+ is required. On this Mac use BOOTSTRAP_PYTHON=/opt/homebrew/bin/python3 make setup.';exit 1
  fi
  "${BOOTSTRAP_PYTHON:-python3.14}" -c 'import sys;assert sys.version_info>=(3,12), "Python 3.12+ required"'
  if [ ! -d .venv ]; then "${BOOTSTRAP_PYTHON:-python3.14}" -m venv .venv;fi
  "$PYTHON" -m pip install --upgrade pip==26.3
  "$PYTHON" -m pip install -r backend/requirements.lock
  "$PYTHON" -m pip install --no-deps -e backend
  npm --prefix frontend ci --no-audit --no-fund
  if [ ! -e .env ]; then cp .env.example .env; chmod 600 .env;fi
  mkdir -p runtime artifacts
  chmod 700 runtime
  "$PYTHON" -m app.cli init
  ;;
 dev)
  if command -v lsof >/dev/null;then
   for port in 8000 3000;do
    if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1;then echo "Port $port already has a server. Stop the existing workspace services before make dev.";exit 1;fi
   done
  fi
  mkdir -p runtime
  if [ -f runtime/api.pid ] && kill -0 "$(cat runtime/api.pid)" 2>/dev/null; then echo 'API already running; use make stop first.';exit 1;fi
  NEXT_TELEMETRY_DISABLED=1 "$PYTHON" -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000 >runtime/api.log 2>&1 &
  api_pid=$!;echo "$api_pid" >runtime/api.pid
  NEXT_TELEMETRY_DISABLED=1 npm --prefix frontend run dev >runtime/frontend.log 2>&1 &
  web_pid=$!;echo "$web_pid" >runtime/frontend.pid
  echo 'Private local preview: http://localhost:3000. Login: runtime/first-login.txt.'
  trap 'kill "$api_pid" "$web_pid" 2>/dev/null || true' INT TERM EXIT
  wait
  ;;
 preview)
  if command -v lsof >/dev/null && lsof -nP -iTCP:3000 -sTCP:LISTEN >/dev/null 2>&1;then echo 'Port 3000 is already in use. Stop the existing frontend before starting preview.';exit 1;fi
  [ -f frontend/.next-build/standalone/server.js ] || { echo 'Run make build first.';exit 1; }
  preview_server="$("$PYTHON" scripts/prepare_preview.py)"
  mkdir -p runtime
  echo "$$" >runtime/frontend.pid
  echo 'Production preview: http://localhost:3000 (requires the local API on port 8000).'
  HOSTNAME=127.0.0.1 PORT=3000 BACKEND_URL=http://127.0.0.1:8000 NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 exec node "$preview_server"
  ;;
 stop)
  for name in api frontend;do
   if [ -f "runtime/$name.pid" ];then
    pid="$(cat "runtime/$name.pid")"
    case "$pid" in ''|*[!0-9]*) echo 'Invalid PID file';exit 1;;esac
    if kill -0 "$pid" 2>/dev/null;then
     command_text="$(ps -p "$pid" -o command=)"
     case "$command_text" in *'uvicorn app.main:app'*|*'npm'*'run dev'*|*'next dev'*|*'.next-build/standalone/server.js'*|*'/runtime/preview/'*'/server.js'*) kill "$pid";;*'next-server'*)
     process_cwd="$(lsof -a -p "$pid" -d cwd -Fn | sed -n 's/^n//p')"
     case "$process_cwd" in "$PWD/frontend/.next-build/standalone"|"$PWD/runtime/preview/"*) kill "$pid";;*) echo 'Refusing to stop a Next server from another workspace';exit 1;;esac
     ;;*) echo "Refusing to stop unexpected process in $name.pid";exit 1;;esac
    fi
   fi
  done
  ;;
 logs) tail -n 60 -f runtime/api.log runtime/frontend.log ;;
 health) "$PYTHON" -m app.cli health ;;
 refresh-data) "$PYTHON" -m app.cli refresh ;;
 backup)
  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  "$PYTHON" -m app.cli backup --path "${BACKUP_PATH:-backups/market-$timestamp.sqlite}"
  ;;
 restore-test)
  : "${BACKUP_PATH:?Set BACKUP_PATH to an existing backup file}"
  "$PYTHON" -m app.cli restore-test --path "$BACKUP_PATH"
  ;;
 reset-password) "$PYTHON" -m app.cli reset-password --username "${USERNAME:-owner}" ;;
 nas-config-check) "$PYTHON" scripts/nas_config_check.py ;;
 deploy-nas)
  "$PYTHON" scripts/nas_config_check.py
  printf 'This updates containers on the CURRENT Docker host. NAS discovery and exact paths must already be approved.\nType DEPLOY NIDHIKSH to continue: '
  read -r answer
  [ "$answer" = 'DEPLOY NIDHIKSH' ] || { echo 'Cancelled';exit 1; }
  docker compose -f compose.nas.yml build
  docker compose -f compose.nas.yml up -d --wait
  ;;
 rollback)
  : "${ROLLBACK_TAG:?Set ROLLBACK_TAG to the last verified image tag}"
  printf 'Type ROLLBACK NIDHIKSH to restart using the selected local images: '
  read -r answer
  [ "$answer" = 'ROLLBACK NIDHIKSH' ] || { echo 'Cancelled';exit 1; }
  IMAGE_TAG="$ROLLBACK_TAG" docker compose -f compose.nas.yml up -d --no-build --wait
  ;;
 *) echo 'Use: setup dev preview stop logs health refresh-data backup restore-test reset-password nas-config-check deploy-nas rollback';;
esac
