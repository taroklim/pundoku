#!/usr/bin/env bash
# Стенд самопроверки: собирает worktree, поднимает api (5600) и web (3600) на отдельной БД.
# Использование: stack.sh up | start | down | web-down | web-up | reset-db | drop
#   up    - createdb, install, build, migrate и запуск; start - только запуск уже собранного (сбрасывает и лимиты api в памяти).
# Переменные: WT (путь к worktree, по умолчанию /tmp/pundoku-ios/wt), DB (pundoku_ios), API_PORT, WEB_PORT.
# Останавливает ТОЛЬКО процессы, чьи PID записаны в $RUN/*.pid (никаких pkill по имени).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
WT="${WT:-/tmp/pundoku-ios/wt}"
DB="${DB:-pundoku_ios}"
API_PORT="${API_PORT:-5600}"
WEB_PORT="${WEB_PORT:-3600}"
RUN="${RUN:-/tmp/pundoku-ios/run}"
mkdir -p "$RUN"

stop_pid() {
  local f="$RUN/$1.pid"
  if [[ -f "$f" ]]; then
    local pid; pid="$(cat "$f")"
    kill "$pid" 2>/dev/null || true
    rm -f "$f"
  fi
}

alive() { [[ -f "$RUN/$1.pid" ]] && kill -0 "$(cat "$RUN/$1.pid")" 2>/dev/null; }

start_api() {
  alive api && return 0
  # exec: PID в файле - это сам node, а не оболочка-обёртка
  (cd "$WT/apps/api" && DATABASE_URL="postgres://localhost:5432/$DB" PORT="$API_PORT" NODE_ENV=development LOG_LEVEL=warn \
    SUDOKU_COM_BASE_URL=http://127.0.0.1:1 WEB_ORIGIN="http://127.0.0.1:$WEB_PORT" \
    exec nohup node dist/index.js >"$RUN/api.log" 2>&1) &
  echo $! >"$RUN/api.pid"
}

start_web() {
  alive web && return 0
  nohup node "$HERE/serve.mjs" "$WT/apps/web/dist" "$WEB_PORT" "$API_PORT" >"$RUN/web.log" 2>&1 &
  echo $! >"$RUN/web.pid"
}

case "${1:-}" in
  up)
    export DATABASE_URL="postgres://localhost:5432/$DB"
    psql -lqt | cut -d'|' -f1 | grep -qw "$DB" || createdb "$DB"
    (cd "$WT" && pnpm install --frozen-lockfile >/dev/null && pnpm build >/dev/null && pnpm migrate >/dev/null)
    # Мёртвый upstream -> сетка дня всегда из генератора: стенд детерминирован и не ходит в сеть.
    start_api; start_web
    sleep 2
    curl -fsS "http://127.0.0.1:$WEB_PORT/health" && echo " <- api via web OK"
    ;;
  start)
    start_api; start_web
    sleep 2
    curl -fsS "http://127.0.0.1:$WEB_PORT/health" && echo " <- api via web OK"
    ;;
  down)
    stop_pid web
    stop_pid api
    ;;
  web-down) stop_pid web ;;
  web-up) start_web; sleep 1 ;;
  reset-db)
    psql -qd "$DB" -c 'TRUNCATE devices, snapshots, device_links, sync_groups, daily_puzzles RESTART IDENTITY CASCADE' 2>&1 || true
    ;;
  drop)
    stop_pid web; stop_pid api
    dropdb --if-exists "$DB"
    ;;
  *) echo "usage: $0 up|start|down|web-down|web-up|reset-db|drop"; exit 2 ;;
esac
