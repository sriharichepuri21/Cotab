#!/usr/bin/env bash
# Run the Cotab demo on this machine: API on :8000, app on :3010, with a
# seeded account (demo+local@cotab.center / CotabDemo2026!) that skips email
# verification, the phone step and onboarding. Needs Python 3.11+ and Node 20+.
#
#   ./scripts/demo-local.sh                 # app on http://localhost:3010
#   WEB_PORT=3020 API_PORT=8010 ./scripts/demo-local.sh   # if those are taken
#
# Use "localhost", not 127.0.0.1: the session cookie only flows between them.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EMAIL="demo+local@cotab.center"
PASSWORD="CotabDemo2026!"
WEB_PORT="${WEB_PORT:-3010}"
API_PORT="${API_PORT:-8000}"
export DATABASE_URL="sqlite:///./local_test.db"
# The API only answers the origin the app is served from.
export CORS_ORIGINS="http://localhost:$WEB_PORT"

cd "$ROOT/backend"
[ -d venv ] || python3 -m venv venv
# shellcheck disable=SC1091
source venv/bin/activate
# A venv made by uv has no pip of its own.
python -m pip --version >/dev/null 2>&1 || python -m ensurepip >/dev/null
python -m pip install -q -r requirements.txt
[ -f .env ] || cp ../.env.example .env
alembic upgrade head >/dev/null

uvicorn app.main:app --port "$API_PORT" >"$ROOT/.demo-api.log" 2>&1 &
API_PID=$!
trap 'kill $API_PID 2>/dev/null || true' EXIT
until curl -fs "localhost:$API_PORT/health" >/dev/null; do sleep 1; done

# Create the demo account once, mark it ready, then seed a year of data.
curl -s -X POST "localhost:$API_PORT/api/v1/auth/register" -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"full_name\":\"Alex Morgan\"}" >/dev/null || true
python - <<PY
import sqlite3
c = sqlite3.connect("local_test.db")
c.execute("update users set email_verified=1, phone='+14155550123', phone_verified_at=datetime('now'), intent='track' where email=?", ("$EMAIL",))
c.commit()
PY
python -m scripts.seed_demo_year

cd "$ROOT/frontend"
echo "NEXT_PUBLIC_API_URL=http://localhost:$API_PORT" > .env.local
[ -d node_modules ] || npm ci --no-audit --no-fund
echo
echo "Open http://localhost:$WEB_PORT/login  ($EMAIL / $PASSWORD). Ctrl+C stops both servers."
npm run dev -- -p "$WEB_PORT"
