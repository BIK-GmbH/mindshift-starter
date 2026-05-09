#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="$ROOT_DIR/.runtime"

stop_pid_file() {
  local name="$1"
  local pid_file="$RUNTIME_DIR/${name}.pid"
  if [[ -f "$pid_file" ]]; then
    local pid
    pid="$(cat "$pid_file")"
    if kill -0 "$pid" 2>/dev/null; then
      echo "▶ stopping $name (pid $pid)"
      kill "$pid" 2>/dev/null || true
      sleep 1
      kill -9 "$pid" 2>/dev/null || true
    fi
    rm -f "$pid_file"
  fi
}

stop_pid_file backend
stop_pid_file frontend

# Belt & suspenders: in case a Vite or uvicorn process leaked (PID file
# missing, started outside the script, fork survived a SIGTERM…) sweep
# anything still bound to our two ports. Without this we'd hand the
# user a port-conflict error on next start.
for port in 8001 5173; do
  pids="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    echo "▶ killing leftover listeners on :$port (pids: $pids)"
    # shellcheck disable=SC2086
    kill $pids 2>/dev/null || true
    sleep 1
    # shellcheck disable=SC2086
    kill -9 $pids 2>/dev/null || true
  fi
done

# Vite leaves behind `node_modules/.vite/deps_temp_*` dirs when its
# process is killed mid-optimization. On the next `npm run dev` Vite
# re-discovers them and either rebuilds slowly or wedges entirely
# (this is what causes the "loads forever" symptom the user keeps
# hitting after a restart). Sweeping them is safe — they're cache,
# not source.
VITE_DEPS="$ROOT_DIR/frontend/node_modules/.vite"
if [[ -d "$VITE_DEPS" ]]; then
  if compgen -G "$VITE_DEPS/deps_temp_*" >/dev/null; then
    echo "▶ removing stale Vite deps_temp_* dirs"
    rm -rf "$VITE_DEPS"/deps_temp_*
  fi
fi

if command -v docker >/dev/null 2>&1; then
  echo "▶ stopping docker compose services"
  (cd "$ROOT_DIR" && docker compose stop >/dev/null 2>&1 || true)
fi

echo "✅ Mindshift stopped"
