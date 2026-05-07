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

if command -v docker >/dev/null 2>&1; then
  echo "▶ stopping docker compose services"
  (cd "$ROOT_DIR" && docker compose stop >/dev/null 2>&1 || true)
fi

echo "✅ Mindshift stopped"
