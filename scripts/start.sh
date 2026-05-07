#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="$ROOT_DIR/.runtime"
LOG_DIR="$RUNTIME_DIR/logs"
mkdir -p "$RUNTIME_DIR" "$LOG_DIR"

cd "$ROOT_DIR"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "❌ docker not found in PATH" >&2
  exit 1
fi

echo "▶ starting postgres (docker compose) …"
docker compose up -d postgres >/dev/null

echo "▶ waiting for postgres to be ready …"
for i in {1..30}; do
  if docker compose exec -T postgres pg_isready -U mindshift -d mindshift >/dev/null 2>&1; then
    break
  fi
  sleep 1
  if [[ $i -eq 30 ]]; then
    echo "❌ postgres did not become ready" >&2
    exit 1
  fi
done

# --- Backend ---
echo "▶ starting backend (FastAPI) …"
cd "$ROOT_DIR/backend"
if [[ ! -d .venv ]]; then
  echo "  • creating virtualenv (.venv)"
  python3 -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate
pip install --quiet --upgrade pip
pip install --quiet -r requirements.txt

# Run migrations (idempotent)
if [[ -d app/migrations/versions ]] && compgen -G "app/migrations/versions/*.py" > /dev/null; then
  echo "  • running alembic migrations"
  alembic upgrade head
fi

if lsof -nP -iTCP:8001 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "❌ Port 8001 is already in use. Existing listener:" >&2
  lsof -nP -iTCP:8001 -sTCP:LISTEN >&2
  echo "   Stop the conflicting process or run ./scripts/stop.sh first." >&2
  exit 1
fi

nohup uvicorn app.main:app --reload --host 0.0.0.0 --port 8001 \
  > "$LOG_DIR/backend.log" 2>&1 &
BACKEND_PID=$!
echo $BACKEND_PID > "$RUNTIME_DIR/backend.pid"
deactivate

echo "  • waiting for backend health …"
for i in {1..30}; do
  if curl -fsS --max-time 2 http://localhost:8001/api/health >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    echo "❌ Backend exited before becoming healthy. Last log lines:" >&2
    tail -30 "$LOG_DIR/backend.log" >&2
    exit 1
  fi
  sleep 1
  if [[ $i -eq 30 ]]; then
    echo "❌ Backend did not respond on /api/health within 30s" >&2
    tail -30 "$LOG_DIR/backend.log" >&2
    exit 1
  fi
done

# --- Frontend ---
echo "▶ starting frontend (Vite) …"
cd "$ROOT_DIR/frontend"
if [[ ! -d node_modules ]]; then
  echo "  • installing npm dependencies"
  npm install --silent
fi
nohup npm run dev > "$LOG_DIR/frontend.log" 2>&1 &
echo $! > "$RUNTIME_DIR/frontend.pid"

cat <<EOF

✅ Mindshift is running
   Backend:  http://localhost:8001
   Health:   http://localhost:8001/api/health
   Frontend: http://localhost:5173
   Logs:     $LOG_DIR/{backend,frontend}.log
   Stop:     ./scripts/stop.sh
EOF
