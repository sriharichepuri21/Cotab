#!/usr/bin/env bash
# Run the Cotab demo on this machine: API on :8000, app on :3000, with a
# seeded account (demo+local@cotab.center / demo1234) that skips email
# verification, the phone step and onboarding. Needs Python 3.11+ and Node 20+.
#
#   ./scripts/demo-local.sh
#
# Then open http://localhost:3000 (use "localhost", not 127.0.0.1).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EMAIL="demo+local@cotab.center"
PASSWORD="demo1234"
export DATABASE_URL="sqlite:///./local_test.db"

cd "$ROOT/backend"
[ -d venv ] || python3 -m venv venv
# shellcheck disable=SC1091
source venv/bin/activate
pip install -q -r requirements.txt
[ -f .env ] || cp ../.env.example .env
alembic upgrade head >/dev/null

uvicorn app.main:app --port 8000 >"$ROOT/.demo-api.log" 2>&1 &
API_PID=$!
trap 'kill $API_PID 2>/dev/null || true' EXIT
until curl -fs localhost:8000/health >/dev/null; do sleep 1; done

# Create the demo account once, mark it ready, then seed a year of data.
curl -s -X POST localhost:8000/api/v1/auth/register -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"full_name\":\"Alex Morgan\"}" >/dev/null || true
python - <<PY
import sqlite3
c = sqlite3.connect("local_test.db")
c.execute("update users set email_verified=1, phone='+14155550123', phone_verified_at=datetime('now'), intent='track' where email=?", ("$EMAIL",))
c.commit()
PY
python -m scripts.seed_demo_year

cd "$ROOT/frontend"
echo "NEXT_PUBLIC_API_URL=http://localhost:8000" > .env.local
[ -d node_modules ] || npm ci --no-audit --no-fund
echo
echo "Open http://localhost:3000  ($EMAIL / $PASSWORD). Ctrl+C stops both servers."
npm run dev
